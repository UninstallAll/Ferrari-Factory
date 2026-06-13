// 网页爬虫(供深度搜索的"爬取目录"模式) —— 结构优先重写版。
//
// 职责：页面采集(render.getPage, 智能按需 JS 渲染) + 配方套用(applyRecipe, 确定性抽记录)
//       + 翻页(配方驱动, 启发式兜底) + 去重 + 有用页判定。
// 「该站是不是列表、记录怎么抽」由 recipe.ts 决定，本文件只负责执行；
// 配方的【推断】通过 getRecipe 回调注入(由 engine 提供, 内含 LLM/缓存/日志)。

import * as cheerio from 'cheerio'
import { getPage, type FetchedPage, type RenderBudget } from './render'
import { extractReadable } from './readability'
import { applyRecipe, type ExtractionRecipe, type StructuredRecord } from './recipe'
import type { StructuredHarvest } from './structured'
import type { NodeType } from './types'

export interface CrawledPage {
  url: string
  title: string
  text: string // readability 兜底正文(保结构 + 保链接)
  html: string
  structured: StructuredHarvest // JSON-LD/microdata/OG 直采结果
  records: StructuredRecord[] // 配方套用结果(非列表页为空)
  recordType: NodeType // 记录代表的实体类型
}

export type CrawlPageMode = 'fixed' | 'auto'

export interface CrawlListingOptions {
  maxPages: number
  mode?: CrawlPageMode
  budget?: RenderBudget // JS 渲染预算(整个 run 共享)
  getRecipe?: (firstPage: FetchedPage) => Promise<ExtractionRecipe> // 配方推断(engine 注入)
  onPage?: (url: string, idx: number, total: number) => Promise<void> | void
}

export interface CrawlResult {
  pages: CrawledPage[]
  recipe: ExtractionRecipe | null
}

const AUTO_SAFETY_CAP = Number(process.env.CRAWL_AUTO_MAX_PAGES) || 50
const MIN_USEFUL_TEXT = Number(process.env.CRAWL_MIN_TEXT) || 120

function getTitle($: cheerio.CheerioAPI): string {
  return ($('title').first().text() || '').replace(/\s+/g, ' ').trim()
}

/** 轻量字符串哈希(FNV-1a)，用于内容去重签名 */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// ---------------- 去重 / 有用性 ----------------

/** 内容签名：有记录用「记录名集合」，否则用「全文哈希」——共享头部的不同页不再误判重复 */
function pageSignature(p: CrawledPage): string {
  if (p.records.length) {
    return 'rec:' + hash(p.records.map((r) => r.name.toLowerCase()).sort().join('|'))
  }
  return 'txt:' + hash(p.text.replace(/\s+/g, ''))
}

/** 有用页：抽到 ≥1 条记录，或 ≥1 个结构化实体，或主正文够长——短而密的列表页不再被误杀 */
function isUseful(p: CrawledPage): boolean {
  return p.records.length > 0 || p.structured.entities.length > 0 || p.text.length >= MIN_USEFUL_TEXT
}

// ---------------- 翻页 ----------------

function hasPageParam(url: string): boolean {
  return /[?&]page=\d+/i.test(url)
}

function withParam(url: string, param: string, n: number): string {
  try {
    const u = new URL(url)
    u.searchParams.set(param, String(n))
    return u.toString()
  } catch {
    return url
  }
}

/** 路径式翻页：把 /page/2/ 或 /artists/2 里的页码替换为 n；无现成模式则返回 null */
function pathPageUrl(url: string, n: number): string | null {
  try {
    const u = new URL(url)
    if (/\/page\/\d+/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/page\/\d+/i, `/page/${n}`)
      return u.toString()
    }
    if (/\/\d+\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/\d+(\/?)$/, `/${n}$1`)
      return u.toString()
    }
    return null
  } catch {
    return null
  }
}

function findNextByText($: cheerio.CheerioAPI, currentUrl: string, visited: Set<string>): string | null {
  const tryHref = (href?: string): string | null => {
    if (!href) return null
    try {
      const u = new URL(href, currentUrl).toString()
      return u === currentUrl || visited.has(u) ? null : u
    } catch {
      return null
    }
  }
  const relNext = tryHref($('a[rel="next"], link[rel="next"]').attr('href'))
  if (relNext) return relNext
  let found: string | null = null
  $('a[href]').each((_, a) => {
    if (found) return
    const label = $(a).text().trim().toLowerCase()
    if (['next', '下一页', '›', '»', 'next page', 'older'].includes(label)) found = tryHref($(a).attr('href'))
  })
  return found
}

