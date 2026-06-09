'use client'

import { useState, useEffect, useRef, useMemo, useCallback, type MouseEvent as ReactMouseEvent, type Dispatch, type SetStateAction } from 'react'
import ReactFlow, { Background, Controls, MiniMap, Node, Edge, MarkerType, Handle, Position, type NodeProps } from 'reactflow'
import 'reactflow/dist/style.css'
import { Search, Play, Square, Loader2, ArrowLeft, Type, Link2, Upload, FileText, ImageIcon, X, Sparkles, History, Trash2, RefreshCw, Filter,
  Palette, Building2, UserCheck, Waves, MapPin, GraduationCap, Newspaper, Frame, Circle, type LucideIcon } from 'lucide-react'

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
  data: { year?: number | null; evidence?: string | null } | null
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

// 自定义“地图标记”节点：彩色圆形 + 类别图标 + 下方名字标签
interface EntityNodeData {
  name: string
  type: string
  size: number
  color: string
  selected: boolean
}
function EntityNode({ data }: NodeProps<EntityNodeData>) {
  const Icon = TYPE_ICONS[data.type] || Circle
  const s = data.size
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: Math.max(s, 64) }}>
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
          border: data.selected ? '4px solid #facc15' : '2px solid rgba(255,255,255,0.9)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}
      >
        <Icon size={Math.max(14, s * 0.46)} color="#fff" strokeWidth={2.2} />
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          fontWeight: 600,
          color: '#1e293b',
          textAlign: 'center',
          lineHeight: 1.15,
          maxWidth: 96,
          maxHeight: 28,
          overflow: 'hidden',
          textShadow: '0 1px 2px rgba(255,255,255,0.9)',
        }}
      >
        {data.name}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  )
}
const nodeTypes = { entity: EntityNode }

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

type InputMode = 'text' | 'url' | 'file'
interface ResolvedSeed {
  seedName: string
  seedType: string
  summary: string
  source: string
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
  const [seedType, setSeedType] = useState('artist')
  const [maxDepth, setMaxDepth] = useState(2)
  const [maxPerLevel, setMaxPerLevel] = useState(6)

