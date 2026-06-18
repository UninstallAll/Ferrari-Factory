// LLM 扩展原语(取证式)：
//   1) 先用 retriever 检索该实体的【真实资料】(默认维基百科)
//   2) 再让 LLM 只从真实资料里抽取相关实体与关系，每条必须带依据 + 出处
//   找不到真实资料就返回空(绝不让模型凭空编造)。

import OpenAI from 'openai'
import { retrieveContext, RetrievedDoc } from './retriever'
import {
  Neighbor,
  ExpansionResult,
  EntityIdentity,
  NodeType,
  RelationType,
  NODE_TYPES,
  RELATION_TYPES,
} from './types'
import { identifyEntity } from './identity'

const TYPE_LABELS: Record<string, string> = {
  artist: '艺术家',
  exhibition: '展览',
  institution: '机构',
  curator: '策展人',
  movement: '流派',
  location: '地点',
  scholar: '学者',
  paper: '论文',
  venue: '会议/期刊',
  work: '作品',
}

export function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'fake-local-key',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 240000,
  })
}

const SYSTEM_PROMPT =
  '你是知识图谱抽取专家。你只能依据用户提供的【真实资料】抽取实体与关系，' +
  '严禁补充资料中没有出现的内容，严禁凭记忆编造。只输出严格的 JSON，不要任何多余文字。'

function buildPrompt(name: string, type: string, maxNeighbors: number, context: string, docCount: number): string {
  return `下面是关于实体「${name}」(${TYPE_LABELS[type] || type}) 的若干份真实资料(来自维基百科等可核验来源，已编号)。
请【只依据这些资料】，抽取与「${name}」直接相关、且资料中确有依据的其它实体及关系，用于构建知识图谱。

返回 JSON，结构如下:
{
  "canonical": "「${name}」的规范名(优先通用英文名，没有则用原名)",
  "neighbors": [
    {
      "name": "邻居实体的规范名",
      "type": "${NODE_TYPES.join('|')}",
      "relationship": "${RELATION_TYPES.join('|')}",
      "year": 相关年份(整数)或 null,
      "strength": 0到1之间的数字(关系的重要/紧密程度),
      "evidence": "资料中能支撑该关系的一句原文或紧凑依据",
      "source": 该依据所在的资料编号(1 到 ${docCount} 的整数)
    }
  ]
}

规则:
1. 最多返回 ${maxNeighbors} 个最重要的邻居，按 strength 从高到低。
2. 只抽取资料中【确有依据】的关系；资料没有提到的实体或关系，绝对不要输出。
3. type 和 relationship 必须严格取自上面给定的枚举值。
4. relationship 描述的是 "邻居 相对于 ${name}" 的关系。
5. evidence 必须能在对应编号的资料中找到依据；source 必须是该资料的编号。
6. 只输出 JSON。

=== 真实资料 ===
${context}`
}

function identityLine(identity?: EntityIdentity | null): string {
  if (!identity) return ''
  return [
    identity.wikidataId ? `Wikidata: ${identity.wikidataId}` : '',
    identity.birthYear != null ? `born: ${identity.birthYear}` : '',
    identity.deathYear != null ? `died: ${identity.deathYear}` : '',
    identity.country ? `country: ${identity.country}` : '',
    identity.description ? `description: ${identity.description}` : '',
  ].filter(Boolean).join('; ')
}

export function normalizeType(t: string): NodeType | null {
  const k = String(t || '').toLowerCase().trim()
  return (NODE_TYPES as string[]).includes(k) ? (k as NodeType) : null
}

export function normalizeRelation(r: string): RelationType {
  const k = String(r || '').toLowerCase().trim()
  return (RELATION_TYPES as string[]).includes(k) ? (k as RelationType) : 'collaborated_with'
}

export function clamp01(n: any, fallback = 0.5): number {
  const v = typeof n === 'number' ? n : parseFloat(n)
  if (Number.isNaN(v)) return fallback
  return Math.max(0, Math.min(1, v))
}

/** 从可能含围栏/多余文字的回复中提取 JSON 对象 */
export function extractJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch (_) {
    /* fallthrough */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try {
      return JSON.parse(fence[1])
    } catch (_) {}
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch (_) {}
  }
  return null
}

function buildContext(docs: RetrievedDoc[]): string {
  return docs
    .map((d, i) => `【资料${i + 1}】${d.title}\nURL: ${d.url}\n${d.text}`)
    .join('\n\n----------\n\n')
}

export async function expandEntity(
  name: string,
  type: string,
  maxNeighbors: number
): Promise<ExpansionResult> {
  const normalizedType = normalizeType(type) || 'artist'
  const identity = await identifyEntity(name, normalizedType).catch(() => null)
  const retrievalQuery = identity?.searchTerms?.[0] || identity?.label || name
  // 1) 检索真实资料
  const docs = await retrieveContext(retrievalQuery)
  if (!docs.length) {
    // 没有真实资料：宁可不扩展，也不编造
    return { canonical: identity?.label || name, neighbors: [], docCount: 0, sources: [], identity }
  }

  const sources = docs.map((d) => ({ title: d.title, url: d.url }))
  const idLine = identityLine(identity)
  const context = `${idLine ? `【身份预检】${idLine}\n\n` : ''}${buildContext(docs)}`

  // 2) 让 LLM 只从真实资料抽取
  const client = getClient()
  const completion = await client.chat.completions.create({
    model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(name, type, maxNeighbors, context, docs.length) },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices?.[0]?.message?.content || ''
  const parsed = extractJson(raw)
  if (!parsed || !Array.isArray(parsed.neighbors)) {
    return { canonical: identity?.label || name, neighbors: [], docCount: docs.length, sources, identity }
  }

  const neighbors: Neighbor[] = []
  for (const n of parsed.neighbors) {
    if (!n || !n.name) continue
    const nt = normalizeType(n.type)
    if (!nt) continue
    const cleanName = String(n.name).trim()
    if (!cleanName) continue
    if (cleanName.toLowerCase() === name.toLowerCase()) continue

    // 把 source 编号映射回真实出处 URL；无效编号则归到主资料(仍是真实检索来的)
    const idx = Number.parseInt(n.source, 10)
    const sourceUrl =
      Number.isFinite(idx) && idx >= 1 && idx <= docs.length ? docs[idx - 1].url : docs[0].url

    neighbors.push({
      name: cleanName,
      type: nt,
      relationship: normalizeRelation(n.relationship),
      year: typeof n.year === 'number' ? n.year : null,
      strength: clamp01(n.strength, 0.5),
      evidence: typeof n.evidence === 'string' ? n.evidence.trim() : '',
      sourceUrl,
    })
  }

  neighbors.sort((a, b) => b.strength - a.strength)

  return {
    canonical:
      typeof parsed.canonical === 'string' && parsed.canonical.trim() ? parsed.canonical.trim() : identity?.label || name,
    neighbors: neighbors.slice(0, maxNeighbors),
    docCount: docs.length,
    sources,
    identity,
  }
}
