'use client'

import { useState, useEffect, useRef, useMemo, useCallback, memo, type MouseEvent as ReactMouseEvent, type Dispatch, type SetStateAction } from 'react'
import ReactFlow, { Background, Controls, MiniMap, Node, Edge, MarkerType, Handle, Position, useNodesState, useEdgesState, useViewport, type NodeProps, type NodeTypes } from 'reactflow'
import 'reactflow/dist/style.css'
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY, type Simulation } from 'd3-force'
import { Search, Play, Square, Loader2, Type, Link2, Upload, FileText, ImageIcon, X, Sparkles, History, Trash2, RefreshCw, Filter,
  Palette, Building2, UserCheck, Waves, MapPin, GraduationCap, Newspaper, Frame, Circle,
  Wand2, ChevronDown, Target, Network, LayoutGrid, GitBranch, Grid3x3, Atom, Maximize2, Zap, Pin, type LucideIcon } from 'lucide-react'
import AppHeader from '@/components/AppHeader'
import { useLocale } from '@/contexts/LocaleContext'

interface EntityIdentity {
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

interface ApiNode {
  key: string
  name: string
  type: string
  depth: number
  relevanceScore: number
  importance: number
  pagerank: number
  degree: number
  discoveryCount: number
  data: { year?: number | null; evidence?: string | null; sourceUrl?: string | null; runCount?: number; wikidataId?: string | null; identity?: EntityIdentity | null } | null
}
interface ApiEdge {
  sourceKey: string
  targetKey: string
  type: string
  weight: number
  evidence: string[] | null
}
interface RunInfo {
  id: string
  seedName: string
  seedType: string
  status: string
  progress: number
  message: string | null
  nodeCount: number
  edgeCount: number
}
interface RunListItem {
  id: string
  seedName: string
  seedType: string
  status: string
  nodeCount: number
  edgeCount: number
  createdAt: string
}
interface LogEntry {
  seq: number
  level: string
  message: string
  createdAt: string
}

const TYPE_COLORS: Record<string, string> = {
  artist: '#2563eb',
  exhibition: '#dc2626',
  institution: '#7c3aed',
  curator: '#ea580c',
  movement: '#059669',
  location: '#0891b2',
  scholar: '#db2777',
  paper: '#ca8a04',
  venue: '#4f46e5',
}
const TYPE_LABELS: Record<string, string> = {
  artist: '艺术家', exhibition: '展览', institution: '机构', curator: '策展人',
  movement: '流派', location: '地点', scholar: '学者', paper: '论文', venue: '会议/期刊',
}

// 每个数据类别一个“地图标记”图标(图谱节点 + 图例共用)
const TYPE_ICONS: Record<string, LucideIcon> = {
  artist: Palette,
  exhibition: Frame,
  institution: Building2,
  curator: UserCheck,
  movement: Waves,
  location: MapPin,
  scholar: GraduationCap,
  paper: FileText,
  venue: Newspaper,
}

const NODE_TYPES = Object.keys(TYPE_COLORS)

const RELATION_LABELS: Record<string, string> = {
  participated_in: '参加了',
  collaborated_with: '合作',
  exhibited_at: '展出于',
  curated_by: '策展',
  influenced_by: '受影响于',
  contemporary_of: '同时代',
  located_in: '位于',
  belongs_to: '属于',
  authored: '著有',
  published_in: '发表于',
}

const LOG_LEVEL_STYLE: Record<string, { tag: string; cls: string }> = {
  step: { tag: 'STEP', cls: 'text-purple-400' },
  llm: { tag: 'CODEX', cls: 'text-blue-400' },
  info: { tag: 'INFO', cls: 'text-slate-400' },
  success: { tag: 'OK', cls: 'text-emerald-400' },
  warn: { tag: 'WARN', cls: 'text-amber-400' },
  error: { tag: 'ERR', cls: 'text-red-400' },
}

// 按屏幕像素推算默认节点倍率(节点数越多、画布越小 → 倍率越小)
function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function computeDefaultNodeSizeScale(width: number, height: number, nodeCount: number): number {
  if (nodeCount <= 0 || width <= 0 || height <= 0) return 1
  const minDim = Math.min(width, height)
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodeCount)))
  const idealSpacing = minDim / (cols * 2.6)
  const refNodePx = 48
  return Math.min(2.2, Math.max(0.4, idealSpacing / refNodePx))
}

function baseNodeSize(importance: number): number {
  return 34 + importance * 66
}

// 屏幕像素 → 图谱坐标(抵消 ReactFlow 缩放，使节点在屏幕上保持目标像素大小)
function toGraphPx(screenPx: number, zoom: number): number {
  return screenPx / Math.max(zoom, 0.08)
}

// 按名字长度估算标签所需宽度(屏幕像素)，避免长单词/长名被挤成省略号
function estimateLabelScreenWidth(name: string, screenFontSize: number, screenSize: number): number {
  const perLine = Math.max(140, screenSize * 3.6)
  let charW = 0
  for (const ch of name) charW += ch.charCodeAt(0) > 255 ? screenFontSize : screenFontSize * 0.52
  // 尽量单行容纳；仍设上限，超出则换行到 3 行内
  const want = Math.max(perLine, charW * 1.05)
  return Math.min(want, perLine * 2.8)
}

// 自定义“地图标记”节点：彩色圆形 + 类别图标 + 下方名字标签(随缩放自适应)
interface EntityNodeData {
  name: string
  type: string
  baseSize: number
  sizeScale: number
  color: string
  selected: boolean
  related?: boolean
  matched?: boolean
  dim?: boolean
  hovered?: boolean
}
function EntityNode({ data }: NodeProps<EntityNodeData>) {
  const { zoom: liveZoom } = useViewport()
  const zoom = liveZoom || 1
  const Icon = TYPE_ICONS[data.type] || Circle
  const screenSize = data.baseSize * data.sizeScale
  const s = toGraphPx(screenSize, zoom)
  // 先在屏幕像素空间算字号/宽度，再换算到图谱坐标(避免被错误的 graph 上限卡死)
  const screenFontSize = Math.max(9, Math.min(18, screenSize * 0.24))
  const fontSize = toGraphPx(screenFontSize, zoom)
  const screenLabelWidth = estimateLabelScreenWidth(data.name, screenFontSize, screenSize)
  const labelMaxWidth = toGraphPx(screenLabelWidth, zoom)
  const labelGap = toGraphPx(4 * data.sizeScale, zoom)
  const labelLineHeight = 1.22
  const labelMaxLines = 3
  const labelMaxHeight = fontSize * labelLineHeight * labelMaxLines
  const wrapWidth = Math.max(s, labelMaxWidth)
  const border = data.selected
    ? '4px solid #facc15'
    : data.matched
      ? '4px solid #10b981'
      : data.hovered
        ? '3px solid #818cf8'
        : data.related
          ? '3px solid #fbbf24'
          : '2px solid rgba(255,255,255,0.9)'
  const boxShadow = data.selected
    ? '0 0 0 4px rgba(250,204,21,0.35), 0 2px 8px rgba(0,0,0,0.3)'
    : data.matched
      ? '0 0 0 4px rgba(16,185,129,0.4), 0 2px 8px rgba(0,0,0,0.3)'
      : data.hovered
        ? '0 0 0 4px rgba(129,140,248,0.45), 0 2px 8px rgba(0,0,0,0.3)'
        : data.related
          ? '0 0 0 3px rgba(251,191,36,0.25), 0 2px 8px rgba(0,0,0,0.25)'
          : '0 2px 8px rgba(0,0,0,0.25)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: wrapWidth,
        minWidth: s,
        opacity: data.dim ? 0.2 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div
        style={{
          width: s,
          height: s,
          borderRadius: '50%',
          background: data.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border,
          boxShadow,
        }}
      >
        <Icon size={Math.max(10, s * 0.46)} color="#fff" strokeWidth={2.2} />
      </div>
      <div
        style={{
          marginTop: labelGap,
          fontSize,
          fontWeight: 600,
          color: '#1e293b',
          textAlign: 'center',
          lineHeight: labelLineHeight,
          width: labelMaxWidth,
          maxHeight: labelMaxHeight,
          display: '-webkit-box',
          WebkitLineClamp: labelMaxLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          hyphens: 'auto',
          textShadow: '0 1px 2px rgba(255,255,255,0.9)',
        }}
      >
        {data.name}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  )
}
// Performance-mode node: no useViewport() subscription → no re-render on zoom/pan
const EntityNodeFast = memo(function EntityNodeFast({ data }: NodeProps<EntityNodeData>) {
  const Icon = TYPE_ICONS[data.type] || Circle
  const s = data.baseSize * data.sizeScale
  const fontSize = Math.max(9, Math.min(18, s * 0.24))
  const labelWidth = Math.min(s * 3.8, s * 10)
  const border = data.selected
    ? '4px solid #facc15'
    : data.matched
      ? '4px solid #10b981'
      : data.hovered
        ? '3px solid #818cf8'
        : data.related
          ? '3px solid #fbbf24'
          : '2px solid rgba(255,255,255,0.9)'
  const boxShadow = data.selected
    ? '0 0 0 4px rgba(250,204,21,0.35), 0 2px 8px rgba(0,0,0,0.3)'
    : data.matched
      ? '0 0 0 4px rgba(16,185,129,0.4), 0 2px 8px rgba(0,0,0,0.3)'
      : data.hovered
        ? '0 0 0 4px rgba(129,140,248,0.45), 0 2px 8px rgba(0,0,0,0.3)'
        : '0 2px 8px rgba(0,0,0,0.25)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: Math.max(s, labelWidth), minWidth: s, opacity: data.dim ? 0.2 : 1 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div style={{ width: s, height: s, borderRadius: '50%', background: data.color, display: 'flex', alignItems: 'center', justifyContent: 'center', border, boxShadow }}>
        <Icon size={Math.max(10, s * 0.46)} color="#fff" strokeWidth={2.2} />
      </div>
      <div style={{ marginTop: 4, fontSize, fontWeight: 600, color: '#1e293b', textAlign: 'center', width: labelWidth, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(255,255,255,0.9)' }}>
        {data.name}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  )
})

const nodeTypesNormal: NodeTypes = { entity: EntityNode }
const nodeTypesFast: NodeTypes = { entity: EntityNodeFast }

// 同心圆布局：按 depth 分层
function layout(nodes: ApiNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const byDepth = new Map<number, ApiNode[]>()
  for (const n of nodes) {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, [])
    byDepth.get(n.depth)!.push(n)
  }
  for (const [depth, list] of byDepth) {
    if (depth === 0) {
      pos.set(list[0].key, { x: 0, y: 0 })
      continue
    }
    const radius = depth * 340
    list.sort((a, b) => b.importance - a.importance)
    list.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / list.length - Math.PI / 2
      pos.set(n.key, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    })
  }
  return pos
}

