// 结构化信号直采(Layer 2)：在把 HTML 拍平成纯文本【之前】，
// 直接解析页面里现成的结构化数据 —— JSON-LD / microdata / OpenGraph。
// 这些数据由网站「按设计」内嵌，精度最高、零 LLM 成本、不会幻觉。
//
// 艺术机构 / 美术馆 / 电影节 / 双年展站点大量使用 schema.org JSON-LD
// (Person / Organization / Event / ExhibitionEvent / Place...)，
// 现状管线却在拍平时把它们和 <script> 一起删掉了，白白浪费。

import * as cheerio from 'cheerio'
import type { NodeType, RelationType } from './types'
import type { ExtractedNode, ExtractedEdge } from './pageExtractor'

export interface StructuredHarvest {
  entities: ExtractedNode[]
  relations: ExtractedEdge[]
}

// schema.org @type → 我们的 NodeType。键统一小写匹配。
// 单个作品(VisualArtwork/Painting...)按既定规则不作为实体，故不收。
const SCHEMA_TYPE_MAP: Record<string, NodeType> = {
  person: 'artist',
  organization: 'institution',
  performinggroup: 'institution',
  museum: 'institution',
  galleryorganization: 'institution',
  artgallery: 'institution',
  educationalorganization: 'institution',
  collegeoruniversity: 'institution',
  ngo: 'institution',
  corporation: 'institution',
  exhibitionevent: 'exhibition',
  event: 'exhibition',
  visualartsevent: 'exhibition',
  festival: 'exhibition',
  screeningevent: 'exhibition',
  businessevent: 'venue',
  educationevent: 'venue',
  publicationevent: 'venue',
  place: 'location',
  country: 'location',
  city: 'location',
  administrativearea: 'location',
  postaladdress: 'location',
  scholarlyarticle: 'paper',
  article: 'paper',
  creativeworkseries: 'venue',
  periodical: 'venue',
  publicationissue: 'venue',
  // 作品类(影片/画作/出版物等) → work
  movie: 'work',
  film: 'work',
  videoobject: 'work',
  tvepisode: 'work',
  episode: 'work',
  visualartwork: 'work',
  painting: 'work',
  sculpture: 'work',
  drawing: 'work',
  photograph: 'work',
  book: 'work',
  musicrecording: 'work',
  creativework: 'work',
}

