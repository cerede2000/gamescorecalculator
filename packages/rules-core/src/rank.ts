// P0 — moteur de classement. UNE primitive : la chaîne de comparateurs.
// Les dix « stratégies » du volume 4 sont des préréglages, pas des chemins de code.

import { cmp, type Maybe, type EnumScales, canonical } from './numeric.ts'

export type Direction = 'ASC' | 'DESC'
export type Criterion = {
  metric: string
  direction: Direction
  label?: string
  /** onDemand : la valeur n'existe pas encore, elle est demandée aux seuls candidats. */
  acquire?: 'present' | 'onDemand'
}
export type RankSpec = {
  scope: 'PARTICIPANT' | 'TEAM' | 'TABLE'
  criteria: Criterion[]
  missingPolicy: 'LAST' | 'EXCLUDE' | 'BLOCK'
  rankMode: 'COMPETITION' | 'DENSE' | 'UNIQUE'
  remainingTie: 'SHARED_RANK' | 'SHARED_WIN' | 'DECLARED_TIE'
}
/** BLOCK : le classement est refusé tant qu'une métrique manque. Ce n'est pas
 *  une panne, c'est un refus motivé — l'appelant doit pouvoir le distinguer
 *  d'une erreur de programmation et nommer ce qui manque. */
export class MissingMetric extends Error {
  metric: string
  constructor(metric: string) {
    super(`métrique ${metric} manquante — classement refusé`)
    this.metric = metric
  }
}

export type Entrant = { id: string; metrics: Record<string, Maybe> }
/** Fournisseur de métriques à la demande : le cœur ne demande qu'aux candidats listés. */
export type Provider = (metric: string, ids: string[]) => Record<string, Maybe>

export type ChainStep = {
  metric: string
  asked: string[]
  acquired: boolean
  resolved: boolean
  eliminated: string[]
  skipped?: true
}
export type Standing = {
  rank: number
  id: string
  shared: boolean
  verdict: 'WIN' | 'SHARED_WIN' | 'LOSS' | 'DECLARED_TIE' | 'NOT_RANKED'
  resolvedBy: string | null
}
export type RankResult = {
  standings: Standing[]
  chain: ChainStep[]
  questionsAsked: number
  unresolved: string[][]
}

export function rank(
  entrants: Entrant[],
  spec: RankSpec,
  opts: { provider?: Provider; scales?: EnumScales } = {}
): RankResult {
  const scales = opts.scales ?? {}
  const chain: ChainStep[] = []
  let questions = 0

  // groupes d'ex æquo, initialement tout le monde, dans l'ordre des sièges
  let groups: string[][] = [entrants.map(e => e.id)]
  const byId = new Map(entrants.map(e => [e.id, e]))
  const resolvedBy = new Map<string, string>()

  for (const c of spec.criteria) {
    const active = groups.filter(g => g.length > 1)
    if (active.length === 0) {
      chain.push({ metric: c.metric, asked: [], acquired: false, resolved: false, eliminated: [], skipped: true })
      continue
    }
    const askIds = active.flat()

    // acquisition paresseuse : on ne demande qu'aux candidats encore à égalité
    let acquired = false
    if (c.acquire === 'onDemand') {
      if (!opts.provider) throw new Error(`critère ${c.metric} en onDemand sans fournisseur`)
      const got = opts.provider(c.metric, askIds)
      for (const id of askIds) byId.get(id)!.metrics[c.metric] = got[id] ?? null
      questions += askIds.length
      acquired = true
    }

    const next: string[][] = []
    const eliminated: string[] = []
    let anyResolved = false

    for (const g of groups) {
      if (g.length === 1) { next.push(g); continue }
      const sorted = [...g].sort((x, y) => compareOn(byId, x, y, c, spec, scales))
      // découpe en sous-groupes d'égalité stricte
      let cur: string[] = [sorted[0]]
      const parts: string[][] = [cur]
      for (let i = 1; i < sorted.length; i++) {
        if (compareOn(byId, sorted[i - 1], sorted[i], c, spec, scales) === 0) cur.push(sorted[i])
        else { cur = [sorted[i]]; parts.push(cur) }
      }
      if (parts.length > 1) {
        anyResolved = true
        for (const p of parts.slice(1)) eliminated.push(...p)
        // le critère retenu est le DERNIER qui a scindé le groupe du joueur,
        // pas le premier : c'est celui qui le sépare de ses derniers ex æquo.
        for (const id of g) resolvedBy.set(id, c.metric)
      }
      next.push(...parts)
    }
    groups = next
    chain.push({ metric: c.metric, asked: askIds, acquired, resolved: anyResolved, eliminated })
    if (groups.every(g => g.length === 1)) {
      // la chaîne est résolue : les critères suivants ne sont jamais atteints
      for (const rest of spec.criteria.slice(spec.criteria.indexOf(c) + 1))
        chain.push({ metric: rest.metric, asked: [], acquired: false, resolved: false, eliminated: [], skipped: true })
      break
    }
  }

  // attribution des rangs
  const standings: Standing[] = []
  let position = 1
  for (const g of groups) {
    const shared = g.length > 1
    for (const id of g) {
      standings.push({
        rank: position, id, shared,
        verdict: position === 1
          ? (shared ? (spec.remainingTie === 'DECLARED_TIE' ? 'DECLARED_TIE' : 'SHARED_WIN') : 'WIN')
          : 'LOSS',
        resolvedBy: resolvedBy.get(id) ?? null
      })
    }
    position += spec.rankMode === 'DENSE' ? 1 : g.length
  }

  return {
    standings,
    chain,
    questionsAsked: questions,
    unresolved: groups.filter(g => g.length > 1)
  }
}

function compareOn(
  byId: Map<string, Entrant>, x: string, y: string,
  c: Criterion, spec: RankSpec, scales: EnumScales
): number {
  const a = byId.get(x)!.metrics[c.metric] ?? null
  const b = byId.get(y)!.metrics[c.metric] ?? null
  if (a === null || b === null) {
    if (spec.missingPolicy === 'BLOCK') throw new MissingMetric(c.metric)
    if (a === null && b === null) return 0
    return a === null ? 1 : -1          // LAST : l'inconnu va au bout, JAMAIS traité comme zéro
  }
  const r = cmp(a, b, scales)!
  return c.direction === 'DESC' ? -r : r
}

/** Empreinte canonique d'un classement — sert au déterminisme (RG-07). */
export function fingerprint(r: RankResult): string {
  return canonical({ type: 'INTEGER', value: '0' }) &&
    JSON.stringify(r.standings.map(s => [s.rank, s.id, s.shared, s.verdict, s.resolvedBy]))
}
