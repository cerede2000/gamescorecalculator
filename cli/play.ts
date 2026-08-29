// Joue une partie de référence à partir d'un bundle JSON chargé À L'EXÉCUTION.
// Le cœur ne connaît aucun jeu : il ne fait que lire des données.

import { readFileSync, readdirSync } from 'node:fs'
import { score, sumMatchesTotal, type Report } from '../packages/rules-core/src/score.ts'
import { rank, type Entrant, type Provider } from '../packages/rules-core/src/rank.ts'
import { validate, isPublishable } from '../packages/rules-core/src/validate.ts'
import { add, canonical, type Maybe, type NumericValue } from '../packages/rules-core/src/numeric.ts'

const I = (n: number): NumericValue => ({ type: 'INTEGER', value: String(n) })
const g = (s: string) => `\x1b[32m${s}\x1b[0m`, r = (s: string) => `\x1b[31m${s}\x1b[0m`
const b = (s: string) => `\x1b[1m${s}\x1b[0m`, dim = (s: string) => `\x1b[2m${s}\x1b[0m`

let pass = 0, fail = 0
const ok = (l: string, c: boolean, d = '') => {
  c ? (pass++, console.log(`  ${g('✓')} ${l}`)) : (fail++, console.log(`  ${r('✗')} ${l} ${d}`))
}

console.log(b('\nTablée — parties de référence jouées depuis les bundles JSON\n'))

for (const file of readdirSync('fixtures').sort()) {
  const fx = JSON.parse(readFileSync(`fixtures/${file}`, 'utf8'))
  const bundle = JSON.parse(readFileSync(`games/${fx.game}.json`, 'utf8'))

  const issues = validate(bundle)
  if (!isPublishable(issues)) { ok(`${file} — bundle refusé`, false); continue }

  const mode = bundle.scoringEngine.modes.find((m: any) => m.id === fx.mode)
  const spec = { derive: mode.derive ?? [], contributions: bundle.scoringEngine.contributions }

  console.log(b(`${fx.game}`) + dim(`  ${fx.label}`))

  // ── score de chaque participant, manche par manche ──
  const totals = new Map<string, Maybe>()
  const lastReport = new Map<string, Report>()
  for (const round of fx.rounds) {
    for (const p of fx.participants) {
      const raw = round[p.id]
      // une collection déclarée mais non saisie est VIDE ; seule une collection
      // non déclarée est une erreur, et la porte de publication l'a déjà refusée
      const empty = Object.fromEntries((mode.collections ?? []).map((c: any) => [c.id, []]))
      const inputs = raw.values || raw.collections
        ? { values: raw.values ?? {}, collections: { ...empty, ...toCollections(raw.collections) } }
        : { values: raw, collections: empty }
      const rep = score(spec, inputs)
      ok(`  ${p.name.padEnd(8)} ${String((rep.total as any)?.value ?? '?').padStart(4)}`,
         Number((rep.total as any).value) === fx.expect.totals[p.id],
         `attendu ${fx.expect.totals[p.id]}`)
      ok(`    └ somme des lignes = total`, sumMatchesTotal(rep))
      totals.set(p.id, add(totals.get(p.id) ?? I(0), rep.total))
      lastReport.set(p.id, rep)
    }
  }

  // ── classement, avec départage à la demande si le bundle en déclare ──
  const asked: { metric: string; ids: string[] }[] = []
  const provider: Provider = (metric, ids) => {
    asked.push({ metric, ids: [...ids] })
    return Object.fromEntries(ids.map(id => [id, fx.tiebreak?.[metric]?.[id] !== undefined
      ? I(fx.tiebreak[metric][id]) : null]))
  }
  const entrants: Entrant[] = fx.participants.map((p: any) => ({
    id: p.id,
    metrics: { cumulative: totals.get(p.id)!, ...localMetrics(fx, p.id) }
  }))
  const spec2 = {
    ...bundle.scoringEngine.ranking,
    criteria: [...bundle.scoringEngine.ranking.criteria, ...(bundle.scoringEngine.tieBreakers ?? [])]
  }
  const res = rank(entrants, spec2, { provider })
  const got = Object.fromEntries(res.standings.map(s => [s.id, s.rank]))
  ok(`  classement ${JSON.stringify(got)}`,
     Object.entries(fx.expect.ranks).every(([id, rk]) => got[id] === rk),
     `attendu ${JSON.stringify(fx.expect.ranks)}`)
  if (fx.expect.questions !== undefined)
    ok(`  ${res.questionsAsked} questions de départage, pas ${fx.participants.length * 4}`,
       res.questionsAsked === fx.expect.questions, `obtenu ${res.questionsAsked}`)

  const winner = res.standings.filter(s => s.rank === 1)
  const nom = (id: string) => fx.participants.find((p: any) => p.id === id).name
  const rb = res.standings[0].resolvedBy
  console.log(dim(`  → ${winner.length > 1 ? 'victoire partagée : ' : 'vainqueur : '}` +
    winner.map(s => nom(s.id)).join(' et ') +
    (rb && rb !== 'cumulative' ? `, départagé à « ${rb} »` : '')))
  console.log()
}

/** Deux formes reçues : une liste de valeurs (la clé est le rang) ou des
 *  paires [clé, décompte] explicites. Le serveur accepte les mêmes. */
function toCollections(c: Record<string, (number | [number, number])[]> | undefined) {
  if (!c) return {}
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k,
    v.map((x, i) => Array.isArray(x) ? { k: x[0], v: x[1] } : { k: i, v: x })]))
}
function localMetrics(fx: any, id: string): Record<string, Maybe> {
  const out: Record<string, Maybe> = {}
  const first = fx.rounds[0][id]
  const vals = first.values ?? first
  for (const [k, v] of Object.entries(vals)) out[k] = v as Maybe
  return out
}

console.log('─'.repeat(66))
console.log(b(`${pass} réussis · ${fail} échoués`) +
  `   —  ${readdirSync('games').length} bundles JSON, ${readdirSync('fixtures').length} parties`)
console.log('─'.repeat(66))
process.exit(fail === 0 ? 0 : 1)
