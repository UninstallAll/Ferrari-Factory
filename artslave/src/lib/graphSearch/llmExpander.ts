// LLM 扩展原语：给定实体 → 返回结构化的邻居+关系
// 走 OpenAI 兼容接口(当前指向本地假 API → Codex)

import OpenAI from 'openai'
import {
  Neighbor,
  ExpansionResult,
  NodeType,
  RelationType,
  NODE_TYPES,
  RELATION_TYPES,
} from './types'

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'fake-local-key',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 240000, // Codex 调用慢，给足超时
  })
}

const SYSTEM_PROMPT =
  '你是艺术史与学术领域的知识图谱专家。只输出严格的 JSON，不要任何多余文字或解释。优先给出真实、可核实的关系，避免编造。'

function buildPrompt(name: string, type: string, maxNeighbors: number): string {
  return `给定一个实体，列出与它直接相关、最重要的实体及关系，用于构建知识图谱。

实体: ${name} (${type})

返回 JSON，结构如下:
{
  "canonical": "该实体的规范名(优先通用英文名，没有则用原名)",
  "neighbors": [
    {
      "name": "邻居实体的规范名",
      "type": "${NODE_TYPES.join('|')}",
      "relationship": "${RELATION_TYPES.join('|')}",
      "year": 相关年份(整数)或 null,
      "strength": 0到1之间的数字(关系的重要/紧密程度),
      "evidence": "一句话依据"
    }
  ]
}

规则:
1. 最多返回 ${maxNeighbors} 个最重要的邻居，按 strength 从高到低。
2. type 和 relationship 必须严格取自上面给定的枚举值。
3. relationship 描述的是 "邻居 相对于 ${name}" 的关系。
4. 只输出 JSON。`
}

function normalizeType(t: string): NodeType | null {
  const k = String(t || '').toLowerCase().trim()
  return (NODE_TYPES as string[]).includes(k) ? (k as NodeType) : null
}

function normalizeRelation(r: string): RelationType {
  const k = String(r || '').toLowerCase().trim()
  return (RELATION_TYPES as string[]).includes(k)
    ? (k as RelationType)
    : 'collaborated_with'
}

function clamp01(n: any, fallback = 0.5): number {
  const v = typeof n === 'number' ? n : parseFloat(n)
  if (Number.isNaN(v)) return fallback
  return Math.max(0, Math.min(1, v))
}

/** 从可能含围栏/多余文字的回复中提取 JSON 对象 */
function extractJson(text: string): any {
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

export async function expandEntity(
  name: string,
  type: string,
  maxNeighbors: number
): Promise<ExpansionResult> {
  const client = getClient()
  const completion = await client.chat.completions.create({
    model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(name, type, maxNeighbors) },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices?.[0]?.message?.content || ''
  const parsed = extractJson(raw)
  if (!parsed || !Array.isArray(parsed.neighbors)) {
    return { canonical: name, neighbors: [] }
  }

  const neighbors: Neighbor[] = []
  for (const n of parsed.neighbors) {
    if (!n || !n.name) continue
    const nt = normalizeType(n.type)
    if (!nt) continue // 类型无法识别就丢弃
    const cleanName = String(n.name).trim()
    if (!cleanName) continue
    // 避免邻居就是自己
    if (cleanName.toLowerCase() === name.toLowerCase()) continue
    neighbors.push({
      name: cleanName,
      type: nt,
      relationship: normalizeRelation(n.relationship),
      year: typeof n.year === 'number' ? n.year : null,
      strength: clamp01(n.strength, 0.5),
      evidence: typeof n.evidence === 'string' ? n.evidence.trim() : '',
    })
  }

  // 按强度排序并截断
  neighbors.sort((a, b) => b.strength - a.strength)

  return {
    canonical: typeof parsed.canonical === 'string' && parsed.canonical.trim() ? parsed.canonical.trim() : name,
    neighbors: neighbors.slice(0, maxNeighbors),
  }
}