/** 计算下一页 URL：优先配方 pagination，否则启发式 */
function nextPageUrl(
  recipe: ExtractionRecipe | null,
  startUrl: string,
  currentUrl: string,
  $: cheerio.CheerioAPI,
  pageNum: number,
  visited: Set<string>
): string | null {
  const next = pageNum + 1
  const pag = recipe?.pagination
  const dedupe = (u: string | null): string | null => (u && !visited.has(u) ? u : null)

  switch (pag?.type) {
    case 'query':
      return dedupe(withParam(startUrl, pag.param || 'page', next))
    case 'path':
      if (pag.pathTemplate) {
        try {
          return dedupe(new URL(pag.pathTemplate.replace('{n}', String(next)), startUrl).toString())
        } catch {
          return null
        }
      }
      return dedupe(pathPageUrl(currentUrl, next))
    case 'rel-next':
    case 'next-text': {
      if (pag.selector) {
        const href = $(pag.selector).first().attr('href')
        if (href) {
          try {
            return dedupe(new URL(href, currentUrl).toString())
          } catch {
            /* fall through */
          }
        }
      }
      return dedupe(findNextByText($, currentUrl, visited))
    }
    default:
      break
  }

  // 启发式兜底：?page= 递增 → 路径式 → 文字"下一页"
  if (hasPageParam(startUrl) || hasPageParam(currentUrl)) return dedupe(withParam(startUrl, 'page', next))
  const byPath = pathPageUrl(currentUrl, next)
  if (byPath) return dedupe(byPath)
  return dedupe(findNextByText($, currentUrl, visited))
}

// ---------------- 单页构建 / 渲染兜底 ----------------

function buildCrawledPage(page: FetchedPage, recipe: ExtractionRecipe | null): CrawledPage {
  const records = recipe?.recordSelector ? applyRecipe(page.$, recipe, page.url) : []
  const readable = extractReadable(page.$, page.url)
  return {
    url: page.url,
    title: getTitle(page.$),
    text: readable.text,
    html: page.html,
    structured: page.structured,
    records,
    recordType: recipe?.recordType || 'artist',
  }
}

/**
 * 配方失配升级：配方有 recordSelector 但静态页匹配到 0 条 → 该列表几乎可断定客户端渲染，
 * 升级 Playwright 重抓；成功则把 recipe.needsJs=true(由 engine 落库，下次直接渲染)。
 */
async function ensureRendered(
  page: FetchedPage,
  recipe: ExtractionRecipe | null,
  budget?: RenderBudget
): Promise<FetchedPage> {
  if (!recipe?.recordSelector || page.rendered) return page
  if (applyRecipe(page.$, recipe, page.url).length > 0) return page
  const r = await getPage(page.url, { budget, forceJs: true })
  if (r.html && applyRecipe(r.$, recipe, page.url).length > 0) {
    recipe.needsJs = true
    return r
  }
  return page
}

// ---------------- 主入口 ----------------

/**
 * 爬取一个起始网址及其分页。
 * - 首页抓取后调用 getRecipe(若提供) 取/推断配方；
 * - 逐页：智能渲染 → 配方套用 → 去重/有用性判定 → 配方驱动翻页；
 * - 返回每页内容 + 本站配方(engine 据此落库 needsJs 等)。
 */
export async function crawlListing(startUrl: string, opts: CrawlListingOptions): Promise<CrawlResult> {
  const cap = Math.max(1, Math.min(opts.maxPages, opts.mode === 'auto' ? AUTO_SAFETY_CAP : opts.maxPages))
  const pages: CrawledPage[] = []
  const seenSig = new Set<string>()
  const visited = new Set<string>()
  const budget = opts.budget

  let current = await getPage(startUrl, { budget })
  if (!current.html) return { pages, recipe: null }

  let recipe: ExtractionRecipe | null = null
  if (opts.getRecipe) {
    try {
      recipe = await opts.getRecipe(current)
    } catch {
      recipe = null
    }
  }

  let pageNum = 1
  let currentUrl = startUrl
  while (pages.length < cap) {
    if (visited.has(currentUrl)) break
    visited.add(currentUrl)
    if (opts.onPage) await opts.onPage(currentUrl, pages.length + 1, cap)

    current = await ensureRendered(current, recipe, budget)
    const built = buildCrawledPage(current, recipe)

    if (!isUseful(built)) {
      if (pageNum > 1) break // 首页可宽容，后续空页即停
    } else {
      const sig = pageSignature(built)
      if (seenSig.has(sig)) {
        if (pageNum > 1) break // 内容重复 → 到末页了
      } else {
        seenSig.add(sig)
        pages.push(built)
      }
    }

    const next = nextPageUrl(recipe, startUrl, currentUrl, current.$, pageNum, visited)
    if (!next) break
    pageNum++
    current = await getPage(next, { budget, forceJs: !!recipe?.needsJs })
    currentUrl = next
    if (!current.html) break
  }

  return { pages, recipe }
}
