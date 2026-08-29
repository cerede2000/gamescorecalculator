// L'attelage entre ce qui est stocké et le noyau. Aucune règle de jeu ici :
// ce module range des données dans la forme que le noyau attend, et rend
// ce que le noyau a répondu.

import { score, type Report } from '../packages/rules-core/src/score.ts'
import { rank, MissingMetric, type Entrant, type RankResult, type Provider } from '../packages/rules-core/src/rank.ts'
import { evaluate } from '../packages/rules-core/src/formula.ts'
import { add, cmp as cmpVals, parse, canonical, type Maybe, type NumericValue } from '../packages/rules-core/src/numeric.ts'
import type { Bundle, ScoringMode } from '../packages/rules-core/src/bundle.ts'
import { TABLE_SCOPE } from './store.ts'

const I = (n: number | string): NumericValue => ({ type: 'INTEGER', value: String(n) })

/** Levée quand le classement réclame une métrique qui n'a pas encore été demandée.
 *  Le noyau reste synchrone et pur ; c'est le serveur qui interrompt et relance. */
export class NeedMetric extends Error {
  metric: string
  ids: string[]
  constructor(metric: string, ids: string[]) {
    super(`métrique ${metric} requise pour ${ids.join(', ')}`)
    this.metric = metric; this.ids = ids
  }
}

export type Row = { round: number; participant_id: string; field_id: string; value: string | null }
export type ColRow = { round: number; participant_id: string; collection_id: string; items: string }

export type RoundReport = { round: number; byParticipant: Record<string, Report> }
export type Question = { metric: string; label: string; ids: string[] }
/** Le classement refusé faute d'une donnée, avec qui la doit. */
export type Blocked = { metric: string; ids: string[] }
export type Trigger = { code: string; label: string; timing: string; mode: string; reversible: boolean; by: string[] }
export type Notice = { code: string; label: string; level: string; by: string[] }

export type Computed = {
  rounds: RoundReport[]
  totals: Record<string, Maybe>
  metrics: Record<string, Record<string, Maybe>>
  ranking: RankResult | null
  question: Question | null
  blocked: Blocked | null
  triggers: Trigger[]
  notices: Notice[]
}

export function modeOf(b: Bundle, id: string): ScoringMode {
  const m = b.scoringEngine.modes.find(x => x.id === id)
  if (!m) throw new Error(`mode de saisie inconnu : ${id}`)
  return m
}

/** Tous les identifiants qu'une formule du mode peut référencer, pour les
 *  initialiser à INCONNU. Une référence absente doit valoir null, pas lever. */
function declaredIds(mode: ScoringMode): string[] {
  return mode.inputs.map(f => f.id)
}

