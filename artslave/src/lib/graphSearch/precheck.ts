import { NodeType, NODE_TYPES } from './types'
import { searchWikidataCandidates, type WikidataCandidate } from './identity'

export interface QueryPrecheck {
  normalizedName: string
  type: NodeType
  confidence: number
  candidates: WikidataCandidate[]
  searchTerms: string[]
  disambiguation: string[]
}

function normalizeType(type: unknown): NodeType {
  const t = String(type || '').toLowerCase().trim()
  return (NODE_TYPES as string[]).includes(t) ? (t as NodeType) : 'artist'
}

function normalizeInputName(query: string): string {
  return query
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’《》【】()（）]+|[\s"'“”‘’《》【】()（）]+$/g, '')
    .trim()
}

export async function precheckQuery(query: string, typeHint?: unknown): Promise<QueryPrecheck> {
  const normalized = normalizeInputName(query)
  if (!normalized) {
    return { normalizedName: '', type: normalizeType(typeHint), confidence: 0, candidates: [], searchTerms: [], disambiguation: [] }
  }

  const type = normalizeType(typeHint)
  const candidates = await searchWikidataCandidates(normalized, type, 5)
  const best = candidates[0]
  const searchTerms = best?.searchTerms?.length
    ? best.searchTerms
    : [normalized, `${normalized} ${type}`]
  const disambiguation = candidates.map((c) =>
    [
      c.label,
      c.wikidataId,
      c.birthYear != null ? `${c.birthYear}${c.deathYear != null ? `-${c.deathYear}` : ''}` : '',
      c.country || '',
      c.description || '',
    ].filter(Boolean).join(' · ')
  )

  return {
    normalizedName: best?.label || normalized,
    type,
    confidence: best?.matchScore || 0,
    candidates,
    searchTerms,
    disambiguation,
  }
}

