import { EntityIdentity, NodeType, slugName } from './types'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const UA = 'ArtSlaveBot/1.0 (identity disambiguation)'

const TYPE_HINTS: Record<NodeType, string[]> = {
  artist: ['artist', 'painter', 'sculptor', 'visual artist', 'photographer'],
  exhibition: ['exhibition', 'art exhibition', 'biennial'],
  institution: ['museum', 'art museum', 'institution', 'gallery', 'university'],
  curator: ['curator', 'art curator'],
  movement: ['art movement', 'movement'],
  location: ['city', 'country', 'place', 'location'],
  scholar: ['scholar', 'art historian', 'researcher', 'professor'],
  paper: ['paper', 'journal article', 'publication'],
  venue: ['journal', 'conference', 'venue'],
}

export interface WikidataCandidate extends EntityIdentity {
  id: string
  label: string
  matchScore: number
  searchTerms: string[]
}

export interface EntryComparison {
  sameIdentity: boolean
  confidence: number
  reasons: string[]
}

const cache = new Map<string, Promise<WikidataCandidate[]>>()

function yearFromWikidataTime(v: any): number | null {
  const raw = v?.mainsnak?.datavalue?.value?.time
  if (typeof raw !== 'string') return null
  const m = raw.match(/[+-](\d{1,6})-/)
  return m ? Number.parseInt(m[1], 10) : null
}

function claimIds(entity: any, prop: string, limit = 6): string[] {
  const claims = entity?.claims?.[prop] || []
  const ids: string[] = []
  for (const c of claims) {
    const id = c?.mainsnak?.datavalue?.value?.id
    if (typeof id === 'string' && /^Q\d+$/.test(id)) ids.push(id)
    if (ids.length >= limit) break
  }
  return ids
}

async function getJson(url: string, timeoutMs = 12000): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
  return res.json()
}

async function wbSearch(query: string, limit: number): Promise<string[]> {
  const url =
    `${WIKIDATA_API}?action=wbsearchentities&format=json&language=en&uselang=en` +
    `&limit=${limit}&search=${encodeURIComponent(query)}`
  const json = await getJson(url)
  return (json?.search || [])
    .map((r: any) => String(r.id || ''))
    .filter((id: string) => /^Q\d+$/.test(id))
}

async function wbEntities(ids: string[], props = 'labels|descriptions|aliases|claims'): Promise<Record<string, any>> {
  if (!ids.length) return {}
  const url =
    `${WIKIDATA_API}?action=wbgetentities&format=json&languages=en|zh&props=${props}` +
    `&ids=${encodeURIComponent(ids.slice(0, 50).join('|'))}`
  const json = await getJson(url)
  return json?.entities || {}
}

function labelOf(entity: any): string {
  return entity?.labels?.en?.value || entity?.labels?.zh?.value || ''
}

function descriptionOf(entity: any): string {
  return entity?.descriptions?.en?.value || entity?.descriptions?.zh?.value || ''
}

function aliasesOf(entity: any): string[] {
  const values = [...(entity?.aliases?.en || []), ...(entity?.aliases?.zh || [])]
    .map((a: any) => String(a.value || '').trim())
    .filter(Boolean)
  return [...new Set(values)].slice(0, 8)
}

async function labelsFor(ids: string[]): Promise<Record<string, string>> {
  const entities = await wbEntities([...new Set(ids)], 'labels')
  const out: Record<string, string> = {}
  for (const [id, entity] of Object.entries<any>(entities)) out[id] = labelOf(entity)
  return out
}

function scoreCandidate(query: string, type: NodeType, entity: EntityIdentity): number {
  const q = slugName(query)
  const label = slugName(entity.label || '')
  const aliases = (entity.aliases || []).map(slugName)
  let score = 0
  if (label === q) score += 0.55
  else if (label.includes(q) || q.includes(label)) score += 0.3
  if (aliases.some((a) => a === q)) score += 0.2
  const haystack = [
    entity.description || '',
    ...(entity.occupations || []),
  ].join(' ').toLowerCase()
  for (const hint of TYPE_HINTS[type] || []) {
    if (haystack.includes(hint)) score += 0.08
  }
  if (entity.wikidataId) score += 0.08
  return Math.min(1, score)
}

