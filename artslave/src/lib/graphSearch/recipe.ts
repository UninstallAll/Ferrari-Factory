// 抽取配方(Layer 3 + Layer 0)：把「结构识别」与「逐页抽取」彻底分离。
//
//   Phase A(每站一次, 缓存): 把列表页的 HTML【结构骨架】喂给 LLM，让它一次性推断出
//     「重复记录的选择器 + 记录内各字段的选择器 + 翻页方式 + 记录代表的实体类型」= 一份"配方"。
//   Phase B(逐页, 零 LLM): 用 cheerio 确定性套用配方 → 结构化记录 → 节点/边。
//
// 好处：不再让 LLM 从拍平的文本里反复猜结构 → 不截断、不幻觉、逐页零成本；
//       同站第二次直接命中缓存配方，跳过 Phase A。未知 URL 推断一次后即转已知。

import * as cheerio from 'cheerio'
import { prisma } from '@/lib/prisma'
import type { NodeType, RelationType } from './types'
import type { ExtractedNode, ExtractedEdge } from './pageExtractor'
import { getClient, extractJson, normalizeType } from './llmExpander'
import type { FetchedPage } from './render'

export interface FieldSel {
  selector: string // 相对 record 的 CSS；":self" 表示记录元素自身
  attr?: string // 取哪个属性；缺省/"text" 取文本，"href"/"src" 会转绝对 URL
}

export type PaginationType = 'query' | 'path' | 'rel-next' | 'next-text' | 'none'

export interface PaginationSpec {
  type: PaginationType
  param?: string // query: 参数名(page/offset)
  selector?: string // rel-next/next-text: 下一页链接选择器
  pathTemplate?: string // path: 形如 "/artists/page/{n}"
}

export interface ExtractionRecipe {
  origin: string
  urlPattern: string
  recordSelector: string | null
  recordType: NodeType
  fields: {
    name?: FieldSel
    link?: FieldSel
    role?: FieldSel
    date?: FieldSel
    location?: FieldSel
    institution?: FieldSel
    description?: FieldSel
  }
  pagination: PaginationSpec
  needsJs: boolean
  sampleUrl?: string
}

export interface StructuredRecord {
  name: string
  link?: string
  role?: string
  date?: string
  location?: string
  institution?: string
  description?: string
}

// ---------------- 站点键 ----------------

/**
 * 配方键：origin + 归一化路径(去掉结尾分页段/页码与尾斜杠)。
 * 用完整路径而非首个路径段——否则带语言前缀的站点(/en/...)会把全站塌缩成一个配方，
 * 导致主页的"非列表"配方污染所有子页。分页变体(?page=2、/page/2、/2)归并到同一键。
 */
export function recipeKeyFor(url: string): { origin: string; urlPattern: string } {
  try {
    const u = new URL(url)
    const path = u.pathname
      .replace(/\/page\/\d+\/?$/i, '') // /page/2 翻页段
      .replace(/\/\d+\/?$/i, '') // 结尾纯数字页码/ID
      .replace(/\/+$/, '') // 去尾斜杠
    return { origin: u.origin, urlPattern: path || '/' }
  } catch {
    return { origin: url, urlPattern: '/' }
  }
}

// ---------------- Phase B：确定性套用 ----------------

