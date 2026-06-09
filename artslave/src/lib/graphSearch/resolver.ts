// 起点实体解析：把多模态输入(文本/链接/PDF/图片) 统一解析成 {seedName, seedType}
// 走 OpenAI 兼容接口(当前指向本地假 API → Codex，支持视觉)

import OpenAI from 'openai'
import { NodeType, NODE_TYPES } from './types'

export type ResolveInput =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }
  | { kind: 'pdf'; dataBase64: string; filename?: string }
  | { kind: 'image'; dataUrl: string; filename?: string }

export interface ResolvedSeed {
  seedName: string
  seedType: NodeType
  summary: string
  source: ResolveInput['kind']
}

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'fake-local-key',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: 240000,
  })
}

const SYSTEM_PROMPT =
  '你是艺术史与学术领域的实体识别专家。只输出严格的 JSON，不要任何多余文字或解释。'

function buildInstruction(extra: string): string {
  return `从下面的内容中识别出最核心的一个实体(用于构建知识图谱的起点)。${extra}

返回 JSON:
{
  "name": "该实体的规范名(优先通用英文名，没有则用原名)",
  "type": "${NODE_TYPES.join('|')}",
  "summary": "一句话说明这是什么、为什么是核心实体"
}

规则:
1. type 必须严格取自上面给定的枚举值。
2. 只识别一个最主要的实体。
3. 只输出 JSON。`
}

function normalizeType(t: string): NodeType {
  const k = String(t || '').toLowerCase().trim()
  return (NODE_TYPES as string[]).includes(k) ? (k as NodeType) : 'artist'
}

function extractJson(text: string): any {
  if (!text) return null
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

/** 抓取网页正文(粗提取：去脚本/样式/标签，取 title + meta + 正文前若干字符) */
async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArtSlaveBot/1.0)' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
  const html = await res.text()
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim()
  const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim()
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [
    title && `标题: ${title}`,
    ogTitle && ogTitle !== title && `OG标题: ${ogTitle}`,
    desc && `描述: ${desc}`,
    `正文片段: ${body.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 解析 PDF base64 → 文本 */
async function parsePdf(dataBase64: string): Promise<string> {
  // 引用 lib 子路径，规避 pdf-parse 顶层 index.js 在导入时读取测试文件的 debug 行为
  // @ts-expect-error pdf-parse 无该子路径的类型声明
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as (b: Buffer) => Promise<{ text: string }>
  const clean = dataBase64.replace(/^data:application\/pdf;base64,/, '')
  const buf = Buffer.from(clean, 'base64')
  const out = await pdfParse(buf)
  return (out.text || '').replace(/\s+\n/g, '\n').trim()
}

/** 文本类输入(text/url/pdf) 走纯文本识别 */
async function resolveText(content: string, extra: string, source: ResolveInput['kind']): Promise<ResolvedSeed> {
  const client = getClient()
  const completion = await client.chat.completions.create({
    model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${buildInstruction(extra)}\n\n=== 内容 ===\n${content.slice(0, 6000)}` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })
  const parsed = extractJson(completion.choices?.[0]?.message?.content || '')
  if (!parsed || !parsed.name) throw new Error('无法从内容中识别出实体')
  return {
    seedName: String(parsed.name).trim(),
    seedType: normalizeType(parsed.type),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    source,
  }
}

/** 图片输入走多模态(image_url) → Codex 视觉 */
async function resolveImage(dataUrl: string): Promise<ResolvedSeed> {
  const client = getClient()
  const completion = await client.chat.completions.create({
    model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildInstruction('内容是一张图片(可能是作品、海报、展览现场、人物或截图)，请识别画面中最核心的艺术/学术实体。') },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })
  const parsed = extractJson(completion.choices?.[0]?.message?.content || '')
  if (!parsed || !parsed.name) throw new Error('无法从图片中识别出实体')
  return {
    seedName: String(parsed.name).trim(),
    seedType: normalizeType(parsed.type),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    source: 'image',
  }
}

export async function resolveSeed(input: ResolveInput): Promise<ResolvedSeed> {
  switch (input.kind) {
    case 'text': {
      const t = (input.text || '').trim()
      if (!t) throw new Error('文本为空')
      // 纯名字也走一次 LLM，拿到规范名 + 自动判别类型
      return resolveText(t, '内容是用户直接输入的实体名或一句描述。', 'text')
    }
    case 'url': {
      const text = await fetchUrlText(input.url)
      return resolveText(text, '内容是一个网页的文本片段，请识别该网页主要讲述的核心实体。', 'url')
    }
    case 'pdf': {
      const text = await parsePdf(input.dataBase64)
      if (!text) throw new Error('PDF 中未提取到文字(可能是扫描件，建议改用图片上传)')
      return resolveText(text, '内容是一份 PDF 文档的文本，请识别其核心实体(如论文作者/主题、展览、机构等)。', 'pdf')
    }
    case 'image': {
      if (!/^data:image\//.test(input.dataUrl)) throw new Error('无效的图片数据')
      return resolveImage(input.dataUrl)
    }
    default:
      throw new Error('不支持的输入类型')
  }
}
