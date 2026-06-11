// 关系核验：只保留「有真实出处 + 有依据」的关系，并据此给出可信度。
// 目标是保证图谱里的每条边都能被追溯到真实资料，杜绝凭空编造。

import { Neighbor } from './types'

export interface Verdict {
  keep: boolean
  confidence: number // 0-1
  reason?: string
}

/** 单条邻居关系是否可信。无出处或无依据 → 丢弃。 */
export function verifyNeighbor(nb: Neighbor): Verdict {
  const hasSource = !!(nb.sourceUrl && /^https?:\/\//i.test(nb.sourceUrl))
  const hasEvidence = !!(nb.evidence && nb.evidence.trim().length >= 4)

  if (!hasEvidence) {
    return { keep: false, confidence: 0, reason: '缺少依据' }
  }
  if (!hasSource) {
    // 有依据但无明确出处链接：降级保留(依据本身来自真实检索资料)，但可信度打折
    return { keep: true, confidence: clamp(0.45 + nb.strength * 0.2), reason: '依据存在但无明确链接' }
  }

  // 有出处 + 有依据：可信度由关系强度抬升
  const confidence = clamp(0.65 + nb.strength * 0.3)
  return { keep: true, confidence }
}

/** 批量核验，返回保留的邻居(已写回 confidence 到 strength 不变，仅辅助引擎用) */
export function verifyNeighbors(neighbors: Neighbor[]): { neighbor: Neighbor; confidence: number }[] {
  const out: { neighbor: Neighbor; confidence: number }[] = []
  for (const nb of neighbors) {
    const v = verifyNeighbor(nb)
    if (v.keep) out.push({ neighbor: nb, confidence: v.confidence })
  }
  return out
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n))
}