function resolveAbs(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

function readField($rec: cheerio.Cheerio<any>, f: FieldSel | undefined, baseUrl: string): string {
  if (!f || !f.selector) return ''
  const target = f.selector === ':self' || f.selector === '.' ? $rec : $rec.find(f.selector).first()
  if (!target.length) return ''
  if (f.attr && f.attr !== 'text') {
    const v = (target.attr(f.attr) || '').trim()
    return f.attr === 'href' || f.attr === 'src' ? resolveAbs(v, baseUrl) : v
  }
  return target.text().replace(/\s+/g, ' ').trim()
}

/** 套用配方，从一页抽出结构化记录(确定性、无 LLM、不截断) */
export function applyRecipe($: cheerio.CheerioAPI, recipe: ExtractionRecipe, baseUrl: string): StructuredRecord[] {
  if (!recipe.recordSelector) return []
  const records: StructuredRecord[] = []
  $(recipe.recordSelector).each((_, el) => {
    const $rec = $(el)
    const name = readField($rec, recipe.fields.name, baseUrl)
    if (!name || name.length < 2) return
    records.push({
      name,
      link: readField($rec, recipe.fields.link, baseUrl) || undefined,
      role: readField($rec, recipe.fields.role, baseUrl) || undefined,
      date: readField($rec, recipe.fields.date, baseUrl) || undefined,
      location: readField($rec, recipe.fields.location, baseUrl) || undefined,
      institution: readField($rec, recipe.fields.institution, baseUrl) || undefined,
      description: readField($rec, recipe.fields.description, baseUrl) || undefined,
    })
  })
  return records
}

/** 按 role 关键词微调记录的实体类型(确定性，不调 LLM) */
function refineType(base: NodeType, role?: string): NodeType {
  const r = (role || '').toLowerCase()
  if (/curator|策展/.test(r)) return 'curator'
  if (/scholar|professor|researcher|学者|教授|研究员/.test(r)) return 'scholar'
  if (/gallery|museum|institution|机构|美术馆|画廊|基金会/.test(r)) return 'institution'
  return base
}

/** 把结构化记录确定性映射成图谱节点/边 */
export function recordsToGraph(
  records: StructuredRecord[],
  recordType: NodeType,
  pageUrl: string
): { nodes: ExtractedNode[]; edges: ExtractedEdge[] } {
  const nodes: ExtractedNode[] = []
  const edges: ExtractedEdge[] = []
  const pushNode = (name: string, type: NodeType, evidence: string): boolean => {
    if (!name || name.trim().length < 2) return false
    nodes.push({ name: name.trim(), type, evidence })
    return true
  }

  for (const r of records) {
    const rt = refineType(recordType, r.role)
    const evidence =
      [r.role, r.date, r.description].filter(Boolean).join(' · ').slice(0, 200) || `列表记录 @ ${pageUrl}`
    if (!pushNode(r.name, rt, evidence)) continue

    if (r.institution) {
      pushNode(r.institution, 'institution', `${r.name} 关联机构`)
      edges.push({
        source: r.name,
        sourceType: rt,
        target: r.institution,
        targetType: 'institution',
        relationship: 'exhibited_at' as RelationType,
        strength: 0.6,
        evidence,
      })
    }
    if (r.location) {
      pushNode(r.location, 'location', `${r.name} 关联地点`)
      edges.push({
        source: r.name,
        sourceType: rt,
        target: r.location,
        targetType: 'location',
        relationship: 'located_in' as RelationType,
        strength: 0.55,
        evidence,
      })
    }
  }
  return { nodes, edges }
}

// ---------------- Phase A：HTML 骨架 + LLM 推断 ----------------

const SKELETON_SKIP = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'iframe', 'link', 'meta', 'br', 'source', 'picture',
])

function sigOf($: cheerio.CheerioAPI, el: any): string {
  const tag = (el.tagName || '').toLowerCase()
  const cls = ($(el).attr('class') || '').split(/\s+/).filter(Boolean).sort().join('.')
  return tag + (cls ? '.' + cls : '')
}

/**
 * 构造 HTML 结构骨架：保留 tag/class/id + 短文本样本 + 关键属性，
 * 并把【连续重复的兄弟节点折叠到 2 个示例 + 计数】——让 LLM 看清"模式"而非整页内容(省 token)。
 */
export function buildSkeleton($: cheerio.CheerioAPI, maxChars = 12000): string {
  const out: string[] = []
  let used = 0
  const root = ($('body')[0] as any) || ($.root()[0] as any)

  const walk = (el: any, depth: number) => {
    if (used > maxChars) return
    const tag = (el.tagName || '').toLowerCase()
    if (!tag || SKELETON_SKIP.has(tag)) return
    const $el = $(el)

    const id = $el.attr('id')
    const cls = ($el.attr('class') || '').split(/\s+/).filter(Boolean).slice(0, 4)
    let attrHint = ''
    if (tag === 'a') {
      const h = $el.attr('href')
      if (h) attrHint = ` href="${h.slice(0, 50)}"`
    } else if (tag === 'img') {
      attrHint = ' [img]'
    } else if (tag === 'time') {
      const dt = $el.attr('datetime')
      if (dt) attrHint = ` datetime="${dt}"`
    }
    const ownText = $el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim().slice(0, 40)
    const indent = '  '.repeat(Math.min(depth, 14))
    const line =
      `${indent}<${tag}${id ? '#' + id : ''}${cls.length ? '.' + cls.join('.') : ''}${attrHint}>` +
      (ownText ? ` "${ownText}"` : '')
    out.push(line)
    used += line.length + 1

    // 子节点：连续相同签名的折叠
    const children = $el.children().toArray()
    let i = 0
    while (i < children.length && used <= maxChars) {
      const s = sigOf($, children[i])
      let j = i
      while (j < children.length && sigOf($, children[j]) === s) j++
      const run = children.slice(i, j)
      const reps = run.slice(0, 2)
      for (const c of reps) walk(c, depth + 1)
      if (run.length > 2) {
        const marker = `${'  '.repeat(Math.min(depth + 1, 14))}… ×${run.length} (重复 ${s})`
        out.push(marker)
        used += marker.length + 1
      }
      i = j
    }
  }

  if (root) walk(root, 0)
  return out.join('\n').slice(0, maxChars)
}