  // 多模态起点输入
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [textValue, setTextValue] = useState('巴勃罗·毕加索')
  const [urlValue, setUrlValue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [resolvedSeed, setResolvedSeed] = useState<ResolvedSeed | null>(null)
  const lastSigRef = useRef<string>('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<RunInfo | null>(null)
  const [apiNodes, setApiNodes] = useState<ApiNode[]>([])
  const [apiEdges, setApiEdges] = useState<ApiEdge[]>([])
  const [selected, setSelected] = useState<ApiNode | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchHistoryRef = useRef<(() => void) | null>(null)

  // 历史运行(从数据库读取)
  const [history, setHistory] = useState<RunListItem[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // 实时进程控制台
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(true)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // 右侧排行面板折叠
  const [rankOpen, setRankOpen] = useState(true)

  // 筛选系统(默认全部显示；记录“被排除”的项，新数据自动可见)
  const [filterOpen, setFilterOpen] = useState(true)
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(new Set())
  const [depthMax, setDepthMax] = useState(99)
  const [minImportance, setMinImportance] = useState(0)
  const [nameQuery, setNameQuery] = useState('')

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

  // 加载某次历史运行 → 从库里读出节点/边渲染成图谱
  const loadRun = useCallback(async (id: string) => {
    stopPolling()
    setShowHistory(false)
    setSelected(null)
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
    if (!confirm('删除这次运行及其图谱数据？')) return
    await fetch(`/api/deep-search/${id}`, { method: 'DELETE' })
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
      const t = textValue.trim()
      if (!t) throw new Error('请输入起点名字或描述')
      return { payload: { kind: 'text', text: t }, sig: `text:${t}` }
    }
    if (inputMode === 'url') {
      const u = urlValue.trim()
      if (!/^https?:\/\//i.test(u)) throw new Error('请输入有效的 http(s) 链接')
      return { payload: { kind: 'url', url: u }, sig: `url:${u}` }
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
    let seed: ResolvedSeed
    try {
      seed = await resolveSeedNow()
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : '解析失败')
      return
    }
    stopPolling()
    setApiNodes([])
    setApiEdges([])
    setSelected(null)
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

  const pickFile = (f: File | null) => {
    setFile(f)
    setResolvedSeed(null)
    lastSigRef.current = ''
    setResolveError(null)
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
    fetchHistory()
    return () => stopPolling()
  }, [fetchHistory])

  useEffect(() => {
    if (consoleOpen) logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [logs, consoleOpen])

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

  const filteredNodes = useMemo(() => {
    const q = nameQuery.trim().toLowerCase()
    return apiNodes.filter(
      (n) =>
        !hiddenTypes.has(n.type) &&
        n.depth <= depthMax &&
        n.importance >= minImportance &&
        (q === '' || n.name.toLowerCase().includes(q))
    )
  }, [apiNodes, hiddenTypes, depthMax, minImportance, nameQuery])

  const visibleKeys = useMemo(() => new Set(filteredNodes.map((n) => n.key)), [filteredNodes])

  const filteredEdges = useMemo(
    () =>
      apiEdges.filter(
        (e) => visibleKeys.has(e.sourceKey) && visibleKeys.has(e.targetKey) && !hiddenRelations.has(e.type)
      ),
    [apiEdges, visibleKeys, hiddenRelations]
  )

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
    setNameQuery('')
  }
  const filterActive =
    hiddenTypes.size > 0 ||
    hiddenRelations.size > 0 ||
    minImportance > 0 ||
    nameQuery.trim() !== '' ||
    depthMax < maxDepthPresent

  const flowNodes: Node[] = useMemo(() => {
    const pos = layout(filteredNodes)
    return filteredNodes.map((n) => {
      const size = 34 + n.importance * 66
      const color = TYPE_COLORS[n.type] || '#64748b'
      return {
        id: n.key,
        type: 'entity',
        position: pos.get(n.key) || { x: 0, y: 0 },
        data: { name: n.name, type: n.type, size, color, selected: selected?.key === n.key },
      }
    })
  }, [filteredNodes, selected])

  const flowEdges: Edge[] = useMemo(
    () =>
      filteredEdges.map((e, i) => ({
        id: `e${i}`,
        source: e.sourceKey,
        target: e.targetKey,
        label: RELATION_LABELS[e.type] || e.type,
        animated: false,
        style: { strokeWidth: 1 + e.weight * 5, stroke: '#94a3b8' },
        labelStyle: { fontSize: 9, fill: '#64748b' },
        labelBgStyle: { fill: '#f8fafc' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      })),
    [filteredEdges]
  )

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      setSelected(apiNodes.find((n) => n.key === node.id) || null)
    },
    [apiNodes]
  )

  const ranked = useMemo(() => [...filteredNodes].sort((a, b) => b.importance - a.importance), [filteredNodes])

  return (
    <div className="h-screen overflow-hidden bg-slate-100 flex flex-col">
      {/* 顶栏 */}
      <header className="bg-white border-b-2 border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => (window.location.href = '/')} className="text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Search className="w-5 h-5 text-slate-900" />
          <h1 className="text-lg font-bold text-slate-900">深度搜索 · 知识图谱</h1>
        </div>
        <div className="flex items-center gap-4">
          {run && (
            <div className="text-sm text-slate-600">
              {run.nodeCount} 节点 · {run.edgeCount} 关系
            </div>
          )}
          {/* 历史运行(数据库) */}
          <div className="relative">
            <button
              onClick={() => { setShowHistory((v) => !v); fetchHistory() }}
              className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 border-2 border-slate-200 rounded-xl px-3 py-1.5"
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
      </header>

      {/* 控制栏 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 space-y-3">
        {/* 起点输入：文本 / 链接 / 文件 */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[320px]">
            <div className="flex items-center gap-1 mb-2">
              {([
                { id: 'text', label: '文本', icon: Type },
                { id: 'url', label: '链接', icon: Link2 },
                { id: 'file', label: '文件', icon: Upload },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setInputMode(id); setResolveError(null); setResolvedSeed(null); lastSigRef.current = '' }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    inputMode === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
              <span className="text-[11px] text-slate-400 ml-1">起点实体（自动识别名字与类型）</span>
            </div>

            {inputMode === 'text' && (
              <input
                value={textValue}
                onChange={(e) => { setTextValue(e.target.value); setResolvedSeed(null); lastSigRef.current = '' }}
                className="w-full border-2 border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                placeholder="名字或一句描述，如：巴勃罗·毕加索 / 第59届威尼斯双年展"
              />
            )}

            {inputMode === 'url' && (
              <input
                value={urlValue}
                onChange={(e) => { setUrlValue(e.target.value); setResolvedSeed(null); lastSigRef.current = '' }}
                className="w-full border-2 border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                placeholder="粘贴链接，如艺术家维基页 / 展览官网 / 论文页面 (https://…)"
              />
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
                    <span className="text-slate-400">拖拽或点击上传：图片(海报/作品/截图) · PDF · txt/md</span>
                  </>
                )}
              </div>
            )}

            {/* 解析结果 / 错误 */}
            {resolvedSeed && !resolveError && (
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Sparkles className="w-3 h-3" /> 识别为
                </span>
                <b className="text-slate-900">{resolvedSeed.seedName}</b>
                <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[resolvedSeed.seedType] || '#64748b' }} />
                <span className="text-slate-500">{TYPE_LABELS[resolvedSeed.seedType] || resolvedSeed.seedType}</span>
                {resolvedSeed.summary && <span className="text-slate-400 truncate max-w-[420px]">· {resolvedSeed.summary}</span>}
              </div>
            )}
            {resolveError && (
              <p className="mt-2 text-xs text-red-600">{resolveError}</p>
            )}
          </div>
        </div>

        {/* 参数 + 操作 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">类型{resolvedSeed ? '（可改）' : ''}</label>
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
          <div>
            <label className="block text-xs text-slate-500 mb-1">深度 {maxDepth}</label>
            <input type="range" min={1} max={3} value={maxDepth} onChange={(e) => setMaxDepth(+e.target.value)} className="w-24" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">每层扩展 {maxPerLevel}</label>
            <input type="range" min={2} max={12} value={maxPerLevel} onChange={(e) => setMaxPerLevel(+e.target.value)} className="w-24" />
          </div>
          {!running ? (
            <button
              onClick={start}
              disabled={resolving}
              className="bg-slate-900 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2"
            >
              {resolving ? <><Loader2 className="w-4 h-4 animate-spin" /> 解析起点…</> : <><Play className="w-4 h-4" /> 开始搜索</>}
            </button>
          ) : (
            <button
              onClick={stop}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl px-5 py-2 text-sm font-medium flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> 停止
            </button>
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

              {/* 名字搜索 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">按名字</label>
                <input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder="输入关键字过滤…"
                  className="w-full border-2 border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
                />
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
                  显示深度 ≤ {Math.min(depthMax, Math.max(maxDepthPresent, 1))}
                  {depthMax >= maxDepthPresent && <span className="text-slate-400"> (全部)</span>}
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(maxDepthPresent, 1)}
                  value={Math.min(depthMax, Math.max(maxDepthPresent, 1))}
                  onChange={(e) => setDepthMax(+e.target.value)}
                  className="w-full"
                />
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

        <div className="flex-1 relative">
          <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView minZoom={0.1}>
            <Background color="#cbd5e1" gap={20} />
            <Controls />
            <MiniMap nodeColor={(n) => ((n.data as EntityNodeData)?.color) || '#64748b'} pannable zoomable />
          </ReactFlow>
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
          <aside className="w-80 bg-white border-l-2 border-slate-200 shrink-0 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
              <span className="text-sm font-bold text-slate-900">重要度排行 ({ranked.length})</span>
              <button onClick={() => setRankOpen(false)} className="text-slate-400 hover:text-slate-900" title="收起">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {selected && (
                <div className="p-4 border-b-2 border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: TYPE_COLORS[selected.type] }}>
                      {(() => { const I = TYPE_ICONS[selected.type] || Circle; return <I className="w-3.5 h-3.5 text-white" strokeWidth={2.4} /> })()}
                    </span>
                    <span className="text-xs text-slate-500">{TYPE_LABELS[selected.type]}</span>
                  </div>
                  <h3 className="font-bold text-slate-900">{selected.name}</h3>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-600">
                    <div>重要度: <b className="text-slate-900">{selected.importance.toFixed(3)}</b></div>
                    <div>连接数: <b className="text-slate-900">{selected.degree}</b></div>
                    <div>PageRank: <b className="text-slate-900">{selected.pagerank.toFixed(4)}</b></div>
                    <div>发现次数: <b className="text-slate-900">{selected.discoveryCount}</b></div>
                    <div>深度: <b className="text-slate-900">{selected.depth}</b></div>
                    {selected.data?.year && <div>年份: <b className="text-slate-900">{selected.data.year}</b></div>}
                  </div>
                  {selected.data?.evidence && (
                    <p className="text-xs text-slate-500 mt-3 leading-relaxed">{selected.data.evidence}</p>
                  )}
                </div>
              )}
              <div className="p-3">
                <div className="space-y-1">
                  {ranked.map((n, i) => {
                    const I = TYPE_ICONS[n.type] || Circle
                    return (
                      <button
                        key={n.key}
                        onClick={() => setSelected(n)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-slate-100 ${
                          selected?.key === n.key ? 'bg-slate-100' : ''
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
                  {ranked.length === 0 && <p className="text-xs text-slate-400 px-2 py-3">暂无数据</p>}
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