function typeKeys(t: unknown): string[] {
  if (Array.isArray(t)) return t.flatMap(typeKeys)
  if (typeof t !== 'string') return []
  // "http://schema.org/Person" → "person"
  return [t.split(/[\/#]/).pop()!.toLowerCase()]
}

function mapType(t: unknown): NodeType | null {
  for (const k of typeKeys(t)) {
    if (SCHEMA_TYPE_MAP[k]) return SCHEMA_TYPE_MAP[k]
  }
  return null
}

function nameOf(obj: any): string {
  if (!obj || typeof obj !== 'object') return typeof obj === 'string' ? obj.trim() : ''
  const raw = obj.name ?? obj.legalName ?? obj.headline ?? obj.title ?? obj['@id']
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim()
  return String(raw ?? '').trim()
}

/** 递归收集 JSON-LD 里所有形如实体的对象(展开 @graph / 数组 / 嵌套) */
function collectObjects(node: any, out: any[], depth = 0): void {
  if (!node || depth > 8) return
  if (Array.isArray(node)) {
    for (const n of node) collectObjects(n, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  if (Array.isArray(node['@graph'])) {
    for (const n of node['@graph']) collectObjects(n, out, depth + 1)
  }
  if (node['@type']) out.push(node)
  // 继续深入嵌套实体(如 author/location/organizer 等本身也是实体)
  for (const key of Object.keys(node)) {
    if (key === '@graph' || key.startsWith('@')) continue
    const v = node[key]
    if (v && typeof v === 'object') collectObjects(v, out, depth + 1)
  }
}

// 关系键 → RelationType：JSON-LD 里某对象引用另一对象时的语义。
const REL_PROP_MAP: Record<string, RelationType> = {
  location: 'located_in',
  contentlocation: 'located_in',
  homelocation: 'located_in',
  worklocation: 'located_in',
  address: 'located_in',
  affiliation: 'belongs_to',
  memberof: 'belongs_to',
  worksfor: 'belongs_to',
  organizer: 'curated_by',
  author: 'authored',
  performer: 'participated_in',
  contributor: 'participated_in',
  ispartof: 'belongs_to',
  publisher: 'published_in',
}

/** 从一个 JSON-LD 实体对象抽取它与其属性引用对象之间的关系 */
function relationsFrom(obj: any, selfName: string, selfType: NodeType, pageUrl: string): ExtractedEdge[] {
  const edges: ExtractedEdge[] = []
  for (const key of Object.keys(obj)) {
    const rel = REL_PROP_MAP[key.toLowerCase()]
    if (!rel) continue
    const targets = Array.isArray(obj[key]) ? obj[key] : [obj[key]]
    for (const tgt of targets) {
      const tType = mapType(tgt?.['@type'])
      const tName = nameOf(tgt)
      if (!tType || !tName || tName.toLowerCase() === selfName.toLowerCase()) continue
      edges.push({
        source: selfName,
        sourceType: selfType,
        target: tName,
        targetType: tType,
        relationship: rel,
        strength: 0.75,
        evidence: `JSON-LD: ${selfName} · ${key} · ${tName}`,
      })
    }
  }
  return edges
}

function harvestJsonLd($: cheerio.CheerioAPI, pageUrl: string): StructuredHarvest {
  const entities: ExtractedNode[] = []
  const relations: ExtractedEdge[] = []
  const seenNode = new Set<string>()

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim()
    if (!raw) return
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return // 容忍坏 JSON-LD，跳过即可
    }
    const objects: any[] = []
    collectObjects(parsed, objects)

    for (const obj of objects) {
      const nt = mapType(obj['@type'])
      const name = nameOf(obj)
      if (!nt || !name || name.length < 2 || name.startsWith('http')) continue
      const k = `${nt}::${name.toLowerCase()}`
      if (!seenNode.has(k)) {
        seenNode.add(k)
        entities.push({ name, type: nt, evidence: `JSON-LD @type=${typeKeys(obj['@type'])[0]}` })
      }
      for (const e of relationsFrom(obj, name, nt, pageUrl)) relations.push(e)
    }
  })

  return { entities, relations }
}

function harvestMicrodata($: cheerio.CheerioAPI): StructuredHarvest {
  const entities: ExtractedNode[] = []
  const seen = new Set<string>()
  $('[itemscope][itemtype]').each((_, el) => {
    const nt = mapType($(el).attr('itemtype'))
    if (!nt) return
    const nameEl = $(el).find('[itemprop="name"]').first()
    const name = (nameEl.attr('content') || nameEl.text() || '').trim()
    if (!name || name.length < 2) return
    const k = `${nt}::${name.toLowerCase()}`
    if (seen.has(k)) return
    seen.add(k)
    entities.push({ name, type: nt, evidence: 'microdata' })
  })
  return { entities, relations: [] }
}

function harvestOpenGraph($: cheerio.CheerioAPI): StructuredHarvest {
  const entities: ExtractedNode[] = []
  const ogType = ($('meta[property="og:type"]').attr('content') || '').toLowerCase()
  const ogTitle = ($('meta[property="og:title"]').attr('content') || '').trim()
  // 只在 og:type 明确是 profile/article 等可映射时收，避免噪声
  const map: Record<string, NodeType> = {
    profile: 'artist',
    'article:author': 'artist',
    'business.business': 'institution',
  }
  const nt = map[ogType]
  if (nt && ogTitle && ogTitle.length >= 2) {
    entities.push({ name: ogTitle, type: nt, evidence: `og:type=${ogType}` })
  }
  const author = ($('meta[property="article:author"], meta[name="author"]').attr('content') || '').trim()
  if (author && author.length >= 2 && !/^https?:/i.test(author)) {
    entities.push({ name: author, type: 'artist', evidence: 'meta author' })
  }
  return { entities, relations: [] }
}

/**
 * 从一页 HTML 直采所有结构化实体/关系并合并去重。
 * 输入既可是已加载的 CheerioAPI，也可是原始 html 字符串。
 */
export function harvestStructured(input: string | cheerio.CheerioAPI, pageUrl: string): StructuredHarvest {
  const $ = typeof input === 'string' ? cheerio.load(input) : input
  const parts = [harvestJsonLd($, pageUrl), harvestMicrodata($), harvestOpenGraph($)]

  const entMap = new Map<string, ExtractedNode>()
  const relMap = new Map<string, ExtractedEdge>()
  for (const p of parts) {
    for (const e of p.entities) {
      const k = `${e.type}::${e.name.toLowerCase()}`
      if (!entMap.has(k)) entMap.set(k, e)
    }
    for (const r of p.relations) {
      const k = `${r.sourceType}:${r.source.toLowerCase()}--${r.targetType}:${r.target.toLowerCase()}--${r.relationship}`
      if (!relMap.has(k)) relMap.set(k, r)
    }
  }
  return { entities: Array.from(entMap.values()), relations: Array.from(relMap.values()) }
}
