// 重要度算法：加权 PageRank + 度 + 被发现次数 + 距种子衰减 → 综合重要度
// 目的：从带权网络中分析"重要程度"，并为可视化提供节点大小

import { GraphNodeData, GraphEdgeData } from './types'

/**
 * 加权 PageRank（无向图按双向处理）
 * 重要的节点 = 被很多(且本身重要的)节点连接
 */
export function computePageRank(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  damping = 0.85,
  iterations = 40
): Map<string, number> {
  const keys = nodes.map((n) => n.key)
  const N = keys.length
  const pr = new Map<string, number>()
  if (N === 0) return pr

  for (const k of keys) pr.set(k, 1 / N)

  // 构建加权邻接(双向)与出权重和
  const outWeight = new Map<string, number>()
  const inbound = new Map<string, Array<{ from: string; w: number }>>()
  for (const k of keys) inbound.set(k, [])

  const addDirected = (from: string, to: string, w: number) => {
    if (!pr.has(from) || !pr.has(to)) return
    outWeight.set(from, (outWeight.get(from) || 0) + w)
    inbound.get(to)!.push({ from, w })
  }
  for (const e of edges) {
    const w = e.weight > 0 ? e.weight : 0.01
    addDirected(e.sourceKey, e.targetKey, w)
    addDirected(e.targetKey, e.sourceKey, w) // 无向：双向
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>()
    let dangling = 0
    for (const k of keys) {
      if ((outWeight.get(k) || 0) === 0) dangling += pr.get(k)!
    }
    for (const k of keys) {
      let sum = 0
      for (const { from, w } of inbound.get(k)!) {
        const ow = outWeight.get(from) || 0
        if (ow > 0) sum += (pr.get(from)! * w) / ow
      }
      const rank = (1 - damping) / N + damping * (sum + dangling / N)
      next.set(k, rank)
    }
    for (const k of keys) pr.set(k, next.get(k)!)
  }
  return pr
}

function normalizeMap(m: Map<string, number>): Map<string, number> {
  let max = 0
  for (const v of m.values()) if (v > max) max = v
  const out = new Map<string, number>()
  for (const [k, v] of m) out.set(k, max > 0 ? v / max : 0)
  return out
}

/**
 * 计算每个节点的综合重要度(0-1)，并把 degree/pagerank/importance 写回节点对象
 * 综合 = 0.45*PageRank + 0.25*度 + 0.2*被发现次数 + 0.1*距种子衰减
 */
export function computeImportance(nodes: GraphNodeData[], edges: GraphEdgeData[]): void {
  // 度(加权)
  const degree = new Map<string, number>()
  for (const n of nodes) degree.set(n.key, 0)
  for (const e of edges) {
    degree.set(e.sourceKey, (degree.get(e.sourceKey) || 0) + e.weight)
    degree.set(e.targetKey, (degree.get(e.targetKey) || 0) + e.weight)
  }

  const pr = computePageRank(nodes, edges)
  const prN = normalizeMap(pr)
  const degN = normalizeMap(degree)

  // 被发现次数归一
  const disc = new Map<string, number>()
  for (const n of nodes) disc.set(n.key, n.discoveryCount)
  const discN = normalizeMap(disc)

  for (const n of nodes) {
    const depthDecay = 1 / (1 + n.depth) // 越靠近种子越高
    const composite =
      0.45 * (prN.get(n.key) || 0) +
      0.25 * (degN.get(n.key) || 0) +
      0.2 * (discN.get(n.key) || 0) +
      0.1 * depthDecay
    // 整数度(连接数，非加权)更直观，单独存
    n.degree = countRawDegree(n.key, edges)
    n.pagerank = pr.get(n.key) || 0
    n.importance = Math.max(0, Math.min(1, composite))
  }
  // 种子节点(depth 0)固定为最高重要度
  const seed = nodes.find((n) => n.depth === 0)
  if (seed) seed.importance = 1
}

function countRawDegree(key: string, edges: GraphEdgeData[]): number {
  let c = 0
  for (const e of edges) if (e.sourceKey === key || e.targetKey === key) c++
  return c
}
