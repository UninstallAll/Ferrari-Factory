// 目标驱动的智能下钻爬取(Agentic Descent)。
//
// 从一个(可能很宽泛的)种子 URL 出发，BFS 逐页：
//   ① 用 crawlListing 抓这个 URL 及其翻页(复用 Phase 1 的 render/recipe/structured/readability)；
//   ② 收集本页的候选链接(记录详情链接 + 页面锚点)；
//   ③ 让导航 LLM(selectLinks) 朝【目标】挑出值得继续抓的链接 → 入队下一层。
// 直到下钻深度 / 全局页预算用尽。这样"给主页 + 一句目标"也能自己走到深层片单/详情。

import { crawlListing, type CrawledPage } from './crawler'
import type { RenderBudget, FetchedPage } from './render'
import type { ExtractionRecipe } from './recipe'
import {
  selectLinks,
  filterCandidates,
  registrableDomain,
  normalizeUrl,
  type LinkCandidate,
  type NavDecision,
} from './navigator'

export interface AgenticCrawlOptions {
  goal?: string | null
  budget?: RenderBudget
  getRecipe: (firstPage: FetchedPage) => Promise<ExtractionRecipe>
  maxLinkDepth?: number // 下钻深度(默认 env CRAWL_LINK_DEPTH 或 3)
  maxTotalPages?: number // 全局页预算(默认 env CRAWL_MAX_TOTAL_PAGES 或 60)
  perPageFollow?: number // 每页最多跟进几条链接(默认 8)
  perUrlPages?: number // 每个 URL(列表)最多翻几页(默认 10)
  allowSubdomains?: boolean // 允许同主域子域(默认 true)
  isStopped?: () => Promise<boolean>
  log?: (message: string, level?: string) => Promise<void>
}

export interface AgenticCrawlResult {
  pages: CrawledPage[]
  recipes: ExtractionRecipe[]
}

export async function agenticCrawl(seedUrls: string[], opts: AgenticCrawlOptions): Promise<AgenticCrawlResult> {
  const maxDepth = opts.maxLinkDepth ?? (Number(process.env.CRAWL_LINK_DEPTH) || 3)
  const maxTotal = opts.maxTotalPages ?? (Number(process.env.CRAWL_MAX_TOTAL_PAGES) || 60)
  const perFollow = opts.perPageFollow ?? (Number(process.env.CRAWL_PER_PAGE_FOLLOW) || 8)
  const perUrlPages = opts.perUrlPages ?? (Number(process.env.CRAWL_PER_URL_PAGES) || 10)
  const allowSub = opts.allowSubdomains !== false

  let siteHost = ''
  try {
    siteHost = registrableDomain(new URL(seedUrls[0]).host)
  } catch {
    /* ignore */
  }

  const visited = new Set<string>()
  const queued = new Set<string>()
  const queue: { url: string; depth: number }[] = []
  for (const s of seedUrls) {
    const n = normalizeUrl(s)
    if (!queued.has(n)) {
      queued.add(n)
      queue.push({ url: s, depth: 0 })
    }
  }

  const pages: CrawledPage[] = []
  const recipes: ExtractionRecipe[] = []
  const recipeKeys = new Set<string>()

  while (queue.length && pages.length < maxTotal) {
    const { url, depth } = queue.shift()!
    const nurl = normalizeUrl(url)
    if (visited.has(nurl)) continue
    visited.add(nurl)
    if (opts.isStopped && (await opts.isStopped())) break

    const listCap = Math.max(1, Math.min(perUrlPages, maxTotal - pages.length))
    let got: CrawledPage[] = []
    let recipe: ExtractionRecipe | null = null
    try {
      const res = await crawlListing(url, {
        maxPages: listCap,
        mode: 'auto',
        budget: opts.budget,
        getRecipe: opts.getRecipe,
        onPage: async (u) => {
          if (opts.log) await opts.log(`深挖 L${depth} 抓取 ${u}`, 'llm')
        },
      })
      got = res.pages
      recipe = res.recipe
    } catch (err) {
      if (opts.log) await opts.log(`⚠ L${depth} 抓取失败 ${url}：${err instanceof Error ? err.message : String(err)}`, 'error')
      continue
    }

    if (recipe) {
      const k = `${recipe.origin}|${recipe.urlPattern}`
      if (!recipeKeys.has(k)) {
        recipeKeys.add(k)
        recipes.push(recipe)
      }
    }
    for (const p of got) {
      if (pages.length >= maxTotal) break
      pages.push(p)
    }
    if (opts.log && got.length) {
      const recCount = got.reduce((a, p) => a + p.records.length, 0)
      await opts.log(`L${depth} ✓ ${url}：${got.length} 页 / 记录 ${recCount}（累计 ${pages.length} 页）`, 'success')
    }

    if (depth >= maxDepth || pages.length >= maxTotal) continue

    // 收集候选：记录详情链接 + 页面锚点
    const cand: LinkCandidate[] = []
    for (const p of got) {
      for (const r of p.records) if (r.link) cand.push({ text: r.name, url: r.link })
      for (const l of p.links) cand.push(l)
    }
    const filtered = filterCandidates(cand, url, { siteHost, allowSubdomains: allowSub, visited, cap: 60 })
    if (!filtered.length) continue

    // 目标驱动选链(失败 → 广度兜底取前若干)
    let decision: NavDecision
    try {
      decision = await selectLinks(opts.goal, { url, title: got[0]?.title }, filtered, perFollow)
    } catch {
      decision = { isTargetContent: false, follow: filtered.slice(0, Math.min(perFollow, 4)).map((c) => c.url) }
    }

    let enq = 0
    for (const u of decision.follow) {
      const n = normalizeUrl(u)
      if (visited.has(n) || queued.has(n)) continue
      queued.add(n)
      queue.push({ url: u, depth: depth + 1 })
      enq++
    }
    if (opts.log) {
      await opts.log(
        `L${depth} 选链下钻：候选 ${filtered.length} → 跟进 ${enq}${decision.reason ? `（${decision.reason}）` : ''}`,
        'info'
      )
    }
  }

  return { pages, recipes }
}
