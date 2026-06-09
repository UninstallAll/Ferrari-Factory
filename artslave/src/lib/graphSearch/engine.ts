// DeepSearch 引擎：滚雪球式 BFS 图谱扩展
// - LLM-first：每个节点调一次 expandEntity 拿邻居
// - 确定性 key 去重 + 多路径发现计数(discoveryCount)
// - 增量持久化到 SQLite(Prisma)，前端可轮询看到图实时生长
// - 跑完计算 PageRank/度/综合重要度

import { prisma } from '@/lib/prisma'
import { expandEntity } from './llmExpander'
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
    maxNeighborsPerNode: 8,
    globalNodeCap: 150,
  }

  await log(`开始搜索：「${run.seedName}」（${run.seedType}）`, 'step')
  await log(`参数：最大深度 ${config.maxDepth} · 每层扩展 ${config.maxPerLevel} · 单点最多 ${config.maxNeighborsPerNode} 邻居`, 'info')

  const nodes = new Map<string, GraphNodeData>()
  const edges = new Map<string, GraphEdgeData>()

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

  await prisma.graphRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date(), message: '初始化…', progress: 2 },
  })
  await persistNodes(runId, [nodes.get(seedKey)!])

  // 预估总扩展次数用于进度
  let expandTarget = 1
  for (let d = 1; d < config.maxDepth; d++) expandTarget += config.maxPerLevel
  let expandsDone = 0

  try {
    for (let depth = 0; depth < config.maxDepth; depth++) {
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
        const progress = Math.min(90, Math.round((expandsDone / expandTarget) * 90))
        await prisma.graphRun.update({
          where: { id: runId },
          data: {
            progress,
            message: `第 ${depth + 1} 层 · 正在扩展「${node.name}」… (已发现 ${nodes.size} 节点 / ${edges.size} 关系)`,
          },
        })

        const t0 = Date.now()
        await log(`调用 Codex 扩展「${node.name}」(${node.type})…`, 'llm')
        let expansion
        try {
          expansion = await expandEntity(node.name, node.type, config.maxNeighborsPerNode)
        } catch (err) {
          console.error(`扩展失败 ${node.name}:`, err)
          await log(`⚠ 扩展「${node.name}」失败：${err instanceof Error ? err.message : String(err)}`, 'error')
          expansion = { canonical: node.name, neighbors: [] }
        }
        expandsDone++
        await log(`Codex 返回 ${expansion.neighbors.length} 个相关实体 (耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`, 'info')

        const touchedNodes: GraphNodeData[] = []
        const touchedEdges: GraphEdgeData[] = []
        const newNames: string[] = []
        let dupCount = 0

        for (const nb of expansion.neighbors) {
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

          // 合并边(无向去重)
          const eid = undirectedEdgeId(node.key, nbKey, nb.relationship)
          const existEdge = edges.get(eid)
          if (existEdge) {
            existEdge.weight = Math.min(1, Math.max(existEdge.weight, nb.strength) + 0.05)
            if (nb.evidence) existEdge.evidence.push(nb.evidence)
            touchedEdges.push(existEdge)
          } else {
            const edge: GraphEdgeData = {
              sourceKey: node.key,
              targetKey: nbKey,
              type: nb.relationship as RelationType,
              weight: nb.strength,
              confidence: 0.8,
              evidence: nb.evidence ? [nb.evidence] : [],
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
      data: JSON.stringify({ year: n.year ?? null, evidence: n.evidence ?? null }),
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