export function compute(
  bundle: Bundle,
  modeId: string,
  participants: { id: string; seat: number }[],
  inputs: Row[],
  collections: ColRow[],
  answers: Record<string, Record<string, Maybe>>,
  finished: boolean
): Computed {
  const mode = modeOf(bundle, modeId)
  const spec = { derive: mode.derive ?? [], contributions: bundle.scoringEngine.contributions }
  const ids = declaredIds(mode)
  const colIds = (mode.collections ?? []).map(c => c.id)

  const roundNos = [...new Set(inputs.map(r => r.round))].sort((a, b) => a - b)
  if (roundNos.length === 0) roundNos.push(1)

  // ── les scores, manche par manche ────────────────────────────────────────
  const rounds: RoundReport[] = []
  const totals: Record<string, Maybe> = {}
  let last: Record<string, Report> = {}

  for (const n of roundNos) {
    const byParticipant: Record<string, Report> = {}
    for (const p of participants) {
      const values: Record<string, Maybe> = Object.fromEntries(ids.map(k => [k, null]))
      // les champs de portée table s'appliquent à tout le monde, puis le
      // participant les recouvre s'il en porte de son côté
      for (const r of inputs)
        if (r.round === n && (r.participant_id === TABLE_SCOPE || r.participant_id === p.id))
          values[r.field_id] = r.value === null ? null : parse(r.value)

      const cols: Record<string, { k: number; v: number }[]> = Object.fromEntries(colIds.map(k => [k, []]))
      for (const c of collections)
        if (c.round === n && (c.participant_id === TABLE_SCOPE || c.participant_id === p.id))
          cols[c.collection_id] = (JSON.parse(c.items) as [number, number][]).map(([k, v]) => ({ k, v }))

      byParticipant[p.id] = score(spec, { values, collections: cols })
      totals[p.id] = add(totals[p.id] ?? I(0), byParticipant[p.id].total)
    }
    rounds.push({ round: n, byParticipant })
    last = byParticipant
  }

  // combien de participants partagent le meilleur cumul — un inconnu ne peut
  // pas être en tête, il est simplement absent du décompte
  const known = participants.map(p => totals[p.id]).filter((v): v is NumericValue => v != null)
  let topCount: Maybe = null
  if (known.length) {
    const best = known.reduce((a, b) => ((cmpVals(a, b) ?? 0) >= 0 ? a : b))
    topCount = I(known.filter(v => cmpVals(v, best) === 0).length)
  }

  // ── les métriques offertes au classement ─────────────────────────────────
  const metrics: Record<string, Record<string, Maybe>> = {}
  for (const p of participants) {
    const rep = last[p.id]
    const m: Record<string, Maybe> = {
      cumulative: totals[p.id] ?? null,
      roundScore: rep?.total ?? null,
      roundIndex: I(roundNos[roundNos.length - 1]),
      playerCount: I(participants.length),
      seatIndex: I(p.seat),
      topCount
    }
    for (const r of inputs)
      if (r.round === roundNos[roundNos.length - 1] && (r.participant_id === TABLE_SCOPE || r.participant_id === p.id))
        m[r.field_id] = r.value === null ? null : parse(r.value)
    for (const [k, v] of Object.entries(rep?.derived ?? {})) m[k] = v
    for (const l of rep?.lines ?? []) m[l.code] = l.value
    metrics[p.id] = m
  }

  // ── conditions de fin ────────────────────────────────────────────────────
  const triggers: Trigger[] = []
  for (const e of bundle.scoringEngine.endConditions ?? []) {
    const by = participants.filter(p => {
      try {
        const v = evaluate(e.when, { inputs: metrics[p.id], derived: {}, collections: {} }).value
        return v !== null && v.type === 'BOOLEAN' && v.value === 'true'
      } catch { return false }
    }).map(p => p.id)
    if (by.length)
      triggers.push({ code: e.code, label: e.label, timing: e.timing, mode: e.mode, reversible: e.reversible ?? false, by })
  }

  // ── avis : ce qu'il faut dire sans que l'état change ─────────────────────
  const notices: Notice[] = []
  for (const n of bundle.scoringEngine.notices ?? []) {
    const by = participants.filter(p => {
      try {
        const v = evaluate(n.when, { inputs: metrics[p.id], derived: {}, collections: {} }).value
        return v !== null && v.type === 'BOOLEAN' && v.value === 'true'
      } catch { return false }
    }).map(p => p.id)
    if (by.length) notices.push({ code: n.code, label: n.label, level: n.level, by })
  }

  // ── classement, et la question de départage s'il en manque une ───────────
  let ranking: RankResult | null = null
  let question: Question | null = null
  let blocked: Blocked | null = null

  if (finished) {
    const spec2 = {
      ...bundle.scoringEngine.ranking,
      criteria: [...bundle.scoringEngine.ranking.criteria, ...(bundle.scoringEngine.tieBreakers ?? [])]
    }
    const provider: Provider = (metric, asked) => {
      const known = answers[metric] ?? {}
      const missing = asked.filter(id => !(id in known))
      if (missing.length) throw new NeedMetric(metric, missing)
      return Object.fromEntries(asked.map(id => [id, known[id]]))
    }
    const entrants: Entrant[] = participants.map(p => ({ id: p.id, metrics: { ...metrics[p.id] } }))
    try {
      ranking = rank(entrants, spec2, { provider })
    } catch (e) {
      if (e instanceof NeedMetric) {
        const crit = spec2.criteria.find(c => c.metric === e.metric)
        question = { metric: e.metric, label: crit?.label ?? e.metric, ids: e.ids }
      } else if (e instanceof MissingMetric) {
        // refus motivé, pas une panne : on nomme qui n'a pas de valeur
        const owed = participants
          .filter(p => (e.metric in (answers[e.metric] ?? {}) ? answers[e.metric][p.id] : metrics[p.id][e.metric]) == null)
          .map(p => p.id)
        blocked = { metric: e.metric, ids: owed }
      } else throw e
    }
  }

  return { rounds, totals, metrics, ranking, question, blocked, triggers, notices }
}

export { canonical }