function buildSearchTerms(query: string, candidate: EntityIdentity, type: NodeType): string[] {
  const terms = new Set<string>()
  if (candidate.label) terms.add(candidate.label)
  terms.add(query)
  if (candidate.wikidataId) terms.add(`${candidate.label || query} ${candidate.wikidataId}`)
  if (candidate.birthYear != null) terms.add(`${candidate.label || query} ${candidate.birthYear}`)
  if (candidate.country) terms.add(`${candidate.label || query} ${candidate.country}`)
  for (const hint of (TYPE_HINTS[type] || []).slice(0, 2)) terms.add(`${candidate.label || query} ${hint}`)
  return [...terms].filter(Boolean).slice(0, 6)
}

export async function searchWikidataCandidates(
  query: string,
  type: NodeType,
  limit = 5
): Promise<WikidataCandidate[]> {
  const clean = query.trim()
  if (!clean) return []
  const cacheKey = `${type}:${clean.toLowerCase()}:${limit}`
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const ids = await wbSearch(clean, Math.max(limit, 8))
      const entities = await wbEntities(ids)
      const linkedIds = new Set<string>()
      for (const entity of Object.values<any>(entities)) {
        for (const id of [...claimIds(entity, 'P27', 3), ...claimIds(entity, 'P106', 5), ...claimIds(entity, 'P31', 4)]) {
          linkedIds.add(id)
        }
      }
      const linkedLabels = await labelsFor([...linkedIds])
      const out: WikidataCandidate[] = []
      for (const id of ids) {
        const entity = entities[id]
        if (!entity || entity.missing !== undefined) continue
        const occupations = claimIds(entity, 'P106', 5).map((x) => linkedLabels[x]).filter(Boolean)
        const countries = claimIds(entity, 'P27', 2).map((x) => linkedLabels[x]).filter(Boolean)
        const candidate: EntityIdentity = {
          wikidataId: id,
          label: labelOf(entity),
          description: descriptionOf(entity),
          aliases: aliasesOf(entity),
          birthYear: yearFromWikidataTime((entity.claims?.P569 || [])[0]) ?? null,
          deathYear: yearFromWikidataTime((entity.claims?.P570 || [])[0]) ?? null,
          country: countries[0] || null,
          occupations,
          url: `https://www.wikidata.org/wiki/${id}`,
        }
        if (!candidate.label) continue
        const matchScore = scoreCandidate(clean, type, candidate)
        out.push({
          ...candidate,
          id,
          label: candidate.label,
          matchScore,
          searchTerms: buildSearchTerms(clean, candidate, type),
          score: matchScore,
        })
      }
      return out.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit)
    })())
  }
  try {
    return await cache.get(cacheKey)!
  } catch {
    cache.delete(cacheKey)
    return []
  }
}

export async function identifyEntity(query: string, type: NodeType): Promise<WikidataCandidate | null> {
  const [best] = await searchWikidataCandidates(query, type, 5)
  return best && best.matchScore >= 0.45 ? best : null
}

export function compareEntries(a: EntityIdentity | null | undefined, b: EntityIdentity | null | undefined): EntryComparison {
  const reasons: string[] = []
  if (!a || !b) return { sameIdentity: false, confidence: 0, reasons: ['missing identity'] }
  if (a.wikidataId && b.wikidataId) {
    const same = a.wikidataId === b.wikidataId
    return { sameIdentity: same, confidence: same ? 1 : 0.98, reasons: [same ? 'same wikidataId' : 'different wikidataId'] }
  }
  let confidence = 0
  if (a.birthYear != null && b.birthYear != null) {
    if (a.birthYear === b.birthYear) { confidence += 0.35; reasons.push('same birth year') }
    else { confidence -= 0.45; reasons.push('different birth year') }
  }
  if (a.deathYear != null && b.deathYear != null) {
    if (a.deathYear === b.deathYear) { confidence += 0.25; reasons.push('same death year') }
    else { confidence -= 0.35; reasons.push('different death year') }
  }
  if (a.country && b.country) {
    if (slugName(a.country) === slugName(b.country)) { confidence += 0.2; reasons.push('same country') }
    else { confidence -= 0.2; reasons.push('different country') }
  }
  return { sameIdentity: confidence >= 0.45, confidence: Math.max(0, Math.min(1, confidence)), reasons }
}

export function disambiguationLabel(identity?: EntityIdentity | null): string {
  if (!identity) return ''
  const bits = [
    identity.wikidataId,
    identity.birthYear != null ? `${identity.birthYear}${identity.deathYear != null ? `-${identity.deathYear}` : ''}` : '',
    identity.country || '',
  ].filter(Boolean)
  return bits.join(' · ')
}

