// DeepSearch (知识图谱滚雪球搜索) 类型定义 —— 干净重写版

export type NodeType =
  | 'artist'
  | 'exhibition'
  | 'institution'
  | 'curator'
  | 'movement'
  | 'location'
  | 'scholar'
  | 'paper'
  | 'venue' // 会议/期刊

export type RelationType =
  | 'participated_in'
  | 'collaborated_with'
  | 'exhibited_at'
  | 'curated_by'
  | 'influenced_by'
  | 'contemporary_of'
  | 'located_in'
  | 'belongs_to'
  | 'authored'
  | 'published_in'

export const NODE_TYPES: NodeType[] = [
  'artist', 'exhibition', 'institution', 'curator', 'movement', 'location', 'scholar', 'paper', 'venue',
]

export const RELATION_TYPES: RelationType[] = [
  'participated_in', 'collaborated_with', 'exhibited_at', 'curated_by', 'influenced_by',
  'contemporary_of', 'located_in', 'belongs_to', 'authored', 'published_in',
]

// LLM 扩展原语：给一个实体，返回它的邻居
export interface Neighbor {
  name: string
  type: NodeType
  relationship: RelationType
  year: number | null
  strength: number // 0-1
  evidence: string // 来自真实资料的原文/依据片段
  sourceUrl?: string | null // 该关系的真实出处链接(可核验)
}

export interface ExpansionResult {
  canonical: string
  neighbors: Neighbor[]
  docCount?: number // 本次命中的真实资料篇数
  sources?: { title: string; url: string }[] // 本次使用的真实资料出处
  identity?: EntityIdentity | null
}

export interface EntityIdentity {
  wikidataId?: string
  label?: string
  description?: string
  birthYear?: number | null
  deathYear?: number | null
  country?: string | null
  occupations?: string[]
  aliases?: string[]
  url?: string
  score?: number
}

// 内存中的图结构(引擎运行时用)
export interface GraphNodeData {
  key: string // 去重键 type:slug
  name: string
  type: NodeType
  depth: number
  relevanceScore: number
  discoveryCount: number
  parentKey?: string
  year?: number | null
  evidence?: string
  sourceUrl?: string | null // 首次发现该节点时的真实出处
  identity?: EntityIdentity | null
  // 以下为后处理计算
  degree: number
  pagerank: number
  importance: number
}

export interface GraphEdgeData {
  sourceKey: string
  targetKey: string
  type: RelationType
  weight: number
  confidence: number
  evidence: string[]
}

export interface SearchConfig {
  maxDepth: number
  maxPerLevel: number
  maxNeighborsPerNode: number
  globalNodeCap: number
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  maxDepth: 2,
  maxPerLevel: 6,
  maxNeighborsPerNode: 8,
  globalNodeCap: 150,
}

// 生成规范去重键
export function slugName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // 去重音
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_') // 非字母数字中文→_
    .replace(/^_+|_+$/g, '')
}

// 生成规范去重键。若带 Wikidata/生卒年/国籍等身份信息，则纳入消歧符，避免同名实体被错误合并。
export function canonicalKey(type: string, name: string, identity?: EntityIdentity | null): string {
  const slug = slugName(name)
  const suffixParts: string[] = []
  if (identity?.wikidataId) {
    suffixParts.push(identity.wikidataId.toLowerCase())
  } else {
    if (identity?.birthYear != null) suffixParts.push(`b${identity.birthYear}`)
    if (identity?.deathYear != null) suffixParts.push(`d${identity.deathYear}`)
    if (identity?.country) suffixParts.push(slugName(identity.country))
  }
  return `${type}:${suffixParts.length ? `${slug}__${suffixParts.join('_')}` : slug}`
}

export function canonicalKeyBase(type: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // 去重音
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_') // 非字母数字中文→_
    .replace(/^_+|_+$/g, '')
  return `${type}:${slug}`
}
