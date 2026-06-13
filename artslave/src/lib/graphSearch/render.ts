// 采集层(Layer 1)：静态 fetch → 智能判定是否需要 JS 渲染 → 按需 Playwright 渲染(含自动滚动)。
//
// 与旧实现的区别：不再用全局 CRAWL_JS=1 一刀切，而是【先静态抓，再按多信号判断】
// 是否升级到浏览器渲染——绝大多数页面零额外开销，只有真正需要 JS 的页面才付出渲染成本。
//   环境变量语义：CRAWL_JS=0 显式禁用渲染；未安装 playwright 时自动回退静态(优雅降级)。

import * as cheerio from 'cheerio'
import { harvestStructured, type StructuredHarvest } from './structured'

const UA = 'Mozilla/5.0 (compatible; ArtSlaveBot/1.0; knowledge-graph research)'

export interface RenderBudget {
  remaining: number // 本次 run 还允许渲染多少页(防止整站都走浏览器)
}

export interface FetchedPage {
  url: string
  html: string
  status: number
  $: cheerio.CheerioAPI
  structured: StructuredHarvest
  rendered: boolean // 是否经过 JS 渲染
}

export interface GetPageOptions {
  budget?: RenderBudget
  forceJs?: boolean // 配方已知该站需要渲染(recipe.needsJs) → 直接渲染
  timeoutMs?: number
}

async function fetchStatic(url: string, timeoutMs = 25000): Promise<{ html: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en,zh;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const html = await res.text()
  return { html, status: res.status }
}

/** 去掉 script/style 后的可见正文长度(用于稀薄度判断) */
export function extractVisibleText($: cheerio.CheerioAPI): string {
  const $$ = cheerio.load($.html())
  $$('script,style,noscript,template,svg').remove()
  return ($$('body').text() || '').replace(/\s+/g, ' ').trim()
}

/**
 * 判断是否需要升级到 JS 渲染。先静态拿到 html/$/structured，再多信号判断。
 * 信号：① 已拿到结构化数据则无需渲染；② app 骨架挂载点为空；
 *       ③ bundle 脚本多而语义元素极少；④ noscript 提示需要 JS；⑤ 正文极稀薄且占比极低。
 */
export function shouldRenderWithJs(html: string, $: cheerio.CheerioAPI, structured: StructuredHarvest): boolean {
  // 0) 静态 HTML 已含足够结构化数据(如 JSON-LD) → 不必渲染
  if (structured.entities.length >= 3) return false

  const visibleText = extractVisibleText($)
  const textLen = visibleText.length
  const htmlLen = html.length || 1
  const textRatio = textLen / htmlLen

  // app 骨架：挂载点存在但内部几乎为空
  const shellEmpty = ['#root', '#app', '#__next', '[data-reactroot]', 'app-root'].some((sel) => {
    const el = $(sel).first()
    return el.length > 0 && el.text().trim().length < 40
  })

  // 脚本重 + 语义元素少
  const bundleScripts = $('script[src]').filter((_, s) =>
    /(_next|static\/js|chunk|vendor|runtime|\.bundle\.)/i.test($(s).attr('src') || '')
  ).length
  const semanticCount = $('p, li, article, h1, h2, h3').length
  const scriptHeavyLowContent = bundleScripts >= 2 && semanticCount < 5

  const noscriptHint = /enable\s+javascript|requires?\s+javascript|启用\s*javascript/i.test($('noscript').text())

  return shellEmpty || scriptHeavyLowContent || noscriptHint || (textLen < 400 && textRatio < 0.05)
}

/** 用 Playwright 渲染并自动滚动(处理无限滚动/懒加载)。未装/失败返回 null。 */
async function renderWithJs(url: string, timeoutMs = 35000): Promise<string | null> {
  if (process.env.CRAWL_JS === '0') return null
  try {
    const pkg = 'playwright'
    const pw: any = await import(/* webpackIgnore: true */ pkg)
    const browser = await pw.chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ userAgent: UA })
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
      await autoScroll(page)
      return await page.content()
    } finally {
      await browser.close()
    }
  } catch {
    return null
  }
}

/** 滚动到底直到高度稳定或达到步数上限(把无限滚动的内容全部加载出来) */
async function autoScroll(page: any): Promise<void> {
  try {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let last = 0
        let stable = 0
        let steps = 0
        const timer = setInterval(() => {
          window.scrollTo(0, document.body.scrollHeight)
          const h = document.body.scrollHeight
          steps++
          if (h === last) stable++
          else {
            stable = 0
            last = h
          }
          if (stable >= 3 || steps >= 40) {
            clearInterval(timer)
            resolve()
          }
        }, 300)
      })
    })
  } catch {
    /* 滚动失败不致命，用已加载内容即可 */
  }
}

/**
 * 抓取一页：静态 fetch + 结构化直采，必要时按预算升级 JS 渲染。
 * 返回 html / 解析好的 $ / 结构化数据，供上层(crawler/recipe)复用，避免重复解析。
 */
export async function getPage(url: string, opts: GetPageOptions = {}): Promise<FetchedPage> {
  const jsEnabled = process.env.CRAWL_JS !== '0'

  let html = ''
  let status = 0
  try {
    const r = await fetchStatic(url, opts.timeoutMs)
    html = r.html
    status = r.status
  } catch {
    /* 静态失败：交给下面的渲染兜底(若开启) */
  }

  let $ = cheerio.load(html)
  let structured = harvestStructured($, url)
  let rendered = false

  const wantRender = jsEnabled && (opts.forceJs || shouldRenderWithJs(html, $, structured))
  const budgetOk = !opts.budget || opts.budget.remaining > 0

  if (wantRender && budgetOk) {
    const renderedHtml = await renderWithJs(url)
    if (renderedHtml) {
      html = renderedHtml
      status = status || 200
      $ = cheerio.load(html)
      structured = harvestStructured($, url)
      rendered = true
      if (opts.budget) opts.budget.remaining -= 1
    }
  }

  return { url, html, status, $, structured, rendered }
}
