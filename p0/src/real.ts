// Les exemples chiffrés des dossiers, rejoués par le MÊME moteur de classement.
// Ils ferment la boucle entre la spécification et le code.

import { rank, type Entrant, type RankSpec } from './rank.ts'
import { I } from './engines.ts'

const spec = (criteria: RankSpec['criteria']): RankSpec => ({
  scope: 'PARTICIPANT', criteria, missingPolicy: 'LAST',
  rankMode: 'COMPETITION', remainingTie: 'DECLARED_TIE'
})

export const CAS_REELS = [
  {
    id: 'flip7 · fin ≠ victoire',
    note: 'Ana franchit 200 la première et déclenche la fin ; Cy gagne',
    entrants: [
      { id: 'ana', metrics: { total: I(215) } },
      { id: 'bo',  metrics: { total: I(139) } },
      { id: 'cy',  metrics: { total: I(223) } }
    ] as Entrant[],
    spec: spec([{ metric: 'total', direction: 'DESC' }]),
    expect: { cy: 1, ana: 2, bo: 3 }
  },
  {
    id: 'akropolis · départage aux Pierres',
    note: 'Chloé et Ada à 46 ; Chloé l\'emporte avec 5 Pierres contre 3',
    entrants: [
      { id: 'ada',   metrics: { total: I(46), pierres: I(3) } },
      { id: 'bruno', metrics: { total: I(74), pierres: I(1) } },
      { id: 'chloe', metrics: { total: I(46), pierres: I(5) } }
    ] as Entrant[],
    spec: spec([
      { metric: 'total',   direction: 'DESC' },
      { metric: 'pierres', direction: 'DESC' }
    ]),
    expect: { bruno: 1, chloe: 2, ada: 3 },
    resolvedBy: { chloe: 'pierres', ada: 'pierres', bruno: 'total' }
  },
  {
    id: 'moon colony · victoire partagée',
    note: 'Bo et Cy à 20 survivants ; départage officiel inconnu',
    entrants: [
      { id: 'ana', metrics: { survivants: I(19) } },
      { id: 'bo',  metrics: { survivants: I(20) } },
      { id: 'cy',  metrics: { survivants: I(20) } }
    ] as Entrant[],
    spec: spec([{ metric: 'survivants', direction: 'DESC' }]),
    expect: { bo: 1, cy: 1, ana: 3 },
    shared: ['bo', 'cy']
  }
]

export function runReal(ok: (l: string, c: boolean, d?: string) => void) {
  for (const cas of CAS_REELS) {
    const r = rank(cas.entrants, cas.spec)
    const got = Object.fromEntries(r.standings.map(s => [s.id, s.rank]))
    ok(`${cas.id} — ${cas.note}`,
       Object.entries(cas.expect).every(([id, rk]) => got[id] === rk),
       `attendu ${JSON.stringify(cas.expect)} obtenu ${JSON.stringify(got)}`)
    if (cas.shared)
      ok(`  └ rang 1 partagé`, cas.shared.every(id => r.standings.find(s => s.id === id)?.shared === true))
    if (cas.resolvedBy)
      for (const [id, m] of Object.entries(cas.resolvedBy))
        ok(`  └ ${id} départagé par « ${m} »`, r.standings.find(s => s.id === id)?.resolvedBy === m,
           String(r.standings.find(s => s.id === id)?.resolvedBy))
  }
}