const RECIPE_SYSTEM =
  '你是网页结构分析专家。给你一段网页的【结构骨架】(标签/类名/id + 文本样本，重复块已折叠)。' +
  '请判断它是否是「重复记录列表页」，并给出用 CSS 选择器抽取这些记录及其字段的方案。只输出严格 JSON。'

function buildRecipePrompt(skeleton: string, url: string, feedback?: string): string {
  return `下面是网页(${url})的结构骨架。请分析它的版式并给出"抽取配方"。

返回 JSON：
{
  "recordSelector": "选中每一条重复记录的 CSS 选择器；若本页不是列表(是单篇文章/履历)则为 null",
  "recordType": "每条记录代表的实体类型，取自: artist|exhibition|institution|curator|movement|location|scholar|paper|venue",
  "fields": {
    "name": { "selector": "记录内取名称的 CSS(相对记录)，记录自身用 ':self'", "attr": "text 或 href 等" },
    "link": { "selector": "a", "attr": "href" },
    "role":        { "selector": "...", "attr": "text" },
    "date":        { "selector": "...", "attr": "text" },
    "location":    { "selector": "...", "attr": "text" },
    "institution": { "selector": "...", "attr": "text" },
    "description": { "selector": "...", "attr": "text" }
  },
  "pagination": {
    "type": "query|path|rel-next|next-text|none",
    "param": "query 翻页的参数名(如 page)",
    "selector": "rel-next/next-text 的下一页链接选择器",
    "pathTemplate": "path 翻页的模板，如 /artists/page/{n}"
  }
}

规则：
1. recordSelector 必须能选中页面上【多条】同构记录(如艺术家卡片/列表项)；只有真的不是列表才返回 null。
2. fields 里没有的字段就省略；name 是必需的。选择器尽量稳健(优先 class，避免依赖具体文本)。
3. 字段选择器相对每条记录；取链接/图片用 attr=href/src。
4. recordType 必须取自给定枚举。${feedback ? '\n5. 上次尝试反馈：' + feedback : ''}

只输出 JSON。

=== 结构骨架 ===
${skeleton}`
}

function parseRecipeJson(parsed: any): Omit<ExtractionRecipe, 'origin' | 'urlPattern' | 'needsJs' | 'sampleUrl'> | null {
  if (!parsed || typeof parsed !== 'object') return null
  const recordSelector =
    typeof parsed.recordSelector === 'string' && parsed.recordSelector.trim() ? parsed.recordSelector.trim() : null
  const recordType = normalizeType(parsed.recordType) || 'artist'

  const fields: ExtractionRecipe['fields'] = {}
  const fsrc = parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {}
  for (const key of ['name', 'link', 'role', 'date', 'location', 'institution', 'description'] as const) {
    const f = fsrc[key]
    if (f && typeof f === 'object' && typeof f.selector === 'string' && f.selector.trim()) {
      fields[key] = { selector: f.selector.trim(), attr: typeof f.attr === 'string' ? f.attr.trim() : undefined }
    }
  }

  const p = parsed.pagination && typeof parsed.pagination === 'object' ? parsed.pagination : {}
  const ptype: PaginationType = ['query', 'path', 'rel-next', 'next-text', 'none'].includes(p.type)
    ? p.type
    : 'none'
  const pagination: PaginationSpec = {
    type: ptype,
    param: typeof p.param === 'string' ? p.param : undefined,
    selector: typeof p.selector === 'string' ? p.selector : undefined,
    pathTemplate: typeof p.pathTemplate === 'string' ? p.pathTemplate : undefined,
  }

  return { recordSelector, recordType, fields, pagination }
}

/** 校验配方：套用 recordSelector，要求 ≥3 条记录且每条 name 非空 */
function validateRecipe($: cheerio.CheerioAPI, recipe: ExtractionRecipe, baseUrl: string): { ok: boolean; count: number } {
  if (!recipe.recordSelector) return { ok: false, count: 0 }
  const recs = applyRecipe($, recipe, baseUrl)
  return { ok: recs.length >= 3, count: recs.length }
}

