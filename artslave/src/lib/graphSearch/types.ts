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
  evidence: string
}

export interface ExpansionResult {
  canonical: string
  neighbors: Neighbor[]
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
export function canonicalKey(type: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // 去重音
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_') // 非字母数字中文→_
    .replace(/^_+|_+$/g, '')
  return `${type}:${slug}`
}
