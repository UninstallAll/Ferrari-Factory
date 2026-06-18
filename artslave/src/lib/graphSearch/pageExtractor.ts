// 从"真实网页正文"批量抽取实体与关系(用于深度搜索的爬取模式)。
// 与 llmExpander 不同：这里输入已经是抓到的真实正文，直接从中抽取多个实体，
// 出处=该页面 URL。严禁编造，只抽正文里确有依据的内容。

import {
  NodeType,
  RelationType,
  NODE_TYPES,
  RELATION_TYPES,
} from './types'
import { getClient, extractJson, normalizeType, normalizeRelation, clamp01 } from './llmExpander'

export interface ExtractedNode {
  name: string
  type: NodeType
  evidence?: string
}

export interface ExtractedEdge {
  source: string
  sourceType: NodeType
  target: string
  targetType: NodeType
  relationship: RelationType
  strength: number
  evidence?: string
}

export interface PageExtraction {
  nodes: ExtractedNode[]
  edges: ExtractedEdge[]
}

const SYSTEM_PROMPT =
  '你是知识图谱抽取专家。你只能依据用户提供的【真实网页正文】抽取实体与关系，' +
  '严禁补充正文中没有出现的内容，严禁凭记忆编造。只输出严格的 JSON，不要任何多余文字。'

function buildPrompt(text: string, url: string, maxEntities: number, goal?: string): string {
  const goalLine = goal
    ? `\n【本次目标】请优先抽取与「${goal}」相关的实体(尤其影片/作品用 type=work、导演/艺术家用 type=artist)。\n`
    : ''
  return `下面是从一个真实网页抓取的正文(常见为艺术机构/电影节的作品目录、片单、履历页)。
请【只依据这段正文】，抽取与艺术/学术相关的【实体】，以及它们之间在正文里确有依据的【关系】，用于构建知识图谱。
${goalLine}
返回 JSON，结构如下:
{
  "entities": [
    { "name": "实体规范名(优先英文/原名)", "type": "${NODE_TYPES.join('|')}", "evidence": "正文中的依据片段" }
  ],
  "relations": [
    {
      "source": "源实体名", "sourceType": "${NODE_TYPES.join('|')}",
      "target": "目标实体名", "targetType": "${NODE_TYPES.join('|')}",
      "relationship": "${RELATION_TYPES.join('|')}",
      "strength": 0到1之间的数字, "evidence": "正文依据片段"
    }
  ]
}

抽取重点与规则:
1. 重点实体：艺术家/导演(artist)、活动或展览(exhibition)、机构/美术馆/画廊(institution)、电影节/双年展/期刊/会议(venue)、国家或城市(location)、流派(movement)、策展人(curator)、学者(scholar)。
2. 影片/画作/出版物等【作品】用 type=work 抽取(尤其与目标相关的影片)；同时关注人、机构、活动、地点。忽略导航/页脚等无关条目。
3. 典型关系：艺术家 participated_in 该目录所属的活动/展览；艺术家 exhibited_at 履历里提到的机构/电影节；艺术家 located_in 其国家/城市。
4. 只抽取正文中【确有依据】的；正文没提到的实体或关系绝对不要输出。
5. type 与 relationship 必须严格取自上面的枚举值。
6. 最多 ${maxEntities} 个实体，挑最重要的。只输出 JSON。

=== 网页正文(来源 URL: ${url}) ===
${text}`
}

function chunkText(text: string, chunkSize: number, maxChunks: number): string[] {
  if (text.length <= chunkSize) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}

async function extractChunk(text: string, url: string, maxEntities: number, goal?: string): Promise<PageExtraction> {
  const client = getClient()
  const completion = await client.chat.completions.create({
    model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(text, url, maxEntities, goal) },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices?.[0]?.message?.content || ''
  const parsed = extractJson(raw)
  const nodes: ExtractedNode[] = []
  const edges: ExtractedEdge[] = []
  if (!parsed) return { nodes, edges }

  for (const e of Array.isArray(parsed.entities) ? parsed.entities : []) {
    if (!e || !e.name) continue
    const nt = normalizeType(e.type)
    if (!nt) continue
    const name = String(e.name).trim()
    if (!name) continue
    nodes.push({ name, type: nt, evidence: typeof e.evidence === 'string' ? e.evidence.trim() : '' })
  }

  for (const r of Array.isArray(parsed.relations) ? parsed.relations : []) {
    if (!r || !r.source || !r.target) continue
    const st = normalizeType(r.sourceType)
    const tt = normalizeType(r.targetType)
    if (!st || !tt) continue
    const source = String(r.source).trim()
    const target = String(r.target).trim()
    if (!source || !target || source.toLowerCase() === target.toLowerCase()) continue
    edges.push({
      source,
      sourceType: st,
      target,
      targetType: tt,
      relationship: normalizeRelation(r.relationship),
      strength: clamp01(r.strength, 0.6),
      evidence: typeof r.evidence === 'string' ? r.evidence.trim() : '',
    })
  }

  return { nodes, edges }
}

/** 从单页正文抽取实体/关系(必要时分块抽取再合并) */
export async function extractPageGraph(
  text: string,
  url: string,
  maxEntities = 22,
  goal?: string
): Promise<PageExtraction> {
  // 正文来自 readability(已保留标题层级与「锚文本 (url)」链接)。
  // 放宽截断：长文章最多分 4 块(约 32K 字符)，不再被旧的 16K 上限砍掉后半段。
  const maxChunks = Number(process.env.EXTRACT_MAX_CHUNKS) || 4
  const chunks = chunkText(text, 8000, maxChunks)
  const nodeMap = new Map<string, ExtractedNode>()
  const edgeMap = new Map<string, ExtractedEdge>()

  for (const chunk of chunks) {
    const part = await extractChunk(chunk, url, maxEntities, goal)
    for (const n of part.nodes) {
      const k = `${n.type}::${n.name.toLowerCase()}`
      if (!nodeMap.has(k)) nodeMap.set(k, n)
    }
    for (const e of part.edges) {
      const k = `${e.sourceType}:${e.source.toLowerCase()}--${e.targetType}:${e.target.toLowerCase()}--${e.relationship}`
      if (!edgeMap.has(k)) edgeMap.set(k, e)
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) }
}
