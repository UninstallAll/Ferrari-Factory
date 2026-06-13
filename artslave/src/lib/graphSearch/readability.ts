// 兜底正文提取(Layer 4)：当页面不是「重复记录列表」而是文章/履历/单内容页时，
// 用密度评分挑出主正文子树，替代旧版脆弱的固定选择器($('main, #content, ...'))。
//
// 关键差异：保留 <a href> 锚点(锚文本 + 绝对 URL)与标题层级。
// 旧版 extractText 直接丢掉链接，导致「谁链接到谁」这种关系线索在喂 LLM 前就没了。

import * as cheerio from 'cheerio'

export interface ReadableContent {
  text: string // 保结构正文：标题前缀 ## / 列表项前缀 - / 锚点附带 (url)
  links: { text: string; url: string }[]
  textLength: number
}

const CHROME_RE = /(^|[\s_-])(nav|navbar|footer|header|sidebar|side-bar|menu|breadcrumb|comment|promo|advert|\bads?\b|banner|cookie|popup|modal|share|social|related|widget)([\s_-]|$)/i

function linkDensity($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>, textLen: number): number {
  if (!textLen) return 1
  const linkTextLen = $el.find('a').text().replace(/\s+/g, ' ').trim().length
  return Math.min(1, linkTextLen / textLen)
}

function scoreNode($: cheerio.CheerioAPI, el: any): number {
  const $el = $(el)
  const text = $el.text().replace(/\s+/g, ' ').trim()
  const textLen = text.length
  if (textLen < 25) return -1

  const density = linkDensity($, $el, textLen)
  const punctuation = (text.match(/[,，.。;；:：!！?？]/g) || []).length
  const blockCount = $el.find('p, li, br').length

  let score = textLen * (1 - density) + punctuation * 3 + blockCount * 4

  const tag = (el.tagName || '').toLowerCase()
  if (tag === 'article' || tag === 'main') score *= 1.4
  else if (tag === 'section') score *= 1.1

  const cls = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`
  if (CHROME_RE.test(cls)) score *= 0.25
  if (/(content|article|main|body|post|entry|bio|profile|detail)/i.test(cls)) score *= 1.2

  return score
}

/** 把选中的主正文子树序列化为「保结构文本」，并收集所有绝对链接 */
function serialize($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, baseUrl: string): ReadableContent {
  root.find('script,style,noscript,svg,iframe,form,nav,header,footer').remove()

  const links: { text: string; url: string }[] = []
  const seenLink = new Set<string>()

  root.find('a[href]').each((_, a) => {
    const href = $(a).attr('href') || ''
    const t = $(a).text().replace(/\s+/g, ' ').trim()
    if (!t) return
    let abs: string
    try {
      abs = new URL(href, baseUrl).toString()
    } catch {
      return
    }
    if (!/^https?:/i.test(abs)) return
    // 把 URL 内联进锚文本，保留「锚文本→链接」线索给下游 LLM
    $(a).replaceWith(`${t} (${abs})`)
    const k = `${t}|${abs}`
    if (!seenLink.has(k)) {
      seenLink.add(k)
      links.push({ text: t, url: abs })
    }
  })

  // 标题层级 / 列表项加结构标记
  root.find('h1,h2,h3,h4,h5,h6').each((_, h) => {
    const t = $(h).text().replace(/\s+/g, ' ').trim()
    if (t) $(h).replaceWith(`\n\n## ${t}\n`)
  })
  root.find('li').each((_, li) => {
    const t = $(li).text().replace(/\s+/g, ' ').trim()
    if (t) $(li).replaceWith(`\n- ${t}`)
  })

  const text = root
    .text()
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, links, textLength: text.length }
}

/**
 * 从一页 HTML 提取主正文(保结构 + 保链接)。
 * 评分挑出最佳子树；若全页都很稀薄则回退到 body。
 */
export function extractReadable($: cheerio.CheerioAPI, baseUrl: string): ReadableContent {
  const work = cheerio.load($.html())
  let best: any = null
  let bestScore = 0

  work('article, main, section, div, td').each((_, el) => {
    const s = scoreNode(work, el)
    if (s > bestScore) {
      bestScore = s
      best = el
    }
  })

  const root = best ? work(best) : work('body')
  return serialize(work, root, baseUrl)
}
