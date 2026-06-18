// 真实资料检索：为知识图谱扩展提供「可核验」的事实来源
//
// 设计原则：
// - 默认走「维基百科 API」：免费、无需 key、立即可用、对艺术史/学术实体覆盖好、天然可引用出处。
// - 可插拔：配置 TAVILY_API_KEY / SERPER_API_KEY / BOCHA_API_KEY 后自动叠加更广覆盖。
// - 由 RETRIEVAL_PROVIDER 选择：wikipedia(默认) | tavily | serper | bocha | auto(全部并行)。
// - 永远返回「真实文本 + 出处URL」，没有就返回空(绝不编造)。

export interface RetrievedDoc {
  title: string
  url: string
  text: string
  source: string // 'wikipedia:en' | 'tavily' | 'serper' | 'bocha'
}

const UA = 'ArtSlaveBot/1.0 (knowledge-graph research)'

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ---------------- 维基百科 ----------------

async function wikiSearchTitles(lang: string, query: string, limit: number): Promise<string[]> {
  const u =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&srprop=&format=json`
  const j = await getJson(u)
  return (j?.query?.search || []).map((s: any) => s.title).filter(Boolean)
}

async function wikiExtract(lang: string, title: string, maxChars: number): Promise<RetrievedDoc | null> {
  const u =
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info` +
    `&explaintext=1&inprop=url&redirects=1&titles=${encodeURIComponent(title)}&format=json`
  const j = await getJson(u)
  const pages = j?.query?.pages || {}
  const page: any = Object.values(pages)[0]
  if (!page || page.missing !== undefined || !page.extract) return null
  return {
    title: page.title,
    url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    text: String(page.extract).slice(0, maxChars),
    source: `wikipedia:${lang}`,
  }
}

async function retrieveWikipedia(
  query: string,
  opts: { maxCharsPrimary: number; maxCharsSecondary: number }
): Promise<RetrievedDoc[]> {
  // 英文优先(覆盖更广/内容更全)，命中则用之；未命中再回退中文。
  for (const lang of ['en', 'zh']) {
    const docs: RetrievedDoc[] = []
    try {
      const titles = await wikiSearchTitles(lang, query, 3)
      if (!titles.length) continue
      const primary = await wikiExtract(lang, titles[0], opts.maxCharsPrimary)
      if (primary) docs.push(primary)
      // 额外取一篇增加广度(有助于挖出更多真实邻居)
      if (titles[1]) {
        const secondary = await wikiExtract(lang, titles[1], opts.maxCharsSecondary)
        if (secondary) docs.push(secondary)
      }
    } catch {
      /* 换下一语言 */
    }
    if (docs.length) return docs
  }
  return []
}

// ---------------- 可选第三方(配置 key 才启用) ----------------

async function retrieveTavily(query: string): Promise<RetrievedDoc[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'advanced',
      max_results: 5,
      include_raw_content: true,
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) return []
  const j = await res.json()
  return (j?.results || [])
    .map((r: any) => ({
      title: r.title || r.url,
      url: r.url,
      text: String(r.raw_content || r.content || '').slice(0, 4000),
      source: 'tavily',
    }))
    .filter((d: RetrievedDoc) => d.url && d.text)
}

async function retrieveSerper(query: string): Promise<RetrievedDoc[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 6 }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return []
  const j = await res.json()
  return (j?.organic || [])
    .map((o: any) => ({
      title: o.title || o.link,
      url: o.link,
      text: String(o.snippet || '').slice(0, 1200),
      source: 'serper',
    }))
    .filter((d: RetrievedDoc) => d.url && d.text)
}

async function retrieveBocha(query: string): Promise<RetrievedDoc[]> {
  const key = process.env.BOCHA_API_KEY
  if (!key) return []
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, summary: true, count: 6 }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return []
  const j = await res.json()
  const list = j?.data?.webPages?.value || j?.data?.value || []
  return list
    .map((w: any) => ({
      title: w.name || w.title || w.url,
      url: w.url,
      text: String(w.summary || w.snippet || '').slice(0, 3000),
      source: 'bocha',
    }))
    .filter((d: RetrievedDoc) => d.url && d.text)
}

// ---------------- 免费联网搜索(无需 key)：Jina Search ----------------
// s.jina.ai 直接返回若干网页的标题/正文/URL，免 key、即时可用，对维基覆盖不到的
// 小众/当代实体(艺术家、驻留、资助)是关键补充。失败/超时则返回空(绝不编造)。
async function retrieveJina(query: string): Promise<RetrievedDoc[]> {
  try {
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const j = await res.json()
    const list = Array.isArray(j?.data) ? j.data : []
    return list
      .map((r: any) => ({
        title: String(r.title || r.url || '').trim(),
        url: String(r.url || '').trim(),
        text: String(r.content || r.description || '').slice(0, 4000),
        source: 'jina',
      }))
      .filter((d: RetrievedDoc) => d.url && d.text)
      .slice(0, 4)
  } catch {
    return []
  }
}

// ---------------- 统一入口 ----------------

/**
 * 检索某实体的真实资料。返回去重后的「真实文本 + 出处」列表。
 * 找不到任何真实资料时返回空数组(上层据此跳过，绝不编造)。
 */
export async function retrieveContext(query: string): Promise<RetrievedDoc[]> {
  const provider = (process.env.RETRIEVAL_PROVIDER || 'wikipedia').toLowerCase()
  const wikiOpts = { maxCharsPrimary: 9000, maxCharsSecondary: 3000 }

  const tasks: Promise<RetrievedDoc[]>[] = []
  const useAll = provider === 'auto'
  if (useAll || provider === 'wikipedia') tasks.push(retrieveWikipedia(query, wikiOpts))
  if (useAll || provider === 'tavily') tasks.push(retrieveTavily(query))
  if (useAll || provider === 'serper') tasks.push(retrieveSerper(query))
  if (useAll || provider === 'bocha') tasks.push(retrieveBocha(query))
  if (useAll || provider === 'jina') tasks.push(retrieveJina(query))
  // 未知 provider 兜底为维基百科
  if (!tasks.length) tasks.push(retrieveWikipedia(query, wikiOpts))

  const settled = await Promise.allSettled(tasks)
  const docs: RetrievedDoc[] = []
  for (const r of settled) if (r.status === 'fulfilled') docs.push(...r.value)

  // 按 URL 去重 + 过滤过短文本
  const seen = new Set<string>()
  const out: RetrievedDoc[] = []
  const pushDocs = (arr: RetrievedDoc[]) => {
    for (const d of arr) {
      if (!d.url || seen.has(d.url)) continue
      if (!d.text || d.text.trim().length < 80) continue
      seen.add(d.url)
      out.push(d)
    }
  }
  pushDocs(docs)
  return out.slice(0, 5)
}