// d3-force 模拟节点
interface SimNode {
  id: string
  r: number
  x: number
  y: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  index?: number
}

// ---------- 图谱整理：多种布局方式 ----------
type LayoutMode = 'concentric' | 'force' | 'type' | 'tree' | 'grid'
const LAYOUT_OPTIONS: { id: LayoutMode; label: string; desc: string; icon: LucideIcon }[] = [
  { id: 'concentric', label: '同心圆（按深度）', desc: '起点居中，逐层向外', icon: Target },
  { id: 'force', label: '力导向（自动散开）', desc: '减少重叠、相关聚团', icon: Network },
  { id: 'type', label: '按类别分组', desc: '同类实体聚成一簇', icon: LayoutGrid },
  { id: 'tree', label: '层级（上下分层）', desc: '按深度横向分层', icon: GitBranch },
  { id: 'grid', label: '网格（按重要度）', desc: '整齐网格排列', icon: Grid3x3 },
]

// 按类别分组：每个类别一簇，簇心排在大圆上，簇内小网格
function layoutByType(nodes: ApiNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const byType = new Map<string, ApiNode[]>()
  for (const n of nodes) {
    if (!byType.has(n.type)) byType.set(n.type, [])
    byType.get(n.type)!.push(n)
  }
  const types = Array.from(byType.keys())
  const clusterRadius = 360 + types.length * 90
  types.forEach((t, ti) => {
    const ang = (2 * Math.PI * ti) / Math.max(types.length, 1) - Math.PI / 2
    const cx = Math.cos(ang) * clusterRadius
    const cy = Math.sin(ang) * clusterRadius
    const list = byType.get(t)!.sort((a, b) => b.importance - a.importance)
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)))
    const gap = 96
    list.forEach((n, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const rows = Math.ceil(list.length / cols)
      pos.set(n.key, {
        x: cx + (col - (cols - 1) / 2) * gap,
        y: cy + (row - (rows - 1) / 2) * gap,
      })
    })
  })
  return pos
}

// 层级：按 depth 横向分层（上下排开）
function layoutTree(nodes: ApiNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const byDepth = new Map<number, ApiNode[]>()
  for (const n of nodes) {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, [])
    byDepth.get(n.depth)!.push(n)
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b)
  const gapX = 150
  const gapY = 220
  depths.forEach((d, di) => {
    const list = byDepth.get(d)!.sort((a, b) => b.importance - a.importance)
    list.forEach((n, i) => {
      pos.set(n.key, { x: (i - (list.length - 1) / 2) * gapX, y: di * gapY })
    })
  })
  return pos
}

// 网格：按重要度从大到小铺成方阵
function layoutGrid(nodes: ApiNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const sorted = [...nodes].sort((a, b) => b.importance - a.importance)
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)))
  const gapX = 160
  const gapY = 130
  sorted.forEach((n, i) => {
    pos.set(n.key, { x: (i % cols) * gapX, y: Math.floor(i / cols) * gapY })
  })
  return pos
}

// 力导向：Fruchterman-Reingold 简化版，一次性迭代（点击时跑）
function layoutForce(nodes: ApiNode[], edges: ApiEdge[], sizeScale = 1): Map<string, { x: number; y: number }> {
  const init = layout(nodes)
  const keys = nodes.map((n) => n.key)
  const keySet = new Set(keys)
  const P: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const p = init.get(n.key) || { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 }
    P[n.key] = { x: p.x || (Math.random() - 0.5) * 50, y: p.y || (Math.random() - 0.5) * 50 }
  }
  const links = edges.filter((e) => keySet.has(e.sourceKey) && keySet.has(e.targetKey))
  const k = Math.max(55, Math.sqrt((keys.length * 22000) / Math.max(1, keys.length)) + 48) * sizeScale
  let temp = k * 1.5
  const iters = keys.length > 180 ? 160 : 260
  for (let it = 0; it < iters; it++) {
    const disp: Record<string, { x: number; y: number }> = {}
    for (const id of keys) disp[id] = { x: 0, y: 0 }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = P[keys[i]]
        const b = P[keys[j]]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.hypot(dx, dy) || 0.01
        const rep = (k * k) / dist
        const ux = dx / dist
        const uy = dy / dist
        disp[keys[i]].x += ux * rep
        disp[keys[i]].y += uy * rep
        disp[keys[j]].x -= ux * rep
        disp[keys[j]].y -= uy * rep
      }
    }
    for (const e of links) {
      const a = P[e.sourceKey]
      const b = P[e.targetKey]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dist = Math.hypot(dx, dy) || 0.01
      const att = (dist * dist) / k
      const ux = dx / dist
      const uy = dy / dist
      disp[e.sourceKey].x -= ux * att
      disp[e.sourceKey].y -= uy * att
      disp[e.targetKey].x += ux * att
      disp[e.targetKey].y += uy * att
    }
    for (const id of keys) {
      const d = disp[id]
      const len = Math.hypot(d.x, d.y) || 0.01
      const lim = Math.min(len, temp)
      P[id].x += (d.x / len) * lim
      P[id].y += (d.y / len) * lim
    }
    temp = Math.max(temp * 0.96, k * 0.02)
  }
  const out = new Map<string, { x: number; y: number }>()
  for (const id of keys) out.set(id, P[id])
  return out
}

function computeLayout(mode: LayoutMode, nodes: ApiNode[], edges: ApiEdge[], sizeScale = 1): Map<string, { x: number; y: number }> {
  if (mode === 'force') return layoutForce(nodes, edges, sizeScale)
  if (mode === 'type') return layoutByType(nodes)
  if (mode === 'tree') return layoutTree(nodes)
  if (mode === 'grid') return layoutGrid(nodes)
  return layout(nodes)
}

type InputMode = 'text' | 'url' | 'file'

function detectInputMode(seedInput: string, file: File | null): InputMode {
  if (file) return 'file'
  if (parseUrlsFromText(seedInput).length > 0) return 'url'
  return 'text'
}

function parseUrlsFromText(text: string): string[] {
  const valid: string[] = []
  for (const raw of text.split(/[\n\s]+/)) {
    // 去掉首尾全角/半角标点（常见于从网页复制带逗号的链接）
    const s = raw.replace(/^[,;，；、。！？""''…【】《》（）]+/, '').replace(/[,;，；、。！？""''…【】《》（）]+$/, '').trim()
    if (!s) continue
    try {
      const u = new URL(s)
      if (u.protocol === 'http:' || u.protocol === 'https:') valid.push(u.href)
    } catch { /* 非法 URL，忽略 */ }
  }
  return [...new Set(valid)].slice(0, 20)
}

const INPUT_MODE_LABELS: Record<InputMode, { zh: string; en: string }> = {
  text: { zh: '文本', en: 'Text' },
  url: { zh: '链接', en: 'URL' },
  file: { zh: '文件', en: 'File' },
}

interface ResolvedSeed {
  seedName: string
  seedType: string
  summary: string
  source: string
  identity?: EntityIdentity | null
  searchTerms?: string[]
}
interface PrecheckState {
  normalizedName: string
  type: string
  confidence: number
  candidates: EntityIdentity[]
  searchTerms: string[]
  disambiguation: string[]
}

function readFile(file: File): Promise<{ dataUrl: string; text: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    if (file.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(file.name)) {
      reader.onload = () => resolve({ dataUrl: '', text: String(reader.result || '') })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({ dataUrl: String(reader.result || ''), text: '' })
      reader.readAsDataURL(file)
    }
  })
}

