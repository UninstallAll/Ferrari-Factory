// 外部后端兜底：Firecrawl /extract —— 给 URL + 一句自然语言目标，由 Firecrawl 自爬全站并返回结构化数据。
// 仅在配置 FIRECRAWL_API_KEY 时启用；未配置则返回空(由 engine 提示并回退)。
// 难站(重 JS / 强反爬 / 站点结构怪)时作为自研智能下钻的兜底路径。
//
// 注：Firecrawl 也提供 MCP server，可"嫁接到 LLM"；但 App 运行时直连 HTTP /extract 更简单，故此处走 HTTP。

import type { CrawledPage } from './crawler'
import type { ExtractedNode, ExtractedEdge } from './pageExtractor'
import type { StructuredHarvest } from './structured'
import { normalizeType, normalizeRelation, clamp01 } from './llmExpander'

const FIRECRAWL_BASE = (process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev').replace(/\/$/, '')

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', description: 'artist|exhibition|institution|curator|movement|location|scholar|paper|venue|work' },
          role: { type: 'string' },
          relatedTo: { type: 'string', description: '相关实体名(如影片的导演、所属活动)' },
          relation: { type: 'string', description: 'participated_in|exhibited_at|located_in|belongs_to|authored|curated_by 等' },
          evidence: { type: 'string' },
        },
        required: ['name', 'type'],
      },
    },
  },
  required: ['entities'],
}

interface FirecrawlEntity {
  name?: string
  type?: string
  role?: string
  relatedTo?: string
  relation?: string
  evidence?: string
}

function mapEntities(entities: FirecrawlEntity[], sourceUrl: string): StructuredHarvest {
  const nodes: ExtractedNode[] = []
  const edges: ExtractedEdge[] = []
  for (const e of entities) {
    if (!e || !e.name) continue
    const nt = normalizeType(e.type || '') || 'work'
    const name = String(e.name).trim()
    if (name.length < 2) continue
    nodes.push({ name, type: nt, evidence: (e.evidence || e.role || `Firecrawl @ ${sourceUrl}`).slice(0, 200) })
    if (e.relatedTo && String(e.relatedTo).trim().length >= 2) {
      const target = String(e.relatedTo).trim()
      nodes.push({ name: target, type: 'institution', evidence: `${name} 关联` })
      edges.push({
        source: name,
        sourceType: nt,
        target,
        targetType: 'institution',
        relationship: normalizeRelation(e.relation || 'participated_in'),
        strength: clamp01(0.6, 0.6),
        evidence: (e.evidence || '').slice(0, 200),
      })
    }
  }
  return { entities: nodes, relations: edges }
}

async function startExtract(key: string, urls: string[], goal: string): Promise<string | null> {
  const res = await fetch(`${FIRECRAWL_BASE}/v1/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: urls.map((u) => u.replace(/\/$/, '') + '/*'), // /* 让 Firecrawl 在该站内爬取
      prompt: goal || '抽取该站点中与艺术/电影节相关的所有实体(影片=work、导演/艺术家=artist、机构、活动、地点)及其关系。',
      schema: EXTRACT_SCHEMA,
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const j = await res.json()
  return j?.id || null
}

async function pollExtract(key: string, id: string, maxMs = 180000): Promise<FirecrawlEntity[]> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const res = await fetch(`${FIRECRAWL_BASE}/v1/extract/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const j = await res.json()
      if (j?.status === 'completed') return j?.data?.entities || []
      if (j?.status === 'failed' || j?.status === 'cancelled') return []
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  return []
}

/**
 * 用 Firecrawl /extract 抓取并返回结构化结果(打包成单个 CrawledPage，结构化数据放在 structured)。
 * 未配置 FIRECRAWL_API_KEY → 返回 []。
 */
export async function externalCrawl(
  seedUrls: string[],
  goal: string | null | undefined,
  log?: (message: string, level?: string) => Promise<void>
): Promise<CrawledPage[]> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    if (log) await log('未配置 FIRECRAWL_API_KEY，无法使用 Firecrawl 兜底（请改用 agentic 后端或配置 key）', 'error')
    return []
  }
  if (log) await log(`Firecrawl /extract 启动：目标=${goal || '(未指定)'}`, 'step')

  try {
    const id = await startExtract(key, seedUrls, goal || '')
    if (!id) {
      if (log) await log('Firecrawl 启动失败', 'error')
      return []
    }
    if (log) await log(`Firecrawl 任务 ${id} 运行中，等待结果…`, 'llm')
    const entities = await pollExtract(key, id)
    if (!entities.length) {
      if (log) await log('Firecrawl 未返回实体', 'warn')
      return []
    }
    const structured = mapEntities(entities, seedUrls[0])
    if (log) await log(`Firecrawl 返回 ${structured.entities.length} 实体 / ${structured.relations.length} 关系`, 'success')
    return [
      {
        url: seedUrls[0],
        title: 'Firecrawl extract',
        text: '',
        html: '',
        structured,
        records: [],
        recordType: 'work',
        links: [],
      },
    ]
  } catch (err) {
    if (log) await log(`Firecrawl 兜底失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return []
  }
}