/** Phase A：从一页(已抓取/渲染好的 FetchedPage)推断配方，含一次带反馈重试 */
export async function inferRecipe(page: FetchedPage): Promise<ExtractionRecipe> {
  const { origin, urlPattern } = recipeKeyFor(page.url)
  const base: ExtractionRecipe = {
    origin,
    urlPattern,
    recordSelector: null,
    recordType: 'artist',
    fields: {},
    pagination: { type: 'none' },
    needsJs: page.rendered,
    sampleUrl: page.url,
  }

  const skeleton = buildSkeleton(page.$)
  const client = getClient()

  const tryInfer = async (feedback?: string): Promise<ExtractionRecipe | null> => {
    const completion = await client.chat.completions.create({
      model: process.env.GRAPH_LLM_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: RECIPE_SYSTEM },
        { role: 'user', content: buildRecipePrompt(skeleton, page.url, feedback) },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    })
    const parsed = parseRecipeJson(extractJson(completion.choices?.[0]?.message?.content || ''))
    if (!parsed) return null
    return { ...base, ...parsed }
  }

  let recipe = await tryInfer()
  if (recipe && recipe.recordSelector) {
    const v = validateRecipe(page.$, recipe, page.url)
    if (!v.ok) {
      // 带反馈重试一次
      const retry = await tryInfer(`选择器 "${recipe.recordSelector}" 只匹配到 ${v.count} 条记录，请换一个能选中多条同构记录的选择器。`)
      if (retry && retry.recordSelector && validateRecipe(page.$, retry, page.url).ok) {
        recipe = retry
      } else {
        recipe = { ...base } // 校验仍失败 → 退化为兜底(recordSelector=null)
      }
    }
  } else if (!recipe) {
    recipe = { ...base }
  }

  return recipe
}

// ---------------- Layer 0：缓存读写 ----------------

const FRESH_MS = (Number(process.env.RECIPE_FRESH_DAYS) || 30) * 24 * 3600 * 1000

function rowToRecipe(row: any): ExtractionRecipe {
  const safe = <T>(s: string | null, fb: T): T => {
    try {
      return s ? JSON.parse(s) : fb
    } catch {
      return fb
    }
  }
  return {
    origin: row.origin,
    urlPattern: row.urlPattern,
    recordSelector: row.recordSelector || null,
    recordType: (row.recordType as NodeType) || 'artist',
    fields: safe(row.fields, {}),
    pagination: safe(row.pagination, { type: 'none' as PaginationType }),
    needsJs: !!row.needsJs,
    sampleUrl: row.sampleUrl || undefined,
  }
}

export async function loadRecipe(url: string): Promise<ExtractionRecipe | null> {
  const { origin, urlPattern } = recipeKeyFor(url)
  let row = await prisma.extractionRecipe.findFirst({ where: { origin, urlPattern } })
  if (!row) row = await prisma.extractionRecipe.findFirst({ where: { origin, urlPattern: '*' } })
  if (!row) return null
  if (Date.now() - new Date(row.lastVerifiedAt).getTime() > FRESH_MS) return null // 过期 → 重新推断
  return rowToRecipe(row)
}

export async function saveRecipe(recipe: ExtractionRecipe): Promise<void> {
  const data = {
    recordSelector: recipe.recordSelector,
    recordType: recipe.recordType,
    fields: JSON.stringify(recipe.fields),
    pagination: JSON.stringify(recipe.pagination),
    needsJs: recipe.needsJs,
    sampleUrl: recipe.sampleUrl ?? null,
    lastVerifiedAt: new Date(),
  }
  await prisma.extractionRecipe.upsert({
    where: { origin_urlPattern: { origin: recipe.origin, urlPattern: recipe.urlPattern } },
    create: { origin: recipe.origin, urlPattern: recipe.urlPattern, ...data },
    update: data,
  })
}

/**
 * 取配方：命中新鲜缓存则直接用(跳过 LLM)；否则用首页推断并持久化。
 * 返回 { recipe, cached }，cached 用于日志区分快/慢路径。
 */
export async function getOrInferRecipe(page: FetchedPage): Promise<{ recipe: ExtractionRecipe; cached: boolean }> {
  const cached = await loadRecipe(page.url)
  if (cached) return { recipe: cached, cached: true }
  const recipe = await inferRecipe(page)
  try {
    await saveRecipe(recipe)
  } catch {
    /* 缓存写失败不致命 */
  }
  return { recipe, cached: false }
}
