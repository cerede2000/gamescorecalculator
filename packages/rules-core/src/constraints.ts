// Ce que le MATÉRIEL interdit de saisir.
//
// Aucune règle de jeu ici : ce module lit des déclarations et compte. Il ne
// sait pas ce qu'est une carte, un cube ou un multiplicateur.

import type { Maybe } from './numeric.ts'
import type { Bundle, ScoringMode, CollectionSpec } from './bundle.ts'

export type Entry = {
  values: Record<string, Maybe>
  collections: Record<string, [number, number][]>
}
export type Breach = {
  id: string
  label: string
  message: string
  detail: string
  who: string[]
}

const intOf = (v: Maybe): number | null =>
  v === null || v === undefined || v.type !== 'INTEGER' ? null : Number(v.value)
const isTrue = (v: Maybe): boolean =>
  v !== null && v !== undefined && v.type === 'BOOLEAN' && v.value === 'true'

/** Ce qu'un participant seul ne peut pas déclarer : doublons, trop d'éléments. */
export function checkEntry(mode: ScoringMode, entry: Entry): Breach[] {
  const out: Breach[] = []
  for (const c of mode.collections ?? []) {
    if (c.kind !== 'valueList') continue
    const items = entry.collections[c.id] ?? []
    const values = items.map(([, v]) => v)

    if (c.distinct) {
      const seen = new Set<number>()
      const dup = values.filter(v => (seen.has(v) ? true : (seen.add(v), false)))
      if (dup.length)
        out.push({
          id: `${c.id}.distinct`, label: c.label,
          message: c.help ?? '',
          detail: `${[...new Set(dup)].join(', ')} en double`,
          who: []
        })
    }
    if (c.maxItems !== undefined && values.length > c.maxItems)
      out.push({
        id: `${c.id}.maxItems`, label: c.label,
        message: '', detail: `${values.length} éléments pour ${c.maxItems} au plus`, who: []
      })
  }
  return out
}

/** Ce que la TABLE ne peut pas déclarer, tous participants confondus. */
export function checkRound(
  bundle: Bundle,
  mode: ScoringMode,
  byParticipant: Record<string, Entry>,
  nameOf: (id: string) => string = id => id
): Breach[] {
  const out: Breach[] = []
  const cols = new Map((mode.collections ?? []).map(c => [c.id, c] as [string, CollectionSpec]))

  for (const s of bundle.scoringEngine.scarcity ?? []) {
    if (s.kind === 'holders') {
      const holders = Object.entries(byParticipant)
        .filter(([, e]) => isTrue(e.values[s.target]))
        .map(([id]) => id)
      const limit = s.limit ?? 1
      if (holders.length > limit)
        out.push({
          id: s.id, label: s.label, message: s.message,
          detail: `${holders.map(nameOf).join(', ')} — ${holders.length} pour ${limit} disponible(s)`,
          who: holders
        })
      continue
    }

    if (s.kind === 'supply') {
      const held = Object.entries(byParticipant)
        .map(([id, e]) => [id, intOf(e.values[s.target])] as [string, number | null])
        .filter(([, n]) => n !== null) as [string, number][]
      const total = held.reduce((a, [, n]) => a + n, 0)
      const limit = s.limit ?? 0
      if (total > limit)
        out.push({
          id: s.id, label: s.label, message: s.message,
          detail: `${total} déclarés pour ${limit} en réserve`,
          who: held.map(([id]) => id)
        })
      continue
    }

    // copies : chaque valeur n'existe qu'en un nombre donné d'exemplaires
    if (!cols.has(s.target)) continue
    const holdersOf = new Map<number, string[]>()
    for (const [id, e] of Object.entries(byParticipant))
      for (const [, v] of e.collections[s.target] ?? [])
        holdersOf.set(v, [...(holdersOf.get(v) ?? []), id])
    for (const [v, ids] of holdersOf) {
      const limit = s.byValue?.[String(v)]
      if (limit === undefined) continue            // valeur non déclarée : non limitée
      if (ids.length > limit)
        out.push({
          id: `${s.id}.${v}`, label: s.label, message: s.message,
          detail: `${ids.length} exemplaires de « ${v} » déclarés pour ${limit} dans le jeu (${[...new Set(ids)].map(nameOf).join(', ')})`,
          who: [...new Set(ids)]
        })
    }
  }
  return out
}

/** Ce que les AUTRES ont déjà pris, pour que l'écran l'empêche d'avance au
 *  lieu de le refuser après coup.
 *
 *  On rend ce qui est ÉPUISÉ, jamais ce qui est libre : une valeur dont le
 *  nombre d'exemplaires n'est pas déclaré n'est pas limitée, et l'oubli
 *  d'une déclaration doit laisser passer, pas bloquer. */
export function exhausted(
  bundle: Bundle,
  mode: ScoringMode,
  byParticipant: Record<string, Entry>,
  me: string
): { fields: Set<string>; values: Record<string, Set<number>> } {
  const fields = new Set<string>()
  const values: Record<string, Set<number>> = {}

  for (const s of bundle.scoringEngine.scarcity ?? []) {
    if (s.kind === 'holders') {
      const others = Object.entries(byParticipant)
        .filter(([id, e]) => id !== me && isTrue(e.values[s.target])).length
      if (others >= (s.limit ?? 1)) fields.add(s.target)
      continue
    }
    if (s.kind !== 'copies' || !s.byValue) continue
    const taken = new Map<number, number>()
    for (const [id, e] of Object.entries(byParticipant))
      if (id !== me)
        for (const [, v] of e.collections[s.target] ?? [])
          taken.set(v, (taken.get(v) ?? 0) + 1)
    const gone = values[s.target] ?? (values[s.target] = new Set<number>())
    for (const [k, limit] of Object.entries(s.byValue))
      if ((taken.get(Number(k)) ?? 0) >= limit) gone.add(Number(k))
  }
  return { fields, values }
}