export default function DeepSearchPage() {
  const { t, locale } = useLocale()
  const [seedType, setSeedType] = useState('artist')
  const [maxDepth, setMaxDepth] = useState(2)
  const [maxPerLevel, setMaxPerLevel] = useState(6)
  const [crawlPageMode, setCrawlPageMode] = useState<'auto' | 'fixed'>('auto')
  const [crawlPages, setCrawlPages] = useState(50) // auto: 安全上限; fixed: 目标页数

  // 多模态起点输入（自动检测 + 可手动覆盖）
  const [seedInput, setSeedInput] = useState('巴勃罗·毕加索')
  const [inputModeOverride, setInputModeOverride] = useState<InputMode | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const autoInputMode = detectInputMode(seedInput, file)
  const inputMode = inputModeOverride ?? autoInputMode
  const [dragOver, setDragOver] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolvedSeed, setResolvedSeed] = useState<ResolvedSeed | null>(null)
  const [prechecking, setPrechecking] = useState(false)
  const [precheck, setPrecheck] = useState<PrecheckState | null>(null)
  const lastSigRef = useRef<string>('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<RunInfo | null>(null)
  const [apiNodes, setApiNodes] = useState<ApiNode[]>([])
  const [apiEdges, setApiEdges] = useState<ApiEdge[]>([])
  const [selected, setSelected] = useState<ApiNode | null>(null)
  // 定点深挖：累积选中的种子节点(name+type)，从这些点继续向下深搜
  const [seedQueue, setSeedQueue] = useState<{ name: string; type: string; identity?: EntityIdentity | null }[]>([])
  // 悬浮联动（双向）：分两个独立状态，避免互相触发导致闪动
  const [graphHoveredKey, setGraphHoveredKey] = useState<string | null>(null)     // 鼠标在图谱节点上
  const [sidebarHoveredKey, setSidebarHoveredKey] = useState<string | null>(null) // 鼠标在右侧排行行上
  const rankItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchHistoryRef = useRef<(() => void) | null>(null)

  // 历史运行(从数据库读取)
  const [history, setHistory] = useState<RunListItem[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // 实时进程控制台
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(true)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // 视图模式：单次运行 / 全局总图
  const [viewMode, setViewMode] = useState<'run' | 'global'>('run')
  const [globalStats, setGlobalStats] = useState<{ totalEntities: number; totalRelations: number; shownEntities: number; limited: boolean } | null>(null)

  // 右侧排行面板折叠
  const [rankOpen, setRankOpen] = useState(true)

  // 筛选系统(默认全部显示；记录“被排除”的项，新数据自动可见)
  const [filterOpen, setFilterOpen] = useState(true)
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(new Set())
  const [depthMax, setDepthMax] = useState(99)
  const [depthFilterSliderMax, setDepthFilterSliderMax] = useState(10)
  const [minImportance, setMinImportance] = useState(0)
  const [minRunCount, setMinRunCount] = useState(1)

  // 统一搜索：searchInput 即时更新（控制输入框显示 + 下拉建议），searchQuery 防抖后才驱动图谱高亮
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // 仅显示选择项：开启时只保留搜索命中的节点，并自动重新排列(Finder 清理效果)
  const [onlyMatched, setOnlyMatched] = useState(false)

  // 图谱整理：布局方式 + 下拉菜单
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force')
  const [showLayoutMenu, setShowLayoutMenu] = useState(false)
  const rfInstanceRef = useRef<{
    fitView: (opts?: { duration?: number; padding?: number; nodes?: { id: string }[] }) => void
    getViewport?: () => { zoom: number; x: number; y: number }
  } | null>(null)
  const arrangeSigRef = useRef<string>('')

  // Obsidian 式「灵动」物理布局(d3-force 持续模拟，节点自动归位)
  const [livePhysics, setLivePhysics] = useState(false)
  const [perfMode, setPerfMode] = useState(true)
  const [nodeSizeScale, setNodeSizeScale] = useState(1)
  const userSizedRef = useRef(false)
  const graphWrapRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 900, h: 600 })
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const simNodesRef = useRef<Map<string, SimNode>>(new Map())
  const rfNodesPosRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  // 侧栏详情：点击词条后显示，鼠标离开侧栏自动隐藏（进入侧栏不触发）；铆钉固定后常驻
  const [rankDetailOpen, setRankDetailOpen] = useState(false)
  const [detailPinned, setDetailPinned] = useState(false)

  const running = run?.status === 'running' || run?.status === 'pending'

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/deep-search/${id}`)
      const data = await res.json()
      if (data.success) {
        setRun(data.run)
        setApiNodes(data.nodes)
        setApiEdges(data.edges)
        if (data.logs) setLogs(data.logs)
        if (data.run.status === 'completed' || data.run.status === 'failed' || data.run.status === 'stopped') {
          stopPolling()
          fetchHistoryRef.current?.()
        }
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  // 从数据库拉取历史运行列表
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/deep-search')
      const data = await res.json()
      if (data.success) setHistory(data.runs)
    } catch (e) {
      console.error(e)
    }
  }, [])
  fetchHistoryRef.current = fetchHistory

  // 加载全局总图(所有运行合并去重)
  const loadGlobal = useCallback(async () => {
    stopPolling()
    setViewMode('global')
    setShowHistory(false)
    setSelected(null)
    setRankDetailOpen(false)
    setDetailPinned(false)
    setRun(null)
    setRunId(null)
    setLogs([])
    setConsoleOpen(false)
    try {
      const res = await fetch('/api/deep-search/global?limit=300')
      const data = await res.json()
      if (!data.success) {
        setResolveError('加载全局图失败: ' + data.error)
        return
      }
      setApiNodes(data.nodes)
      setApiEdges(data.edges)
      setGlobalStats(data.stats)
    } catch (e) {
      console.error(e)
    }
  }, [])

  // 加载某次历史运行 → 从库里读出节点/边渲染成图谱
  const loadRun = useCallback(async (id: string) => {
    stopPolling()
    setViewMode('run')
    setShowHistory(false)
    setSelected(null)
    setRankDetailOpen(false)
    setDetailPinned(false)
    try {
      const res = await fetch(`/api/deep-search/${id}`)
      const data = await res.json()
      if (!data.success) {
        setResolveError('加载失败: ' + data.error)
        return
      }
      setRunId(id)
      setRun(data.run)
      setApiNodes(data.nodes)
      setApiEdges(data.edges)
      setLogs(data.logs || [])
      setConsoleOpen(true)
      // 若该运行仍在进行，继续轮询
      if (data.run.status === 'running' || data.run.status === 'pending') {
        pollRef.current = setInterval(() => poll(id), 2500)
      }
    } catch (e) {
      console.error(e)
    }
  }, [poll])

  const deleteRun = useCallback(async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!confirm('删除这次运行及其图谱数据？此操作不可恢复。')) return
    // 必须确认服务端真的删除成功，否则界面会"骗人"(只隐藏未删除)
    try {
      const res = await fetch(`/api/deep-search/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        alert(`删除失败：${data?.error || `HTTP ${res.status}`}。数据未被删除。`)
        fetchHistory()
        return
      }
    } catch (err) {
      alert(`删除请求出错：${err instanceof Error ? err.message : String(err)}。数据未被删除。`)
      fetchHistory()
      return
    }
    if (id === runId) {
      setRun(null)
      setApiNodes([])
      setApiEdges([])
      setRunId(null)
    }
    fetchHistory()
  }, [runId, fetchHistory])

  // 构造解析请求体 + 当前输入签名(用于判断是否需要重新解析)
  const buildResolvePayload = async (): Promise<{ payload: any; sig: string }> => {
    if (inputMode === 'text') {
      const text = seedInput.trim()
      if (!text) throw new Error(locale === 'zh' ? '请输入起点名字或描述' : 'Please enter a seed name or description')
      return { payload: { kind: 'text', text }, sig: `text:${text}` }
    }
    if (inputMode === 'url') {
      const urls = parseUrlsFromText(seedInput)
      if (!urls.length) throw new Error(locale === 'zh' ? '请输入至少一个有效的 http(s) 链接' : 'Please enter at least one valid http(s) URL')
      return { payload: { kind: 'url', url: urls[0] }, sig: `url:${urls.join('|')}` }
    }
    if (!file) throw new Error('请上传一个文件(图片 / PDF / 文本)')
    const sig = `file:${file.name}:${file.size}:${file.lastModified}`
    const { dataUrl, text } = await readFile(file)
    if (dataUrl && file.type.startsWith('image/')) {
      return { payload: { kind: 'image', dataUrl, filename: file.name }, sig }
    }
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return { payload: { kind: 'pdf', dataBase64: dataUrl, filename: file.name }, sig }
    }
    if (text) return { payload: { kind: 'text', text }, sig }
    throw new Error('不支持的文件类型(请用 图片 / PDF / txt / md)')
  }

  const resolveSeedNow = async (): Promise<ResolvedSeed> => {
    const { payload, sig } = await buildResolvePayload()
    // 输入未变且已解析过 → 复用(尊重用户手动改的类型)
    if (sig === lastSigRef.current && resolvedSeed) {
      return { ...resolvedSeed, seedType }
    }
    if (inputMode === 'text' && precheck && precheck.confidence >= 0.72) {
      const seed: ResolvedSeed = {
        seedName: precheck.normalizedName,
        seedType: seedType || precheck.type,
        summary: precheck.candidates[0]?.description || 'Wikidata identity match',
        source: 'text',
        identity: precheck.candidates[0] || null,
        searchTerms: precheck.searchTerms,
      }
      setResolvedSeed(seed)
      lastSigRef.current = sig
      return seed
    }
    setResolving(true)
    setResolveError(null)
    try {
      const res = await fetch('/api/deep-search/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '解析失败')
      const seed: ResolvedSeed = {
        seedName: data.seedName,
        seedType: data.seedType,
        summary: data.summary,
        source: data.source,
      }
      setResolvedSeed(seed)
      setSeedType(data.seedType)
      lastSigRef.current = sig
      return seed
    } finally {
      setResolving(false)
    }
  }

  const start = async () => {
    // 链接模式 → 爬取式深度搜索：抓取该网址(自动翻页) → 批量抽取实体 → 深挖
    if (inputMode === 'url') {
      const urls = parseUrlsFromText(seedInput)
      if (!urls.length) {
        setResolveError(locale === 'zh' ? '请输入至少一个有效的 http(s) 链接' : 'Please enter at least one valid http(s) URL')
        return
      }
      setResolveError(null)
      stopPolling()
      setViewMode('run')
      setApiNodes([])
      setApiEdges([])
      setSelected(null)
      setRankDetailOpen(false)
      setDetailPinned(false)
      setLogs([])
      setConsoleOpen(true)
      const res = await fetch('/api/deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedUrls: urls, crawlPageMode, crawlPages, maxDepth, maxPerLevel }),
      })
      const data = await res.json()
      if (!data.success) {
        setResolveError('启动失败: ' + data.error)
        return
      }
      const label = urls.length === 1
        ? (() => { try { return new URL(urls[0]).hostname } catch { return urls[0] } })()
        : `${urls.length} 个链接`
      setRunId(data.runId)
      setRun({ id: data.runId, seedName: label, seedType: 'institution', status: 'pending', progress: 0, message: '启动中…', nodeCount: 0, edgeCount: 0 })
      fetchHistory()
      poll(data.runId)
      pollRef.current = setInterval(() => poll(data.runId), 2500)
      return
    }

    let seed: ResolvedSeed
    try {
      seed = await resolveSeedNow()
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : '解析失败')
      return
    }
    stopPolling()
    setViewMode('run')
    setApiNodes([])
    setApiEdges([])
    setSelected(null)
    setRankDetailOpen(false)
    setDetailPinned(false)
    setLogs([])
    setConsoleOpen(true)
    const finalType = seedType || seed.seedType
    const res = await fetch('/api/deep-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedName: seed.seedName, seedType: finalType, maxDepth, maxPerLevel }),
    })
    const data = await res.json()
    if (!data.success) {
      setResolveError('启动失败: ' + data.error)
      return
    }
    setRunId(data.runId)
    setRun({ id: data.runId, seedName: seed.seedName, seedType: finalType, status: 'pending', progress: 0, message: '启动中…', nodeCount: 0, edgeCount: 0 })
    fetchHistory()
    poll(data.runId)
    pollRef.current = setInterval(() => poll(data.runId), 2500)
  }

  // 是否已在深挖队列中
  const inSeedQueue = useCallback(
    (n: { name: string; type: string }) =>
      seedQueue.some((s) => s.type === n.type && s.name.toLowerCase() === n.name.toLowerCase()),
    [seedQueue]
  )

  // 加入/移出深挖队列(切换)
  const toggleSeedQueue = useCallback((n: { name: string; type: string; data?: ApiNode['data'] }) => {
    setSeedQueue((q) => {
      const exists = q.some((s) => s.type === n.type && s.name.toLowerCase() === n.name.toLowerCase())
      return exists
        ? q.filter((s) => !(s.type === n.type && s.name.toLowerCase() === n.name.toLowerCase()))
        : [...q, { name: n.name, type: n.type, identity: n.data?.identity || null }]
    })
  }, [])

  // 定点深挖：从给定的若干现有节点出发，按名字检索真实资料继续向下深搜(核实后归档)
  const startAnchored = async (seeds: { name: string; type: string; identity?: EntityIdentity | null }[]) => {
    const list = seeds
      .map((s) => ({ name: String(s.name || '').trim(), type: String(s.type || '').trim() }))
      .filter((s) => s.name && s.type)
    if (!list.length) return
    setResolveError(null)
    stopPolling()
    setViewMode('run')
    setApiNodes([])
    setApiEdges([])
    setSelected(null)
    setRankDetailOpen(false)
    setDetailPinned(false)
    setLogs([])
    setConsoleOpen(true)
    const label = `定点深挖：${list.slice(0, 3).map((s) => s.name).join('、')}${list.length > 3 ? ` 等 ${list.length} 点` : ''}`
    let data: any
    try {
      const res = await fetch('/api/deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedNodes: list, maxDepth, maxPerLevel }),
      })
      data = await res.json()
    } catch (e) {
      setResolveError('启动失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    if (!data?.success) {
      setResolveError('启动失败: ' + (data?.error || '未知错误'))
      return
    }
    setSeedQueue([])
    setRunId(data.runId)
    setRun({ id: data.runId, seedName: label, seedType: list[0].type, status: 'pending', progress: 0, message: '启动中…', nodeCount: 0, edgeCount: 0 })
    fetchHistory()
    poll(data.runId)
    pollRef.current = setInterval(() => poll(data.runId), 2500)
  }

  const pickFile = (f: File | null) => {
    setFile(f)
    setInputModeOverride(null)
    setResolvedSeed(null)
    setPrecheck(null)
    lastSigRef.current = ''
    setResolveError(null)
  }

  const onSeedInputChange = (value: string) => {
    setSeedInput(value)
    setInputModeOverride(null)
    setResolvedSeed(null)
    setPrecheck(null)
    lastSigRef.current = ''
  }

  const stop = async () => {
    if (!runId) return
    await fetch(`/api/deep-search/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    })
    poll(runId)
  }

  useEffect(() => {
    if (inputMode !== 'text') {
      setPrecheck(null)
      setPrechecking(false)
      return
    }
    const query = seedInput.trim()
    if (query.length < 2 || query.length > 120) {
      setPrecheck(null)
      setPrechecking(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setPrechecking(true)
      try {
        const res = await fetch('/api/deep-search/precheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, typeHint: seedType }),
          signal: controller.signal,
        })
        const data = await res.json()
        if (data.success) {
          setPrecheck({
            normalizedName: data.normalizedName,
            type: data.type,
            confidence: data.confidence,
            candidates: data.candidates || [],
            searchTerms: data.searchTerms || [],
            disambiguation: data.disambiguation || [],
          })
        }
      } catch (e) {
        if (!controller.signal.aborted) console.error(e)
      } finally {
        if (!controller.signal.aborted) setPrechecking(false)
      }
    }, 450)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [inputMode, seedInput, seedType])

  useEffect(() => {
    fetchHistory()
    return () => stopPolling()
  }, [fetchHistory])

  useEffect(() => {
    if (consoleOpen) logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [logs, consoleOpen])

  // 图谱节点悬停时，右侧排行榜对应条目滚动到可见区域
  useEffect(() => {
    if (!graphHoveredKey) return
    rankItemRefs.current.get(graphHoveredKey)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [graphHoveredKey])

  // 右侧列表悬停时，图谱镜头平滑飞到对应节点并居中（防抖 400ms，鼠标停稳后才飞，避免快速划过时乱跳）
  useEffect(() => {
    if (!sidebarHoveredKey) return
    const timer = setTimeout(() => {
      rfInstanceRef.current?.fitView({ nodes: [{ id: sidebarHoveredKey }], duration: 350, padding: 0.4 })
    }, 400)
    return () => clearTimeout(timer)
  }, [sidebarHoveredKey])

  // ---------- 筛选 ----------
  // 数据里实际出现的类型/关系/最大深度(用于生成筛选项 + 计数)
  const typeStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of apiNodes) m.set(n.type, (m.get(n.type) || 0) + 1)
    return m
  }, [apiNodes])
  const relationStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of apiEdges) m.set(e.type, (m.get(e.type) || 0) + 1)
    return m
  }, [apiEdges])
  const maxDepthPresent = useMemo(
    () => apiNodes.reduce((mx, n) => Math.max(mx, n.depth), 0),
    [apiNodes]
  )
  const depthSliderCap = useMemo(
    () => Math.max(depthFilterSliderMax, maxDepthPresent, 1),
    [depthFilterSliderMax, maxDepthPresent]
  )
  const maxRunCount = useMemo(
    () => apiNodes.reduce((mx, n) => Math.max(mx, n.data?.runCount ?? 1), 1),
    [apiNodes]
  )

  // 基础筛选(类别/深度/重要度/出现次数)
  const baseFilteredNodes = useMemo(() => {
    return apiNodes.filter(
      (n) =>
        !hiddenTypes.has(n.type) &&
        n.depth <= depthMax &&
        n.importance >= minImportance &&
        (n.data?.runCount ?? 1) >= minRunCount
    )
  }, [apiNodes, hiddenTypes, depthMax, minImportance, minRunCount])

  // 预构建搜索索引：baseFilteredNodes 变化时一次性 toLowerCase，搜索时直接比较，不再每次按键重算
  const searchIndex = useMemo(
    () =>
      baseFilteredNodes.map((n) => ({
        key: n.key,
        node: n,
        text: (n.name + '\0' + (TYPE_LABELS[n.type] || '') + '\0' + n.type).toLowerCase(),
        name: n.name,
        type: n.type,
      })),
    [baseFilteredNodes]
  )

  // 即时自动补全建议（从 searchInput 查索引，不走防抖，直接给下拉框用）
  const suggestions = useMemo(() => {
    const q = searchInput.trim().toLowerCase()
    if (!q) return []
    const result: typeof searchIndex = []
    for (const item of searchIndex) {
      if (item.text.includes(q)) {
        result.push(item)
        if (result.length >= 8) break
      }
    }
    return result
  }, [searchInput, searchIndex])

  // 防抖：searchInput → searchQuery（200ms 后才真正触发图谱高亮，避免每次按键全量重渲染）
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchQuery('')
      return
    }
    const timer = setTimeout(() => setSearchQuery(searchInput), 200)
    return () => clearTimeout(timer)
  }, [searchInput])

  // 搜索命中的节点（用于图谱高亮 + 排行联动）；空查询返回 null 表示不过滤
  const matchedKeys = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    const s = new Set<string>()
    for (const item of searchIndex) {
      if (item.text.includes(q)) s.add(item.key)
    }
    return s
  }, [searchQuery, searchIndex])

  // 「仅显示选择项」开启且有命中时，只保留命中的节点
  const filteredNodes = useMemo(() => {
    if (onlyMatched && matchedKeys) return baseFilteredNodes.filter((n) => matchedKeys.has(n.key))
    return baseFilteredNodes
  }, [baseFilteredNodes, onlyMatched, matchedKeys])

  const visibleKeys = useMemo(() => new Set(filteredNodes.map((n) => n.key)), [filteredNodes])

  const filteredEdges = useMemo(
    () =>
      apiEdges.filter(
        (e) => visibleKeys.has(e.sourceKey) && visibleKeys.has(e.targetKey) && !hiddenRelations.has(e.type)
      ),
    [apiEdges, visibleKeys, hiddenRelations]
  )

  // 性能模式：节点数 > 200 时只渲染 top-200（按重要度）；边同步裁剪
  const PERF_NODE_LIMIT = 200
  const renderNodes = useMemo(() => {
    if (!perfMode || filteredNodes.length <= PERF_NODE_LIMIT) return filteredNodes
    return [...filteredNodes].sort((a, b) => b.importance - a.importance).slice(0, PERF_NODE_LIMIT)
  }, [filteredNodes, perfMode])

  const renderNodeKeys = useMemo(() => {
    if (renderNodes === filteredNodes) return null
    return new Set(renderNodes.map((n) => n.key))
  }, [renderNodes, filteredNodes])

  const renderEdges = useMemo(() => {
    if (!renderNodeKeys) return filteredEdges
    return filteredEdges.filter((e) => renderNodeKeys.has(e.sourceKey) && renderNodeKeys.has(e.targetKey))
  }, [filteredEdges, renderNodeKeys])

  const toggleSet = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const resetFilters = () => {
    setHiddenTypes(new Set())
    setHiddenRelations(new Set())
    setDepthMax(99)
    setMinImportance(0)
    setMinRunCount(1)
  }
  const filterActive =
    hiddenTypes.size > 0 ||
    hiddenRelations.size > 0 ||
    minImportance > 0 ||
    minRunCount > 1 ||
    depthMax < depthSliderCap

  // 选中后：它自己 + 直接相连的节点(用于聚焦高亮)
  const relatedKeys = useMemo(() => {
    if (!selected) return null
    const s = new Set<string>([selected.key])
    for (const e of filteredEdges) {
      if (e.sourceKey === selected.key) s.add(e.targetKey)
      else if (e.targetKey === selected.key) s.add(e.sourceKey)
    }
    return s
  }, [selected, filteredEdges])

  const defaultNodeSizeScale = useMemo(
    () => computeDefaultNodeSizeScale(containerSize.w, containerSize.h, filteredNodes.length),
    [containerSize, filteredNodes.length]
  )

  // 监听图谱容器尺寸(用于按屏幕像素推算默认节点大小)
  useEffect(() => {
    const el = graphWrapRef.current
    if (!el) return
    const sync = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 节点集合变化时自动套用屏幕自适应默认大小(用户手动调过后不再覆盖)
  useEffect(() => {
    if (userSizedRef.current || filteredNodes.length === 0) return
    setNodeSizeScale(defaultNodeSizeScale)
  }, [defaultNodeSizeScale, filteredNodes.length])

  const flowNodes: Node[] = useMemo(() => {
    // 布局始终基于完整 filteredNodes/filteredEdges（避免 renderNodes 变化导致位置突变）
    const pos = livePhysics
      ? layout(filteredNodes)
      : computeLayout(layoutMode, filteredNodes, filteredEdges, nodeSizeScale)
    const searching = matchedKeys != null
    const focusing = relatedKeys != null
    return renderNodes.map((n) => {
      const color = TYPE_COLORS[n.type] || '#64748b'
      const isSel = selected?.key === n.key
      const inFocus = relatedKeys?.has(n.key) ?? false
      const isMatch = matchedKeys?.has(n.key) ?? false
      const dim = (searching && !isMatch) || (focusing && !inFocus)
      return {
        id: n.key,
        type: 'entity',
        position: pos.get(n.key) || { x: 0, y: 0 },
        data: {
          name: n.name,
          type: n.type,
          baseSize: baseNodeSize(n.importance),
          sizeScale: nodeSizeScale,
          color,
          selected: isSel,
          matched: searching && isMatch && !isSel,
          related: focusing && inFocus && !isSel && !(searching && isMatch),
          hovered: sidebarHoveredKey === n.key && !isSel,
          dim,
        },
      }
    })
  }, [renderNodes, filteredNodes, filteredEdges, selected, relatedKeys, matchedKeys, sidebarHoveredKey, nodeSizeScale, layoutMode, livePhysics])

  // 简洁优雅的连线：默认极细浅灰、无箭头无文字；只有选中节点的相连边才加粗高亮 + 显示关系标签
  const flowEdges: Edge[] = useMemo(
    () =>
      renderEdges.map((e, i) => {
        const incident = !!selected && (e.sourceKey === selected.key || e.targetKey === selected.key)
        const bothMatch = !!matchedKeys && matchedKeys.has(e.sourceKey) && matchedKeys.has(e.targetKey)
        const dim = (!!relatedKeys && !incident) || (!!matchedKeys && !bothMatch && !incident)
        return {
          id: `e${i}`,
          source: e.sourceKey,
          target: e.targetKey,
          type: 'straight',
          label: incident ? RELATION_LABELS[e.type] || e.type : undefined,
          animated: incident,
          style: {
            strokeWidth: incident ? 4 : 2.5,
            stroke: incident ? '#f59e0b' : '#94a3b8',
            opacity: incident ? 1 : dim ? 0.12 : 0.65,
          },
          labelStyle: { fontSize: 14, fill: '#b45309', fontWeight: 600 },
          labelBgStyle: { fill: '#fffbeb', fillOpacity: 0.92 },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 6,
          markerEnd: incident ? { type: MarkerType.ArrowClosed, color: '#f59e0b' } : undefined,
          zIndex: incident ? 10 : 0,
        }
      }),
    [renderEdges, selected, relatedKeys, matchedKeys]
  )

  // ReactFlow 内部受控状态(支持拖动)；高亮/筛选变化时合并样式但保留已拖动的位置
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([])

  // 样式/高亮变化时：重建节点对象但保留当前位置(物理模拟或拖动得到的位置)
  useEffect(() => {
    setRfNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]))
      return flowNodes.map((n) => ({ ...n, position: prevPos.get(n.id) || n.position }))
    })
  }, [flowNodes, setRfNodes])

  useEffect(() => {
    setRfEdges(flowEdges)
  }, [flowEdges, setRfEdges])

  // 始终记录屏幕上每个节点的当前坐标(供物理模拟续接 / 切换时无缝衔接)
  useEffect(() => {
    rfNodesPosRef.current = new Map(rfNodes.map((n) => [n.id, n.position]))
  }, [rfNodes])

  // 当前图的结构签名(节点集合 + 边集合)；只有结构变化才重建模拟，避免选中/高亮触发重排
  const graphSig = useMemo(
    () =>
      filteredNodes.map((n) => n.key).join(',') +
      '||' +
      filteredEdges.map((e) => e.sourceKey + '>' + e.targetKey).join(','),
    [filteredNodes, filteredEdges]
  )

  // ---------- Obsidian 式持续力导向模拟 ----------
  useEffect(() => {
    simRef.current?.stop()
    if (!livePhysics || filteredNodes.length === 0) {
      simRef.current = null
      return
    }
    const seed = layout(filteredNodes)
    const screenPos = rfNodesPosRef.current
    const prevSim = simNodesRef.current
    const zoom = rfInstanceRef.current?.getViewport?.()?.zoom ?? 1
    const simNodes: SimNode[] = filteredNodes.map((n) => {
      const here = screenPos.get(n.key) || prevSim.get(n.key) || seed.get(n.key)
      const screenR = baseNodeSize(n.importance) * nodeSizeScale * 0.5 + 10
      return {
        id: n.key,
        r: toGraphPx(screenR, zoom),
        x: here?.x ?? (Math.random() - 0.5) * 280,
        y: here?.y ?? (Math.random() - 0.5) * 280,
        vx: 0,
        vy: 0,
      }
    })
    const map = new Map(simNodes.map((s) => [s.id, s]))
    simNodesRef.current = map
    const links = filteredEdges.map((e) => ({ source: e.sourceKey, target: e.targetKey }))
    const linkDist = toGraphPx(62 * nodeSizeScale, zoom)
    const charge = -95 * nodeSizeScale * Math.min(1.4, Math.sqrt(filteredNodes.length / 30))

    const sim = forceSimulation<SimNode>(simNodes)
      .force('charge', forceManyBody<SimNode>().strength(charge).distanceMax(toGraphPx(420, zoom)))
      .force(
        'link',
        forceLink<SimNode, { source: string; target: string }>(links)
          .id((d) => d.id)
          .distance(linkDist)
          .strength(0.22)
      )
      .force('collide', forceCollide<SimNode>().radius((d) => d.r).strength(0.9).iterations(2))
      .force('x', forceX(0).strength(0.06))
      .force('y', forceY(0).strength(0.06))
      .alpha(0.9)
      .alphaDecay(0.02)
      .velocityDecay(0.42)

    // 节流到 ~30fps，减少 React 渲染压力
    let lastTickTime = 0
    sim.on('tick', () => {
      const now = performance.now()
      if (now - lastTickTime < 33) return
      lastTickTime = now
      setRfNodes((prev) =>
        prev.map((n) => {
          const s = map.get(n.id)
          return s ? { ...n, position: { x: s.x ?? 0, y: s.y ?? 0 } } : n
        })
      )
    })
    // 稳定后自动居中(留白适中，避免缩放过小导致节点/文字显得遥远)
    sim.on('end', () => {
      rfInstanceRef.current?.fitView({ duration: 400, padding: 0.12 })
    })
    simRef.current = sim

    return () => {
      sim.stop()
    }
    // 仅依赖结构签名与开关；位置从 ref 读取以免每帧重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSig, livePhysics, nodeSizeScale])

  // 「仅显示选择项」开启 + 非物理模式时：可见集合或布局变化 → 自动重新排列(Finder 清理效果)
  useEffect(() => {
    if (!onlyMatched) {
      arrangeSigRef.current = ''
      return
    }
    if (livePhysics) return
    const sig = layoutMode + '|' + filteredNodes.map((n) => n.key).join(',')
    if (sig === arrangeSigRef.current) return
    arrangeSigRef.current = sig
    const pos = computeLayout(layoutMode, filteredNodes, filteredEdges, nodeSizeScale)
    setRfNodes((prev) => prev.map((n) => ({ ...n, position: pos.get(n.id) || n.position })))
    setTimeout(() => rfInstanceRef.current?.fitView({ duration: 500, padding: 0.12 }), 60)
  }, [onlyMatched, livePhysics, layoutMode, filteredNodes, filteredEdges, nodeSizeScale, setRfNodes])

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      const n = apiNodes.find((x) => x.key === node.id) || null
      setSelected(n)
      if (n) setRankDetailOpen(true)
    },
    [apiNodes]
  )

  // 拖动节点：物理模式下钉住并升温，松手后释放让其自然回落(Obsidian 手感)
  const onNodeDragStart = useCallback((_: any, node: Node) => {
    if (!livePhysics) return
    const s = simNodesRef.current.get(node.id)
    if (s) { s.fx = node.position.x; s.fy = node.position.y }
    simRef.current?.alphaTarget(0.3).restart()
  }, [livePhysics])
  const onNodeDrag = useCallback((_: any, node: Node) => {
    if (!livePhysics) return
    const s = simNodesRef.current.get(node.id)
    if (s) { s.fx = node.position.x; s.fy = node.position.y }
  }, [livePhysics])
  const onNodeDragStop = useCallback((_: any, node: Node) => {
    if (!livePhysics) return
    const s = simNodesRef.current.get(node.id)
    if (s) { s.fx = null; s.fy = null }
    simRef.current?.alphaTarget(0)
  }, [livePhysics])

  // 切换「灵动」物理布局
  const toggleLivePhysics = useCallback(() => {
    setLivePhysics((v) => {
      if (!v) setShowLayoutMenu(false)
      return !v
    })
  }, [])

  const parsedUrls = useMemo(() => parseUrlsFromText(seedInput), [seedInput])

  const ranked = useMemo(() => [...filteredNodes].sort((a, b) => b.importance - a.importance), [filteredNodes])
  // 搜索时排行榜只显示命中项
  const rankedShown = useMemo(
    () => (matchedKeys ? ranked.filter((n) => matchedKeys.has(n.key)) : ranked),
    [ranked, matchedKeys]
  )

  const showRankDetail = !!selected && (detailPinned || rankDetailOpen)

  // 点击「整理图谱」→ 暂停物理、用所选静态布局重排当前可见节点，并自适应居中
  const applyLayout = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(mode)
      setShowLayoutMenu(false)
      setLivePhysics(false)
      simRef.current?.stop()
      const pos = computeLayout(mode, filteredNodes, filteredEdges, nodeSizeScale)
      setRfNodes((prev) => prev.map((n) => ({ ...n, position: pos.get(n.id) || n.position })))
      setTimeout(() => rfInstanceRef.current?.fitView({ duration: 600, padding: 0.12 }), 60)
    },
    [filteredNodes, filteredEdges, nodeSizeScale, setRfNodes]
  )

  const resetNodeSizeToDefault = useCallback(() => {
    userSizedRef.current = false
    setNodeSizeScale(defaultNodeSizeScale)
    simRef.current?.alpha(0.35).restart()
  }, [defaultNodeSizeScale])

  const onNodeSizeScaleChange = useCallback((v: number) => {
    userSizedRef.current = true
    setNodeSizeScale(v)
    simRef.current?.alpha(0.3).restart()
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-slate-100 flex flex-col">
      <AppHeader
        titleKey="pages.deepSearch.title"
        subtitleKey="pages.deepSearch.subtitle"
        icon={Search}
        compact
        showTheme={false}
      />

      {/* 控制栏 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 space-y-3">
        {/* 起点输入：文本 / 链接 / 文件 */}
        <div className="flex flex-wrap items-start gap-3">
          <div
            className="flex-1 min-w-[320px]"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) pickFile(f)
            }}
          >
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              {([
                { id: 'text', label: t('deepSearch.inputText'), icon: Type },
                { id: 'url', label: t('deepSearch.inputUrl'), icon: Link2 },
                { id: 'file', label: t('deepSearch.inputFile'), icon: Upload },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setInputModeOverride(id); setResolveError(null); setResolvedSeed(null); lastSigRef.current = '' }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    inputMode === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
              <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 ml-1">
                <Sparkles className="w-3 h-3" />
                {t('deepSearch.autoDetect')}: {INPUT_MODE_LABELS[autoInputMode][locale]}
                {inputModeOverride && inputModeOverride !== autoInputMode && (
                  <span className="text-slate-400">→ {INPUT_MODE_LABELS[inputMode][locale]}</span>
                )}
              </span>
              <span className="text-[11px] text-slate-400">{t('deepSearch.seedHint')}</span>
            </div>

            {inputMode === 'url' ? (
              <textarea
                value={seedInput}
                onChange={(e) => onSeedInputChange(e.target.value)}
                rows={3}
                className="w-full border-2 border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 resize-y min-h-[72px]"
                placeholder={locale === 'zh'
                  ? '每行一个链接，或用逗号/空格分隔；可一次粘贴多个站点，将合并爬取并搜索'
                  : 'One URL per line, or comma/space separated; multiple sites will be crawled together'}
              />
            ) : (
              <input
                value={seedInput}
                onChange={(e) => onSeedInputChange(e.target.value)}
                className="w-full border-2 border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                placeholder={t('deepSearch.placeholder')}
              />
            )}

            {inputMode === 'url' && parsedUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parsedUrls.map((u) => (
                  <span
                    key={u}
                    className="inline-flex items-center gap-1 max-w-full text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-full px-2 py-0.5"
                    title={u}
                  >
                    <Link2 className="w-3 h-3 shrink-0" />
                    <span className="truncate max-w-[280px]">{(() => { try { return new URL(u).hostname } catch { return u } })()}</span>
                  </span>
                ))}
                <span className="text-[11px] text-slate-500 self-center">
                  {locale === 'zh' ? `共 ${parsedUrls.length} 个链接，将一起爬取` : `${parsedUrls.length} URLs will be crawled`}
                </span>
              </div>
            )}

            {inputMode === 'url' && (
              <div className="flex items-center gap-2 flex-wrap text-xs mt-2">
                <span className="flex items-center gap-1 text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-2 py-0.5">
                  <Link2 className="w-3 h-3" /> {t('deepSearch.crawlMode')}
                </span>
                <span className="text-slate-500">
                  {locale === 'zh'
                    ? `每个链接自动翻页抓取 → 批量抽取实体 → 多站合并后深挖`
                    : t('deepSearch.crawlDesc')}
                </span>
                <label className="flex items-center gap-1.5 text-slate-600">
                  <span className="flex items-center rounded-lg border-2 border-slate-300 overflow-hidden text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => { setCrawlPageMode('auto'); if (crawlPages <= 20) setCrawlPages(50) }}
                      className={`px-2.5 py-1 transition-colors ${crawlPageMode === 'auto' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {t('deepSearch.crawlPageAuto')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCrawlPageMode('fixed'); if (crawlPages > 20) setCrawlPages(4) }}
                      className={`px-2.5 py-1 transition-colors ${crawlPageMode === 'fixed' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {t('deepSearch.crawlPageFixed')}
                    </button>
                  </span>
                  {crawlPageMode === 'auto' ? (
                    <>
                      <span className="text-slate-500">{t('deepSearch.crawlPageAutoHint')}</span>
                      <span className="text-slate-400">·</span>
                      <span>{t('deepSearch.crawlPageCap')}</span>
                      <input
                        type="number"
                        min={5}
                        max={50}
                        value={crawlPages}
                        onChange={(e) => setCrawlPages(Math.min(50, Math.max(5, parseInt(e.target.value) || 50)))}
                        className="w-14 border-2 border-slate-300 rounded-lg px-2 py-1 text-slate-900 focus:outline-none focus:border-slate-900"
                      />
                    </>
                  ) : (
                    <>
                      <span>{t('deepSearch.crawlPages')}</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={crawlPages}
                        onChange={(e) => setCrawlPages(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="w-14 border-2 border-slate-300 rounded-lg px-2 py-1 text-slate-900 focus:outline-none focus:border-slate-900"
                      />
                    </>
                  )}
                </label>
              </div>
            )}

            {inputMode === 'file' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] || null) }}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-xl px-3 py-3 text-sm cursor-pointer flex items-center gap-3 transition-colors ${
                  dragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.txt,.md,.markdown"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <>
                    {file.type.startsWith('image/') ? <ImageIcon className="w-5 h-5 text-slate-500 shrink-0" /> : <FileText className="w-5 h-5 text-slate-500 shrink-0" />}
                    <span className="text-slate-700 truncate flex-1">{file.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); pickFile(null) }}
                      className="text-slate-400 hover:text-slate-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-slate-400 shrink-0" />
                    <span className="text-slate-400">{t('deepSearch.uploadHint')}</span>
                  </>
                )}
              </div>
            )}

            {/* 解析结果 / 错误 */}
            {resolvedSeed && !resolveError && (
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Sparkles className="w-3 h-3" /> {t('deepSearch.resolvedAs')}
                </span>
                <b className="text-slate-900">{resolvedSeed.seedName}</b>
                <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[resolvedSeed.seedType] || '#64748b' }} />
                <span className="text-slate-500">{TYPE_LABELS[resolvedSeed.seedType] || resolvedSeed.seedType}</span>
                {resolvedSeed.summary && <span className="text-slate-400 truncate max-w-[420px]">· {resolvedSeed.summary}</span>}
              </div>
            )}
            {!resolvedSeed && !resolveError && inputMode === 'text' && (prechecking || precheck) && (
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                <span className="flex items-center gap-1 text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                  {prechecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  查询预检测
                </span>
                {precheck && (
                  <>
                    <b className="text-slate-900">{precheck.normalizedName}</b>
                    <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[precheck.type] || '#64748b' }} />
                    <span className="text-slate-500">{TYPE_LABELS[precheck.type] || precheck.type}</span>
                    <span className="text-slate-400">置信度 {(precheck.confidence * 100).toFixed(0)}%</span>
                    {precheck.candidates.length > 1 && <span className="text-amber-600">候选 {precheck.candidates.length} 个</span>}
                    {precheck.searchTerms.slice(0, 3).map((term) => (
                      <span key={term} className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 max-w-[180px] truncate">
                        {term}
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}
            {resolveError && (
              <p className="mt-2 text-xs text-red-600">{resolveError}</p>
            )}
          </div>
        </div>

        {/* 参数 + 操作 */}
        <div className="flex flex-wrap items-end gap-3">
          {inputMode !== 'url' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">{t('deepSearch.type')}{resolvedSeed ? t('deepSearch.typeEditable') : ''}</label>
              <select
                value={seedType}
                onChange={(e) => setSeedType(e.target.value)}
                className="border-2 border-slate-300 rounded-xl px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:border-slate-900"
              >
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('deepSearch.depth')} {maxDepth}</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={10}
                value={maxDepth}
                onChange={(e) => setMaxDepth(+e.target.value)}
                className="w-24"
              />
              <input
                type="number"
                min={1}
                max={10}
                value={maxDepth}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!Number.isNaN(v)) setMaxDepth(clampInt(v, 1, 10))
                }}
                className="w-14 border-2 border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-900 text-center focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('deepSearch.perLevel')} {maxPerLevel}</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={10}
                value={maxPerLevel}
                onChange={(e) => setMaxPerLevel(+e.target.value)}
                className="w-24"
              />
              <input
                type="number"
                min={1}
                max={10}
                value={maxPerLevel}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!Number.isNaN(v)) setMaxPerLevel(clampInt(v, 1, 10))
                }}
                className="w-14 border-2 border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-900 text-center focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>
          {!running ? (
            <button
              onClick={start}
              disabled={resolving}
              className="bg-slate-900 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2"
            >
              {resolving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('deepSearch.resolving')}</> : <><Play className="w-4 h-4" /> {t('deepSearch.start')}</>}
            </button>
          ) : (
            <button
              onClick={stop}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> {t('deepSearch.stop')}
            </button>
          )}
        </div>
      </div>

      {/* 视图切换 + 搜索 + 历史 */}
      <div className="bg-slate-50 border-b-2 border-slate-200 px-6 py-3 flex items-center gap-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0">视图</span>
        <div className="flex items-center bg-white border-2 border-slate-300 rounded-xl p-1 shadow-sm shrink-0">
          <button
            onClick={() => {
              if (viewMode !== 'run') {
                setViewMode('run')
                setSelected(null)
                setRankDetailOpen(false)
                setDetailPinned(false)
                if (!run) { setApiNodes([]); setApiEdges([]) }
              }
            }}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === 'run' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Search className="w-4 h-4" /> 单次
          </button>
          <button
            onClick={loadGlobal}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              viewMode === 'global' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Network className="w-4 h-4" /> 全局总图
          </button>
        </div>

        {/* 搜索：夹在全局总图与历史之间，居中 */}
        <div className="flex-1 flex items-center justify-center gap-3 min-w-0 px-2">
          {/* 带自动补全的搜索框 */}
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <input
              ref={searchInputRef}
              value={searchInput}
              onChange={(e) => {
                const v = e.target.value
                setSearchInput(v)
                setShowSuggestions(true)
                setActiveSuggestionIdx(-1)
              }}
              onFocus={() => { if (searchInput) setShowSuggestions(true) }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onKeyDown={(e) => {
                if (!showSuggestions || suggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveSuggestionIdx((i) => Math.min(i + 1, suggestions.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveSuggestionIdx((i) => Math.max(i - 1, -1))
                } else if (e.key === 'Enter' && activeSuggestionIdx >= 0) {
                  e.preventDefault()
                  const item = suggestions[activeSuggestionIdx]
                  setSearchInput(item.name)
                  setSearchQuery(item.name)
                  setShowSuggestions(false)
                  setActiveSuggestionIdx(-1)
                  const n = item.node
                  setSelected(n)
                  setRankDetailOpen(true)
                  setTimeout(() => rfInstanceRef.current?.fitView({ nodes: [{ id: n.key }], duration: 400, padding: 0.35 }), 60)
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false)
                  setActiveSuggestionIdx(-1)
                }
              }}
              placeholder={t('deepSearch.searchHighlight')}
              className="w-full border-2 border-slate-200 rounded-lg pl-8 pr-7 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 bg-white"
              autoComplete="off"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('')
                  setSearchQuery('')
                  setShowSuggestions(false)
                  searchInputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 z-10"
                title="清空"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Google 式自动补全下拉 */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                {suggestions.map((item, i) => {
                  const Icon = TYPE_ICONS[item.type] || Circle
                  const isActive = i === activeSuggestionIdx
                  const q = searchInput.trim().toLowerCase()
                  // 高亮匹配部分
                  const nameLower = item.name.toLowerCase()
                  const idx = nameLower.indexOf(q)
                  const highlighted =
                    idx >= 0 ? (
                      <>
                        {item.name.slice(0, idx)}
                        <span className="font-bold text-slate-900">{item.name.slice(idx, idx + q.length)}</span>
                        {item.name.slice(idx + q.length)}
                      </>
                    ) : item.name
                  return (
                    <button
                      key={item.key}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSearchInput(item.name)
                        setSearchQuery(item.name)
                        setShowSuggestions(false)
                        setActiveSuggestionIdx(-1)
                        const n = item.node
                        setSelected(n)
                        setRankDetailOpen(true)
                        setTimeout(() => rfInstanceRef.current?.fitView({ nodes: [{ id: n.key }], duration: 400, padding: 0.35 }), 60)
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm border-b border-slate-50 last:border-0 transition-colors ${
                        isActive ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: TYPE_COLORS[item.type] || '#64748b' }}
                      >
                        <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2.4} />
                      </span>
                      <span className="flex-1 truncate text-slate-700">{highlighted}</span>
                      <span className="text-[11px] text-slate-400 shrink-0">{TYPE_LABELS[item.type] || item.type}</span>
                    </button>
                  )
                })}
                {/* 搜索全部提示 */}
                <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 flex items-center gap-1">
                  <Search className="w-3 h-3" />
                  按 Enter 高亮全部 {matchedKeys?.size ?? suggestions.length} 个匹配节点
                </div>
              </div>
            )}
          </div>
          {matchedKeys && (
            <p className="text-[11px] text-slate-500 shrink-0">
              {matchedKeys.size > 0 ? (
                <>高亮 <b className="text-emerald-600">{matchedKeys.size}</b> 个</>
              ) : (
                <span className="text-slate-400">无匹配</span>
              )}
            </p>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-xs whitespace-nowrap ${matchedKeys ? 'text-slate-600' : 'text-slate-400'}`}>
              {t('deepSearch.onlyMatched')}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={onlyMatched}
              disabled={!matchedKeys}
              onClick={() => setOnlyMatched((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                onlyMatched ? 'bg-emerald-500' : 'bg-slate-300'
              } ${!matchedKeys ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              title={matchedKeys ? '只保留搜索命中的节点，并重新排列' : '先搜索以选择节点'}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  onlyMatched ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* 历史运行(数据库) */}
        <div className="relative shrink-0">
          <button
            onClick={() => { setShowHistory((v) => !v); fetchHistory() }}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 bg-white border-2 border-slate-300 rounded-xl px-4 py-2 shadow-sm"
          >
            <History className="w-4 h-4" /> 历史 ({history.length})
          </button>
          {showHistory && (
            <div className="absolute right-0 top-full mt-2 w-96 max-h-[70vh] overflow-y-auto bg-white border-2 border-slate-200 rounded-2xl shadow-xl z-20">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 sticky top-0 bg-white">
                <span className="text-xs font-bold text-slate-700">数据库中的运行记录</span>
                <button onClick={() => fetchHistory()} className="text-slate-400 hover:text-slate-900">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              {history.length === 0 && <p className="px-4 py-6 text-xs text-slate-400 text-center">还没有运行记录</p>}
              {history.map((h) => (
                <div
                  key={h.id}
                  onClick={() => loadRun(h.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-slate-50 border-b border-slate-50 ${
                    h.id === runId ? 'bg-slate-50' : ''
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[h.seedType] || '#64748b' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-800 truncate font-medium">{h.seedName}</div>
                    <div className="text-[11px] text-slate-400">
                      {TYPE_LABELS[h.seedType] || h.seedType} · {h.nodeCount}节点/{h.edgeCount}边 · {new Date(h.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    h.status === 'completed' ? 'bg-emerald-50 text-emerald-600'
                    : h.status === 'running' || h.status === 'pending' ? 'bg-blue-50 text-blue-600'
                    : h.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                  }`}>{h.status}</span>
                  <button onClick={(e) => deleteRun(h.id, e)} className="text-slate-300 hover:text-red-500 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {run && (
        <div className="bg-white border-b border-slate-200 px-6 py-2">
          <div className="flex items-center gap-3">
            {running && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
            <span className="text-xs text-slate-600 flex-1 truncate">{run.message || run.status}</span>
            <span className="text-xs text-slate-400">{run.progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${run.status === 'failed' ? 'bg-red-500' : 'bg-slate-900'}`}
              style={{ width: `${run.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 主体：筛选 + 图 + 侧栏 */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧筛选面板 */}
        {filterOpen ? (
          <aside className="w-64 bg-white border-r-2 border-slate-200 overflow-y-auto shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-700" />
                <span className="text-sm font-bold text-slate-900">筛选</span>
              </div>
              <div className="flex items-center gap-2">
                {filterActive && (
                  <button onClick={resetFilters} className="text-xs text-blue-600 hover:underline">重置</button>
                )}
                <button onClick={() => setFilterOpen(false)} className="text-slate-400 hover:text-slate-900">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-5">
              {/* 统计 */}
              <div className="text-xs text-slate-500">
                显示 <b className="text-slate-900">{filteredNodes.length}</b> / {apiNodes.length} 节点 ·{' '}
                <b className="text-slate-900">{filteredEdges.length}</b> / {apiEdges.length} 关系
              </div>

              {/* 类型图例(像地图图层开关) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-600">数据类别（图例）</label>
                  {typeStats.size > 1 && (
                    <div className="flex gap-2 text-[11px]">
                      <button onClick={() => setHiddenTypes(new Set())} className="text-blue-600 hover:underline">全选</button>
                      <button onClick={() => setHiddenTypes(new Set(Array.from(typeStats.keys())))} className="text-slate-400 hover:underline">全不选</button>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  {NODE_TYPES.filter((t) => typeStats.has(t)).map((t) => {
                    const on = !hiddenTypes.has(t)
                    const Icon = TYPE_ICONS[t] || Circle
                    return (
                      <button
                        key={t}
                        onClick={() => toggleSet(setHiddenTypes, t)}
                        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm transition-opacity ${
                          on ? 'hover:bg-slate-100' : 'opacity-40 hover:opacity-70'
                        }`}
                      >
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: on ? TYPE_COLORS[t] : '#cbd5e1' }}
                        >
                          <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2.4} />
                        </span>
                        <span className={`flex-1 ${on ? 'text-slate-700 font-medium' : 'text-slate-400 line-through'}`}>{TYPE_LABELS[t]}</span>
                        <span className="text-xs text-slate-400 tabular-nums">{typeStats.get(t)}</span>
                      </button>
                    )
                  })}
                  {typeStats.size === 0 && <p className="text-xs text-slate-400">暂无数据（先跑一次搜索）</p>}
                </div>
              </div>

              {/* 关系类型 */}
              {relationStats.size > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">关系类型</label>
                  <div className="space-y-1">
                    {Array.from(relationStats.keys()).map((r) => {
                      const on = !hiddenRelations.has(r)
                      return (
                        <button
                          key={r}
                          onClick={() => toggleSet(setHiddenRelations, r)}
                          className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-sm transition-opacity ${
                            on ? 'hover:bg-slate-100' : 'opacity-40 hover:opacity-70'
                          }`}
                        >
                          <span className={`flex-1 ${on ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{RELATION_LABELS[r] || r}</span>
                          <span className="text-xs text-slate-400">{relationStats.get(r)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 深度 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  {t('deepSearch.showDepth')} {Math.min(depthMax, depthSliderCap)}
                  {depthMax >= depthSliderCap && <span className="text-slate-400"> {t('deepSearch.depthAll')}</span>}
                </label>
                <input
                  type="range"
                  min={0}
                  max={depthSliderCap}
                  value={Math.min(depthMax, depthSliderCap)}
                  onChange={(e) => setDepthMax(+e.target.value)}
                  className="w-full"
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-slate-500 shrink-0">{t('deepSearch.depthSliderMax')}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={depthFilterSliderMax}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10)
                      if (!Number.isNaN(v)) {
                        const cap = clampInt(v, 1, 99)
                        setDepthFilterSliderMax(cap)
                        if (depthMax > cap) setDepthMax(cap)
                      }
                    }}
                    className="w-14 border-2 border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900 text-center focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              {/* 重要度阈值 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  最低重要度 ≥ {minImportance.toFixed(2)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minImportance}
                  onChange={(e) => setMinImportance(+e.target.value)}
                  className="w-full"
                />
              </div>

              {/* 出现次数(仅全局总图，多次搜索反复印证=高可信) */}
              {maxRunCount > 1 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    至少出现在 {minRunCount} 次搜索中
                    {minRunCount > 1 && <span className="text-emerald-600"> · 高可信</span>}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={maxRunCount}
                    value={Math.min(minRunCount, maxRunCount)}
                    onChange={(e) => setMinRunCount(+e.target.value)}
                    className="w-full"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">被多次独立搜索反复发现的实体更可靠</p>
                </div>
              )}
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setFilterOpen(true)}
            className="w-9 shrink-0 bg-white border-r-2 border-slate-200 flex flex-col items-center gap-2 py-3 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            title="展开筛选"
          >
            <Filter className="w-4 h-4" />
            {filterActive && <span className="w-2 h-2 rounded-full bg-blue-500" />}
            <span className="text-xs [writing-mode:vertical-rl]">筛选</span>
          </button>
        )}

        <div className="flex-1 relative" ref={graphWrapRef}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={perfMode ? nodeTypesFast : nodeTypesNormal}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={() => { setSelected(null); setRankDetailOpen(false); setDetailPinned(false); setShowLayoutMenu(false) }}
            onNodeMouseEnter={(_, node) => setGraphHoveredKey(node.id)}
            onNodeMouseLeave={() => setGraphHoveredKey(null)}
            onInit={(inst) => { rfInstanceRef.current = inst }}
            fitView
            minZoom={0.15}
            maxZoom={2.5}
          >
            <Background color="#e2e8f0" gap={26} size={1.5} />
            <Controls />
            {!perfMode && <MiniMap nodeColor={(n) => ((n.data as EntityNodeData)?.color) || '#64748b'} pannable zoomable />}
          </ReactFlow>

          {/* 浮动工具栏(左上)：灵动开关 + 整理图谱 */}
          {filteredNodes.length > 0 && (
            <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 max-w-[calc(100%-1.5rem)]">
              {/* 性能模式开关 */}
              <button
                onClick={() => setPerfMode((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium border-2 shadow-sm transition-colors ${
                  perfMode
                    ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600'
                    : 'bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:border-slate-900'
                }`}
                title={perfMode
                  ? '性能模式开启：固定节点大小、无 MiniMap，最多显示 200 节点。点击关闭恢复完整效果'
                  : '开启性能模式：大幅降低渲染开销，适合节点数量多时使用'}
              >
                <Zap className="w-4 h-4" />
                性能 {perfMode ? '开' : '关'}
                {perfMode && renderNodeKeys && (
                  <span className="ml-1 text-xs font-normal opacity-80">{renderNodes.length}/{filteredNodes.length}</span>
                )}
              </button>
              <button
                onClick={toggleLivePhysics}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium border-2 shadow-sm transition-colors ${
                  livePhysics
                    ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-white/95 backdrop-blur border-slate-200 text-slate-700 hover:border-slate-900'
                }`}
                title={livePhysics ? '灵动布局开启中：节点自动归位，点击关闭' : '开启灵动布局：节点自动散开归位（Obsidian 效果）'}
              >
                <Atom className={`w-4 h-4 ${livePhysics ? 'animate-spin [animation-duration:4s]' : ''}`} />
                灵动 {livePhysics ? '开' : '关'}
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowLayoutMenu((v) => !v)}
                  className="flex items-center gap-1.5 bg-white/95 backdrop-blur border-2 border-slate-200 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-900 shadow-sm"
                  title="用固定布局重新整理图谱(会暂停灵动)"
                >
                  <Wand2 className="w-4 h-4" /> 整理图谱
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLayoutMenu ? 'rotate-180' : ''}`} />
                </button>
                {showLayoutMenu && (
                  <div className="absolute left-0 top-full mt-1.5 w-60 bg-white border-2 border-slate-200 rounded-xl shadow-xl overflow-hidden">
                    {LAYOUT_OPTIONS.map(({ id, label, desc, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => applyLayout(id)}
                        className={`w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0 ${
                          layoutMode === id ? 'bg-slate-50' : ''
                        }`}
                      >
                        <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${layoutMode === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">{label}</span>
                          <span className="block text-[11px] text-slate-400">{desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div
                className="flex items-center gap-2 bg-white/95 backdrop-blur border-2 border-slate-200 rounded-xl px-3 py-1.5 shadow-sm"
                title="调节节点在屏幕上的显示大小；缩放图谱时节点/文字会自动适应"
              >
                <span className="text-xs text-slate-500 whitespace-nowrap">节点</span>
                <input
                  type="range"
                  min={0.35}
                  max={2.2}
                  step={0.05}
                  value={nodeSizeScale}
                  onChange={(e) => onNodeSizeScaleChange(parseFloat(e.target.value))}
                  className="w-20 accent-slate-900"
                />
                <span className="text-xs font-medium text-slate-700 w-9 tabular-nums">{nodeSizeScale.toFixed(1)}×</span>
                <button
                  onClick={resetNodeSizeToDefault}
                  className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 border-l border-slate-200 pl-2 ml-0.5"
                  title={`恢复为屏幕自适应默认大小（约 ${defaultNodeSizeScale.toFixed(1)}×）`}
                >
                  <Maximize2 className="w-3 h-3" />
                  默认
                </button>
              </div>
            </div>
          )}
          {apiNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400">
              输入一个起点（艺术家 / 展览 / 学者…），点击「开始搜索」
            </div>
          )}
          {apiNodes.length > 0 && filteredNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
              <span>没有符合筛选条件的节点</span>
              <button onClick={resetFilters} className="text-sm text-blue-600 hover:underline pointer-events-auto">重置筛选</button>
            </div>
          )}
        </div>

        {/* 侧栏：重要度排行 + 详情 (固定高度，内部滚动，可折叠) */}
        {rankOpen ? (
          <aside
            className="w-80 bg-white border-l-2 border-slate-200 shrink-0 flex flex-col min-h-0"
            onMouseLeave={() => { if (!detailPinned) setRankDetailOpen(false) }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <span className="text-sm font-bold text-slate-900">重要度排行 ({rankedShown.length})</span>
              <button onClick={() => setRankOpen(false)} className="text-slate-400 hover:text-slate-900" title="收起">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {showRankDetail && selected && (
                <div className="sticky top-0 z-10 bg-white p-4 border-b-2 border-slate-200 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: TYPE_COLORS[selected.type] }}>
                        {(() => { const I = TYPE_ICONS[selected.type] || Circle; return <I className="w-3.5 h-3.5 text-white" strokeWidth={2.4} /> })()}
                      </span>
                      <span className="text-xs text-slate-500">{TYPE_LABELS[selected.type]}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailPinned((v) => !v)}
                      className={`shrink-0 p-1 rounded-md transition-colors ${
                        detailPinned ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                      }`}
                      title={detailPinned ? '取消固定' : '固定详情'}
                    >
                      <Pin className={`w-4 h-4 ${detailPinned ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  <h3 className="font-bold text-slate-900">{selected.name}</h3>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-600">
                    <div>重要度: <b className="text-slate-900">{selected.importance.toFixed(3)}</b></div>
                    <div>连接数: <b className="text-slate-900">{selected.degree}</b></div>
                    <div>PageRank: <b className="text-slate-900">{selected.pagerank.toFixed(4)}</b></div>
                    <div>发现次数: <b className="text-slate-900">{selected.discoveryCount}</b></div>
                    <div>深度: <b className="text-slate-900">{selected.depth}</b></div>
                    {selected.data?.year && <div>年份: <b className="text-slate-900">{selected.data.year}</b></div>}
                    {viewMode === 'global' && selected.data?.runCount != null && (
                      <div>出现搜索数: <b className="text-slate-900">{selected.data.runCount}</b></div>
                    )}
                  </div>
                  {selected.data?.evidence && (
                    <p className="text-xs text-slate-500 mt-3 leading-relaxed">{selected.data.evidence}</p>
                  )}
	                  {selected.data?.sourceUrl && (
	                    <a
	                      href={selected.data.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline break-all"
                    >
	                      <Link2 className="w-3 h-3 shrink-0" /> 来源 · 可核验
	                    </a>
	                  )}
	                  {selected.data?.identity?.wikidataId && (
	                    <a
	                      href={selected.data.identity.url || `https://www.wikidata.org/wiki/${selected.data.identity.wikidataId}`}
	                      target="_blank"
	                      rel="noopener noreferrer"
	                      className="mt-2 ml-2 inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"
	                    >
	                      <Atom className="w-3 h-3 shrink-0" /> {selected.data.identity.wikidataId}
	                    </a>
	                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startAnchored([{ name: selected.name, type: selected.type, identity: selected.data?.identity || null }])}
                      disabled={running}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="以此节点为起点，联网检索真实资料继续向下深挖(核实后归档)"
                    >
                      <Target className="w-3.5 h-3.5" /> 从此节点深挖
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSeedQueue({ name: selected.name, type: selected.type, data: selected.data })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        inSeedQueue(selected)
                          ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {inSeedQueue(selected) ? '✓ 已加入队列' : '＋ 加入深挖队列'}
                    </button>
                  </div>
                </div>
              )}
              <div className="p-3">
                <div className="space-y-1">
                  {rankedShown.map((n, i) => {
                    const I = TYPE_ICONS[n.type] || Circle
                    return (
                      <button
                        key={n.key}
                        ref={(el) => { if (el) rankItemRefs.current.set(n.key, el); else rankItemRefs.current.delete(n.key) }}
                        onClick={() => { setSelected(n); setRankDetailOpen(true) }}
                        onDoubleClick={() => rfInstanceRef.current?.fitView({ nodes: [{ id: n.key }], duration: 400, padding: 0.35 })}
                        onMouseEnter={() => setSidebarHoveredKey(n.key)}
                        onMouseLeave={() => setSidebarHoveredKey(null)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                          selected?.key === n.key
                            ? 'bg-slate-100 ring-1 ring-slate-300'
                            : graphHoveredKey === n.key
                              ? 'bg-indigo-50 ring-1 ring-indigo-300'
                              : 'hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}</span>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: TYPE_COLORS[n.type] }}>
                          <I className="w-3 h-3 text-white" strokeWidth={2.4} />
                        </span>
                        <span className="text-sm text-slate-700 flex-1 truncate">{n.name}</span>
                        <span className="text-xs text-slate-400 tabular-nums">{n.importance.toFixed(2)}</span>
                      </button>
                    )
                  })}
                  {rankedShown.length === 0 && (
                    <p className="text-xs text-slate-400 px-2 py-3">{matchedKeys ? '没有匹配的节点' : '暂无数据'}</p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setRankOpen(true)}
            className="w-9 shrink-0 bg-white border-l-2 border-slate-200 flex flex-col items-center gap-2 py-3 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            title="展开重要度排行"
          >
            <span className="text-xs [writing-mode:vertical-rl]">重要度排行</span>
          </button>
        )}
      </div>

      {/* 实时进程控制台(像 Cursor 那样看每一步) */}
      {seedQueue.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full bg-slate-900 text-white shadow-2xl ring-1 ring-white/10">
          <Target className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-sm shrink-0">
            深挖队列 <b className="tabular-nums">{seedQueue.length}</b> 点
          </span>
          <span className="hidden sm:inline text-xs text-slate-400 max-w-[260px] truncate">
            {seedQueue.map((s) => s.name).join('、')}
          </span>
          <button
            type="button"
            onClick={() => startAnchored(seedQueue)}
            disabled={running}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Search className="w-3.5 h-3.5" /> 从这些节点深挖
          </button>
          <button
            type="button"
            onClick={() => setSeedQueue([])}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 shrink-0"
            title="清空队列"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="border-t-2 border-slate-800 bg-slate-900 text-slate-100 shrink-0">
        <button
          onClick={() => setConsoleOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-slate-800"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <Search className="w-3.5 h-3.5 text-slate-400" />}
          <span>进程控制台</span>
          <span className="text-slate-500">({logs.length} 条)</span>
          {running && <span className="text-blue-400">运行中…</span>}
          <span className="ml-auto text-slate-400">{consoleOpen ? '收起 ▾' : '展开 ▸'}</span>
        </button>
        {consoleOpen && (
          <div className="h-56 overflow-y-auto px-4 pb-3 font-mono text-[12px] leading-relaxed">
            {logs.length === 0 && (
              <p className="text-slate-500 py-3">暂无日志。点击「开始搜索」后，这里会实时显示每一步（调用 Codex、返回实体、新增节点…）。</p>
            )}
            {logs.map((l) => (
              <div key={l.seq} className="flex gap-2 py-0.5">
                <span className="text-slate-600 shrink-0">{new Date(l.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                <span className={`shrink-0 w-12 ${LOG_LEVEL_STYLE[l.level]?.cls || 'text-slate-400'}`}>{LOG_LEVEL_STYLE[l.level]?.tag || l.level}</span>
                <span className="text-slate-200 whitespace-pre-wrap break-words">{l.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
