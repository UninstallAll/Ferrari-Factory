import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeImportance } from '@/lib/graphSearch/importance'
import { GraphNodeData, GraphEdgeData } from '@/lib/graphSearch/types'

// GET: 全局知识图谱 —— 把所有运行按规范键(key)合并去重成一张总图
// 查询参数: limit(默认 200, 只返回最重要的 N 个节点，防止前端卡顿)
export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '200'), 10), 2000)

    const [nodeRows, edgeRows] = await Promise.all([
      prisma.graphNode.findMany({
        select: { key: true, name: true, type: true, depth: true, importance: true, discoveryCount: true, runId: true, data: true },
      }),
      prisma.graphEdge.findMany({
        select: { sourceKey: true, targetKey: true, type: true, weight: true, evidence: true },
      }),
    ])

    // ---- 按 key 合并节点 ----
    type Agg = {
      key: string
      name: string
      type: string
      depthMin: number
      discoverySum: number
      bestImportance: number
      runIds: Set<string>
      year: number | null
      evidence: string | null
    }
    const nodeMap = new Map<string, Agg>()
    for (const r of nodeRows) {
      let parsed: any = null
      try { parsed = r.data ? JSON.parse(r.data) : null } catch { /* ignore */ }
      const a = nodeMap.get(r.key)
      if (!a) {
        nodeMap.set(r.key, {
          key: r.key,
          name: r.name,
          type: r.type,
          depthMin: r.depth,
          discoverySum: r.discoveryCount,
          bestImportance: r.importance,
          runIds: new Set([r.runId]),
          year: parsed?.year ?? null,
          evidence: parsed?.evidence ?? null,
        })
      } else {
        a.discoverySum += r.discoveryCount
        a.depthMin = Math.min(a.depthMin, r.depth)
        a.runIds.add(r.runId)
        // 用重要度最高的那条记录的名字/证据作为代表
        if (r.importance > a.bestImportance) {
          a.bestImportance = r.importance
          a.name = r.name
          if (parsed?.evidence) a.evidence = parsed.evidence
        }
        if (a.year == null && parsed?.year != null) a.year = parsed.year
      }
    }

    // ---- 按 (source,target,type) 合并边 ----
    const edgeMap = new Map<string, { sourceKey: string; targetKey: string; type: string; weightMax: number; count: number; evidence: string[] }>()
    for (const e of edgeRows) {
      const id = `${e.sourceKey}__${e.targetKey}__${e.type}`
      let ev: string[] = []
      try { ev = e.evidence ? JSON.parse(e.evidence) : [] } catch { /* ignore */ }
      const cur = edgeMap.get(id)
      if (!cur) {
        edgeMap.set(id, { sourceKey: e.sourceKey, targetKey: e.targetKey, type: e.type, weightMax: e.weight, count: 1, evidence: ev.slice(0, 3) })
      } else {
        cur.weightMax = Math.max(cur.weightMax, e.weight)
        cur.count += 1
        for (const x of ev) if (cur.evidence.length < 5 && !cur.evidence.includes(x)) cur.evidence.push(x)
      }
    }

    // ---- 重算全局重要度(PageRank/度/综合) ----
    const nodeArr: GraphNodeData[] = Array.from(nodeMap.values()).map((a) => ({
      key: a.key,
      name: a.name,
      type: a.type as any,
      depth: a.depthMin,
      relevanceScore: 0,
      discoveryCount: a.discoverySum,
      degree: 0,
      pagerank: 0,
      importance: 0,
    }))
    const edgeArr: GraphEdgeData[] = Array.from(edgeMap.values()).map((e) => ({
      sourceKey: e.sourceKey,
      targetKey: e.targetKey,
      type: e.type as any,
      // 出现在越多运行里的关系，权重略增
      weight: Math.min(1, e.weightMax + 0.03 * (e.count - 1)),
      confidence: 0.8,
      evidence: e.evidence,
    }))
    computeImportance(nodeArr, edgeArr)

    // ---- 取 Top-N，边只保留两端都在内的 ----
    const sorted = [...nodeArr].sort((a, b) => b.importance - a.importance).slice(0, limit)
    const includedKeys = new Set(sorted.map((n) => n.key))

    const aggByKey = nodeMap
    const nodes = sorted.map((n) => {
      const a = aggByKey.get(n.key)!
      return {
        key: n.key,
        name: n.name,
        type: n.type,
        depth: n.depth,
        relevanceScore: 0,
        importance: n.importance,
        pagerank: n.pagerank,
        degree: n.degree,
        discoveryCount: n.discoveryCount,
        data: { year: a.year, evidence: a.evidence, runCount: a.runIds.size },
      }
    })

    const edges = edgeArr
      .filter((e) => includedKeys.has(e.sourceKey) && includedKeys.has(e.targetKey))
      .map((e) => ({ sourceKey: e.sourceKey, targetKey: e.targetKey, type: e.type, weight: e.weight, evidence: e.evidence }))

    return NextResponse.json({
      success: true,
      stats: {
        totalEntities: nodeMap.size,
        totalRelations: edgeMap.size,
        shownEntities: nodes.length,
        shownRelations: edges.length,
        limited: nodeMap.size > limit,
        limit,
      },
      nodes,
      edges,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
