// DeepSearch 引擎：滚雪球式 BFS 图谱扩展
// - LLM-first：每个节点调一次 expandEntity 拿邻居
// - 确定性 key 去重 + 多路径发现计数(discoveryCount)
// - 增量持久化到 SQLite(Prisma)，前端可轮询看到图实时生长
// - 跑完计算 PageRank/度/综合重要度

import { prisma } from '@/lib/prisma'
import { expandEntity } from './llmExpander'
import { extractPageGraph } from './pageExtractor'
import { crawlListing } from './crawler'
import { verifyNeighbor } from './verifier'
import { computeImportance } from './importance'
import {
  GraphNodeData,
  GraphEdgeData,
  SearchConfig,
  RelationType,
  canonicalKey,
} from './types'

function undirectedEdgeId(a: string, b: string, type: string): string {
  return [a, b].sort().join('--') + '::' + type
}

export async function runDeepSearch(runId: string): Promise<void> {
  const run = await prisma.graphRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error(`GraphRun ${runId} 不存在`)

  // 实时进程日志(写库, 前端轮询展示)
  let logSeq = 0
  const log = async (message: string, level = 'info', meta?: any) => {
    try {
      await prisma.graphLog.create({
        data: { runId, seq: logSeq++, level, message, meta: meta ? JSON.stringify(meta) : null },
      })
    } catch (e) {
      console.error('写日志失败:', e)
    }
  }

  const config: SearchConfig = {
    maxDepth: run.maxDepth,
    maxPerLevel: run.maxPerLevel,
    maxNeighborsPerNode: 10,
    globalNodeCap: 250,
  }

  const crawlMode = !!run.seedUrl || !!run.seedUrls
  const provider = (process.env.RETRIEVAL_PROVIDER || 'wikipedia').toLowerCase()

  const nodes = new Map<string, GraphNodeData>()
  const edges = new Map<string, GraphEdgeData>()

  await prisma.graphRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date(), message: '初始化…', progress: 2 },
  })

  // 深挖(BFS)的起始层：爬取模式下种子节点为爬到的第 1 层，故从第 1 层开始向外深挖
  let startDepth = 0

  try {
    if (crawlMode) {
      const crawlUrls = parseCrawlUrls(run)
      await log(`开始爬取式搜索：${crawlUrls.length > 1 ? `${crawlUrls.length} 个链接` : crawlUrls[0]}`, 'step')
      await log(`流程：① 抓取网页(自动翻页) → ② 从真实正文批量抽取实体/关系 → ③ 对重点实体用真实资料(来源=${provider})继续深挖`, 'info')
      await seedFromCrawl(runId, crawlUrls, run.crawlPages, nodes, edges, config, log)
      if (nodes.size === 0) {
        throw new Error('未能从该网址抓取/抽取到任何实体，请检查链接是否可访问、是否为列表/内容页')
      }
      startDepth = 1
    } else {
      await log(`开始搜索：「${run.seedName}」（${run.seedType}）`, 'step')
      await log(`参数：最大深度 ${config.maxDepth} · 每层扩展 ${config.maxPerLevel} · 单点最多 ${config.maxNeighborsPerNode} 邻居 · 节点上限 ${config.globalNodeCap}`, 'info')
      await log(`取证模式：先检索真实资料(来源=${provider})，再从真实正文抽取关系，每条关系都带可核验出处`, 'info')
      const seedKey = canonicalKey(run.seedType, run.seedName)
      nodes.set(seedKey, {
        key: seedKey,
        name: run.seedName,
        type: run.seedType as any,
        depth: 0,
        relevanceScore: 1,
        discoveryCount: 1,
        degree: 0,
        pagerank: 0,
        importance: 1,
      })
      await persistNodes(runId, [nodes.get(seedKey)!])
    }

    // 进度区间：爬取模式爬取阶段占用前 60%，深挖占 60→90；单种子模式深挖占 2→90
    const progressBase = crawlMode ? 60 : 2
    const progressSpan = 90 - progressBase

    // 预估深挖扩展次数(用于进度)
    let expandTarget = 0
    for (let d = startDepth; d < config.maxDepth; d++) expandTarget += d === 0 ? 1 : config.maxPerLevel
    expandTarget = Math.max(1, expandTarget)
    let expandsDone = 0

    for (let depth = startDepth; depth < config.maxDepth; depth++) {
      // 选当前层相关性最高的若干节点扩展
      const levelNodes = Array.from(nodes.values())
        .filter((n) => n.depth === depth)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, depth === 0 ? 1 : config.maxPerLevel)

      await log(`▶ 进入第 ${depth + 1} 层，准备扩展 ${levelNodes.length} 个节点`, 'step')

      for (const node of levelNodes) {
        if (await isStopped(runId)) {
          await log('⏹ 已手动停止', 'warn')
          return
        }
        const progress = Math.min(90, progressBase + Math.round((expandsDone / expandTarget) * progressSpan))
        await prisma.graphRun.update({
          where: { id: runId },
          data: {
            progress,
            message: `深挖第 ${depth + 1} 层 · 正在扩展「${node.name}」… (已发现 ${nodes.size} 节点 / ${edges.size} 关系)`,
          },
        })

        const t0 = Date.now()
        await log(`检索真实资料并扩展「${node.name}」(${node.type})…`, 'llm')
        let expansion
        try {
          expansion = await expandEntity(node.name, node.type, config.maxNeighborsPerNode)
        } catch (err) {
          console.error(`扩展失败 ${node.name}:`, err)
          await log(`⚠ 扩展「${node.name}」失败：${err instanceof Error ? err.message : String(err)}`, 'error')
          expandsDone++
          continue
        }
        expandsDone++

        if (!expansion.docCount) {
          await log(`✗ 未找到「${node.name}」的真实资料，已跳过该节点(不编造)`, 'warn')
          continue
        }
        const srcPreview = (expansion.sources || []).map((s) => s.title).slice(0, 3).join('、')
        await log(`命中 ${expansion.docCount} 篇真实资料：${srcPreview}`, 'success')
        await log(`从真实正文抽取 ${expansion.neighbors.length} 个相关实体 (耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`, 'info')

        // 核验：只保留有依据/出处的关系
        const verified = expansion.neighbors
          .map((nb) => ({ nb, v: verifyNeighbor(nb) }))
          .filter((x) => x.v.keep)
        const droppedCount = expansion.neighbors.length - verified.length
        if (droppedCount > 0) {
          await log(`核验：丢弃 ${droppedCount} 条缺少依据/出处的关系`, 'warn')
        }

        const touchedNodes: GraphNodeData[] = []
        const touchedEdges: GraphEdgeData[] = []
        const newNames: string[] = []
        let dupCount = 0

        for (const { nb, v } of verified) {
          const nbKey = canonicalKey(nb.type, nb.name)
          if (nbKey === node.key) continue

          const existing = nodes.get(nbKey)
          const incomingRelevance = node.relevanceScore * nb.strength * 0.9
          if (existing) {
            // 多路径发现：增加计数 + 取更高相关性
            existing.discoveryCount += 1
            existing.relevanceScore = Math.max(existing.relevanceScore, incomingRelevance)
            touchedNodes.push(existing)
            dupCount++
          } else if (nodes.size < config.globalNodeCap) {
            const newNode: GraphNodeData = {
              key: nbKey,
              name: nb.name,
              type: nb.type,
              depth: node.depth + 1,
              relevanceScore: incomingRelevance,
              discoveryCount: 1,
              parentKey: node.key,
              year: nb.year,
              evidence: nb.evidence,
              sourceUrl: nb.sourceUrl ?? null,
              degree: 0,
              pagerank: 0,
              importance: 0,
            }
            nodes.set(nbKey, newNode)
            touchedNodes.push(newNode)
            newNames.push(nb.name)
          } else {
            continue // 达到全局上限
          }

          // 关系依据(原文 + 真实出处)
          const evidenceLine = nb.evidence
            ? `${nb.evidence}${nb.sourceUrl ? ' —— ' + nb.sourceUrl : ''}`
            : nb.sourceUrl || ''

          // 合并边(无向去重)
          const eid = undirectedEdgeId(node.key, nbKey, nb.relationship)
          const existEdge = edges.get(eid)
          if (existEdge) {
            existEdge.weight = Math.min(1, Math.max(existEdge.weight, nb.strength) + 0.05)
            // 多来源印证 → 提升可信度
            existEdge.confidence = Math.min(1, Math.max(existEdge.confidence, v.confidence) + 0.05)
            if (evidenceLine) existEdge.evidence.push(evidenceLine)
            touchedEdges.push(existEdge)
          } else {
            const edge: GraphEdgeData = {
              sourceKey: node.key,
              targetKey: nbKey,
              type: nb.relationship as RelationType,
              weight: nb.strength,
              confidence: v.confidence,
              evidence: evidenceLine ? [evidenceLine] : [],
            }
            edges.set(eid, edge)
            touchedEdges.push(edge)
          }
        }

        // 增量持久化(让前端轮询看到生长)
        await persistNodes(runId, touchedNodes)
        await persistEdges(runId, touchedEdges)
        await prisma.graphRun.update({
          where: { id: runId },
          data: { nodeCount: nodes.size, edgeCount: edges.size },
        })

        if (newNames.length) {
          const preview = newNames.slice(0, 6).join('、') + (newNames.length > 6 ? ` 等 ${newNames.length} 个` : '')
          await log(`＋新增 ${newNames.length} 个节点：${preview}${dupCount ? `（另有 ${dupCount} 个已存在，多路径加权）` : ''}`, 'success')
        } else if (dupCount) {
          await log(`本次无新节点，${dupCount} 个为已有实体（多路径加权）`, 'info')
        }
      }
    }

    // 后处理：计算重要度
    await log('计算重要度（PageRank / 度中心性 / 发现次数）…', 'step')
    await prisma.graphRun.update({
      where: { id: runId },
      data: { progress: 95, message: '计算重要度(PageRank/度/中心性)…' },
    })
    const nodeArr = Array.from(nodes.values())
    const edgeArr = Array.from(edges.values())
    computeImportance(nodeArr, edgeArr)
    await persistNodes(runId, nodeArr)

    const top = [...nodeArr].sort((a, b) => b.importance - a.importance).slice(0, 5)
    await log(`重要度 Top5：${top.map((n) => `${n.name}(${n.importance.toFixed(2)})`).join('、')}`, 'info')

    await prisma.graphRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        nodeCount: nodes.size,
        edgeCount: edges.size,
        message: `完成：${nodes.size} 个节点，${edges.size} 条关系`,
      },
    })
    await log(`✓ 搜索完成：${nodes.size} 个节点 / ${edges.size} 条关系`, 'success')
  } catch (err) {
    console.error('DeepSearch 运行失败:', err)
    await log(`✗ 运行失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    await prisma.graphRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        message: '运行失败',
      },
    })
  }
}

/**
 * 解析爬取起始链接(支持 JSON 多链接或单个 seedUrl)
 */
export function parseCrawlUrls(run: { seedUrl?: string | null; seedUrls?: string | null }): string[] {
  if (run.seedUrls) {
    try {
      const arr = JSON.parse(run.seedUrls)
      if (Array.isArray(arr)) {
        const urls = arr.map((u) => String(u).trim()).filter((u) => /^https?:\/\/\S+/i.test(u))
        if (urls.length) return [...new Set(urls)]
      }
    } catch {
      /* fall through */
    }
  }
  const one = String(run.seedUrl || '').trim()
  if (/^https?:\/\/\S+/i.test(one)) return [one]
  return []
}

/**
 * 爬取模式播种：抓取起始网址(自动翻页) → 从每页真实正文抽取实体/关系 → 写入图谱(深度=1)。
 * 支持多个起始链接，结果合并到同一张图谱。
 */
async function seedFromCrawl(
  runId: string,
  seedUrls: string[],
  crawlPages: number | null,
  nodes: Map<string, GraphNodeData>,
  edges: Map<string, GraphEdgeData>,
  config: SearchConfig,
  log: (message: string, level?: string, meta?: any) => Promise<void>
): Promise<void> {
  const maxPages = Math.max(1, crawlPages || Number(process.env.CRAWL_MAX_PAGES) || 4)

  // 预检：抓取前确认 LLM 可达
  const llmBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
  try {
    await fetch(`${llmBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'x'}` },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    const isLocal = llmBaseUrl.includes('localhost') || llmBaseUrl.includes('127.0.0.1')
    const hint = isLocal
      ? `LLM 服务未就绪（${llmBaseUrl}）—— 请在另一个终端先运行: npm run fake-llm:cli`
      : `无法连接 LLM 服务（${llmBaseUrl}）—— 请检查网络和 OPENAI_BASE_URL / OPENAI_API_KEY 配置`
    throw new Error(hint)
  }

  if (seedUrls.length > 1) {
    await log(`① 多链接爬取：共 ${seedUrls.length} 个起始站，每个最多翻 ${maxPages} 页`, 'step')
  }

  for (let si = 0; si < seedUrls.length; si++) {
    const seedUrl = seedUrls[si]
    if (await isStopped(runId)) return

    if (seedUrls.length > 1) {
      await log(`━━ 起始站 ${si + 1}/${seedUrls.length}：${seedUrl}`, 'step')
    } else {
      await log(`① 抓取网页：从 ${seedUrl} 起，自动翻页最多 ${maxPages} 页${process.env.CRAWL_JS === '1' ? '（JS 渲染已开启）' : ''}`, 'step')
    }

    const pages = await crawlListing(seedUrl, {
      maxPages,
      onPage: async (url, idx, total) => {
        const prefix = seedUrls.length > 1 ? `[站${si + 1}] ` : ''
        await log(`${prefix}抓取第 ${idx}/${total} 页：${url}`, 'llm')
      },
    })

    if (!pages.length) {
      await log(`✗ ${seedUrl} 未抓取到可用页面内容`, 'error')
      continue
    }
    await log(`✓ ${seedUrl} 共抓到 ${pages.length} 页，开始抽取实体与关系…`, 'success')

    let pageIdx = 0
    for (const page of pages) {
      pageIdx++
      if (await isStopped(runId)) return

      await prisma.graphRun.update({
        where: { id: runId },
        data: {
          progress: Math.min(58, 5 + Math.round(((si + pageIdx / pages.length) / seedUrls.length) * 53)),
          message: `解析 ${seedUrl} 第 ${pageIdx}/${pages.length} 页…(已发现 ${nodes.size} 节点)`,
        },
      })

      let extraction
      try {
        extraction = await extractPageGraph(page.text, page.url, 22)
      } catch (err) {
        await log(`⚠ ${page.url} 抽取失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        continue
      }

      const touchedNodes: GraphNodeData[] = []
      const touchedEdges: GraphEdgeData[] = []
      const newNames: string[] = []

      const ensureNode = (name: string, type: any, evidence?: string): boolean => {
        const key = canonicalKey(type, name)
        if (nodes.has(key)) {
          const ex = nodes.get(key)!
          ex.discoveryCount += 1
          touchedNodes.push(ex)
          return true
        }
        if (nodes.size >= config.globalNodeCap) return false
        const nd: GraphNodeData = {
          key,
          name,
          type,
          depth: 1,
          relevanceScore: 0.5,
          discoveryCount: 1,
          year: null,
          evidence: evidence || '',
          sourceUrl: page.url,
          degree: 0,
          pagerank: 0,
          importance: 0,
        }
        nodes.set(key, nd)
        touchedNodes.push(nd)
        newNames.push(name)
        return true
      }

      for (const n of extraction.nodes) ensureNode(n.name, n.type, n.evidence)

      for (const e of extraction.edges) {
        const sKey = canonicalKey(e.sourceType, e.source)
        const tKey = canonicalKey(e.targetType, e.target)
        if (sKey === tKey) continue
        if (!ensureNode(e.source, e.sourceType, e.evidence)) continue
        if (!ensureNode(e.target, e.targetType, e.evidence)) continue

        const evLine = e.evidence ? `${e.evidence} —— ${page.url}` : page.url
        const eid = undirectedEdgeId(sKey, tKey, e.relationship)
        const exEdge = edges.get(eid)
        if (exEdge) {
          exEdge.weight = Math.min(1, Math.max(exEdge.weight, e.strength) + 0.05)
          exEdge.confidence = Math.min(1, exEdge.confidence + 0.05)
          exEdge.evidence.push(evLine)
          touchedEdges.push(exEdge)
        } else {
          const edge: GraphEdgeData = {
            sourceKey: sKey,
            targetKey: tKey,
            type: e.relationship as RelationType,
            weight: e.strength,
            confidence: 0.7,
            evidence: [evLine],
          }
          edges.set(eid, edge)
          touchedEdges.push(edge)
        }
      }

      await persistNodes(runId, touchedNodes)
      await persistEdges(runId, touchedEdges)
      await prisma.graphRun.update({
        where: { id: runId },
        data: { nodeCount: nodes.size, edgeCount: edges.size },
      })

      const preview = newNames.slice(0, 6).join('、') + (newNames.length > 6 ? ` 等 ${newNames.length} 个` : '')
      await log(
        `${page.url}：抽取 ${extraction.nodes.length} 实体 / ${extraction.edges.length} 关系${newNames.length ? `，新增：${preview}` : '（无新增）'}`,
        'success'
      )
    }
  }

  if (nodes.size === 0) return

  // 按度为节点赋相关性(度越高=越像枢纽/越重要)，供后续深挖择优
  const deg = new Map<string, number>()
  for (const e of edges.values()) {
    deg.set(e.sourceKey, (deg.get(e.sourceKey) || 0) + 1)
    deg.set(e.targetKey, (deg.get(e.targetKey) || 0) + 1)
  }
  for (const n of nodes.values()) {
    const d = deg.get(n.key) || 0
    n.relevanceScore = Math.max(n.relevanceScore, Math.min(1, 0.4 + 0.08 * d))
  }
  await persistNodes(runId, Array.from(nodes.values()))
  await log(`② 抽取完成：共 ${nodes.size} 个实体 / ${edges.size} 条关系（均来自真实页面正文，带出处）`, 'success')
  if (config.maxDepth > 1) {
    await log('③ 开始对度最高的重点实体，用真实资料继续向外深挖…', 'step')
  }
}

