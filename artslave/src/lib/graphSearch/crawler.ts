// 网页爬虫(供深度搜索的"爬取目录"模式)
// 能力：fetch 抓取 + cheerio 正文提取(去导航/脚本) + 自动翻页 + 可选 JS 渲染。
// JS 渲染为按需可选：仅当安装 playwright 且设置 CRAWL_JS=1 时启用，否则回退普通 fetch。

import * as cheerio from 'cheerio'

export interface CrawledPage {
  url: string
  title: string
  text: string
}

const UA = 'Mozilla/5.0 (compatible; ArtSlaveBot/1.0; knowledge-graph research)'

async function fetchHtml(url: string, timeoutMs = 25000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en,zh;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// 可选 JS 渲染：动态载入 playwright(用变量做 specifier，避免未安装时编译/打包报错)
async function renderWithJs(url: string): Promise<string | null> {
  if (process.env.CRAWL_JS !== '1') return null
  try {
    const pkg = 'playwright'
    const pw: any = await import(pkg)
    const browser = await pw.chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ userAgent: UA })
      await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 })
      return await page.content()
    } finally {
      await browser.close()
    }
  } catch {
    return null // 未安装 playwright 或渲染失败 → 回退 fetch
  }
}

async function getHtml(url: string): Promise<string> {
  const rendered = await renderWithJs(url)
  if (rendered) return rendered
  return fetchHtml(url)
}

function getTitle($: cheerio.CheerioAPI): string {
  return ($('title').first().text() || '').replace(/\s+/g, ' ').trim()
}

function extractText($: cheerio.CheerioAPI): string {
  $('script,style,noscript,svg,iframe,link,meta,nav,header,footer,form').remove()
  let root = $('main').first()
  if (!root.length) root = $('#content, .content, #main, article, .catalogue, .list').first()
  if (!root.length) root = $('body')
  return root
    .text()
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 生成要抓取的分页 URL 列表
function buildPageUrls(startUrl: string, $: cheerio.CheerioAPI, maxPages: number): string[] {
  // 1) URL 自带 page=N → 直接按 1..maxPages 生成(最稳)
  if (/[?&]page=\d+/i.test(startUrl)) {
    const urls: string[] = []
    for (let p = 1; p <= maxPages; p++) {
      urls.push(startUrl.replace(/([?&]page=)\d+/i, `$1${p}`))
    }
    return Array.from(new Set(urls))
  }

  // 2) 否则从页面里找分页链接(?page=N / rel=next / 文本 Next)
  const found = new Set<string>()
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || ''
    const label = $(a).text().trim().toLowerCase()
    if (/[?&]page=\d+/i.test(href) || /[\/-]page[\/-]?\d+/i.test(href) || label === 'next' || label === '下一页') {
      try {
        found.add(new URL(href, startUrl).toString())
      } catch {
        /* 忽略非法链接 */
      }
    }
  })
  $('a[rel="next"], link[rel="next"]').each((_, a) => {
    const href = $(a).attr('href')
    if (href) {
      try {
        found.add(new URL(href, startUrl).toString())
      } catch {
        /* 忽略 */
      }
    }
  })

  const out = [startUrl, ...Array.from(found).filter((u) => u !== startUrl)]
  return Array.from(new Set(out)).slice(0, maxPages)
}

/**
 * 爬取一个起始网址及其分页，返回每页的真实正文。
 * @param onPage 进度回调(用于实时日志)
 */
export async function crawlListing(
  startUrl: string,
  opts: { maxPages: number; onPage?: (url: string, idx: number, total: number) => Promise<void> | void }
): Promise<CrawledPage[]> {
  const firstHtml = await getHtml(startUrl)
  const $first = cheerio.load(firstHtml)
  const pageUrls = buildPageUrls(startUrl, $first, Math.max(1, opts.maxPages))

  const pages: CrawledPage[] = []
  const seenSig = new Set<string>()

  for (let i = 0; i < pageUrls.length; i++) {
    const u = pageUrls[i]
    if (opts.onPage) await opts.onPage(u, i + 1, pageUrls.length)
    try {
      const html = u === startUrl ? firstHtml : await getHtml(u)
      const $ = cheerio.load(html)
      const text = extractText($)
      if (!text || text.length < 200) continue
      // 内容指纹去重：若与已抓页面正文几乎相同(常见于超出末页返回首页) → 停止翻页
      const sig = text.replace(/\s+/g, '').slice(0, 400)
      if (seenSig.has(sig)) break
      seenSig.add(sig)
      pages.push({ url: u, title: getTitle($), text })
    } catch {
      /* 跳过失败页 */
    }
  }
  return pages
}