async function isStopped(runId: string): Promise<boolean> {
  const r = await prisma.graphRun.findUnique({ where: { id: runId }, select: { status: true } })
  return r?.status === 'stopped'
}

async function persistNodes(runId: string, list: GraphNodeData[]): Promise<void> {
  for (const n of list) {
    const data = {
      name: n.name,
      type: n.type,
      depth: n.depth,
      relevanceScore: n.relevanceScore,
      importance: n.importance,
      pagerank: n.pagerank,
      degree: n.degree,
      discoveryCount: n.discoveryCount,
      parentKey: n.parentKey ?? null,
      data: JSON.stringify({ year: n.year ?? null, evidence: n.evidence ?? null, sourceUrl: n.sourceUrl ?? null }),
    }
    await prisma.graphNode.upsert({
      where: { runId_key: { runId, key: n.key } },
      create: { runId, key: n.key, ...data },
      update: data,
    })
  }
}

async function persistEdges(runId: string, list: GraphEdgeData[]): Promise<void> {
  for (const e of list) {
    const data = {
      weight: e.weight,
      confidence: e.confidence,
      evidence: JSON.stringify(e.evidence.slice(0, 5)),
    }
    await prisma.graphEdge.upsert({
      where: {
        runId_sourceKey_targetKey_type: {
          runId,
          sourceKey: e.sourceKey,
          targetKey: e.targetKey,
          type: e.type,
        },
      },
      create: { runId, sourceKey: e.sourceKey, targetKey: e.targetKey, type: e.type, ...data },
      update: data,
    })
  }
}
