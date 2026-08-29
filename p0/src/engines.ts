// P0 — les sept moteurs fictifs de validation, plus un huitième pour le départage
// progressif. Ils ne sont pas jouables : ils échouent bruyamment si le noyau régresse.

import type { NumericValue, Maybe } from './numeric.ts'
import type { RankSpec, Entrant, Provider } from './rank.ts'

export const I = (v: string | number): NumericValue => ({ type: 'INTEGER', value: String(v) })
export const D = (v: string, scale: number): NumericValue => ({ type: 'DECIMAL', value: v, scale })
export const R = (n: string | number, d: string | number): NumericValue =>
  ({ type: 'RATIONAL', numerator: String(n), denominator: String(d) })
export const B = (v: boolean): NumericValue => ({ type: 'BOOLEAN', value: String(v) })
export const O = (v: number): NumericValue => ({ type: 'ORDINAL', value: String(v) })
export const T = (ms: number): NumericValue => ({ type: 'DURATION', value: String(ms) })
export const E = (scale: string, v: string): NumericValue => ({ type: 'ENUM', scale, value: v })

/** Primitives du noyau. Liste FIGÉE : un moteur qui en exige une autre fait échouer P0. */
export const CORE_PRIMITIVES = [
  'add', 'sub', 'mul', 'div', 'abs', 'sum', 'min', 'max', 'cmp', 'bracket',
  'chain', 'scope', 'rankMode', 'missingPolicy', 'onDemand'
] as const
export type Primitive = typeof CORE_PRIMITIVES[number]

export type Engine = {
  id: string
  proves: string
  /** primitives réellement utilisées — vérifiées contre CORE_PRIMITIVES */
  uses: Primitive[]
  entrants: Entrant[]
  spec: RankSpec
  provider?: Provider
  scales?: Record<string, string[]>
  outcome: 'RANKED' | 'COLLECTIVE' | 'GRADED' | 'NONE'
  /** attendu : rangs par identifiant, et éventuellement le nombre de questions posées */
  expect: { ranks: Record<string, number>; shared?: string[]; questions?: number; grade?: string }
}

const plain = (criteria: RankSpec['criteria'], over: Partial<RankSpec> = {}): RankSpec => ({
  scope: 'PARTICIPANT', criteria, missingPolicy: 'LAST',
  rankMode: 'COMPETITION', remainingTie: 'DECLARED_TIE', ...over
})

// 1 ─ le score le plus FAIBLE gagne, alors qu'un seuil ÉLEVÉ déclenche la fin
export const moindrePli: Engine = {
  id: 'fic.moindre-pli',
  proves: 'sens de comparaison inversé : MINIMIZE',
  uses: ['chain', 'cmp'],
  entrants: [
    { id: 'a', metrics: { points: I(42) } },
    { id: 'b', metrics: { points: I(17) } },
    { id: 'c', metrics: { points: I(101) } }   // c déclenche la fin ET perd
  ],
  spec: plain([{ metric: 'points', direction: 'ASC' }]),
  outcome: 'RANKED',
  expect: { ranks: { b: 1, a: 2, c: 3 } }
}

// 2 ─ incréments négatifs et décimaux, total pouvant passer sous zéro
export const ardoise: Engine = {
  id: 'fic.ardoise',
  proves: 'décimaux exacts, valeurs négatives, 0,1 + 0,2',
  uses: ['add', 'chain', 'cmp'],
  entrants: [
    { id: 'a', metrics: { score: D('5.5', 1) } },    // 8,0 + (-2,5)
    { id: 'b', metrics: { score: D('0.3', 1) } },    // 0,1 + 0,2
    { id: 'c', metrics: { score: D('-4.25', 2) } }
  ],
  spec: plain([{ metric: 'score', direction: 'DESC' }]),
  outcome: 'RANKED',
  expect: { ranks: { a: 1, b: 2, c: 3 } }
}

// 3 ─ coopératif : aucun score individuel, un seul résultat de table
export const expedition: Engine = {
  id: 'fic.expedition',
  proves: 'portée de résultat TABLE, victoire collective',
  uses: ['scope', 'cmp'],
  entrants: [{ id: 'table', metrics: { missionAccomplie: B(true) } }],
  spec: { scope: 'TABLE', criteria: [{ metric: 'missionAccomplie', direction: 'DESC' }],
          missingPolicy: 'BLOCK', rankMode: 'DENSE', remainingTie: 'SHARED_WIN' },
  outcome: 'COLLECTIVE',
  expect: { ranks: { table: 1 } }
}

// 4 ─ victoire par points OU par élimination, avec la voie expliquée
export const doubleVoie: Engine = {
  id: 'fic.double-voie',
  proves: 'conditions de victoire ordonnées ; le survivant gagne malgré moins de points',
  uses: ['chain', 'cmp'],
  entrants: [
    { id: 'a', metrics: { vivant: B(false), points: I(88) } },
    { id: 'b', metrics: { vivant: B(false), points: I(71) } },
    { id: 'c', metrics: { vivant: B(true),  points: I(23) } }   // dernier en vie
  ],
  spec: plain([
    { metric: 'vivant', direction: 'DESC' },
    { metric: 'points', direction: 'DESC' }
  ]),
  outcome: 'RANKED',
  expect: { ranks: { c: 1, a: 2, b: 3 } }
}

// 5 ─ course : rang d'arrivée décisif, temps affiché mais non décisif, abandon
export const courseDesCols: Engine = {
  id: 'fic.course-des-cols',
  proves: 'ORDINAL, valeur absente placée en dernier et JAMAIS traitée comme zéro',
  uses: ['chain', 'cmp', 'missingPolicy'],
  entrants: [
    { id: 'a', metrics: { arrivee: O(2), temps: T(4355000) } },
    { id: 'b', metrics: { arrivee: O(1), temps: T(4090000) } },
    { id: 'c', metrics: { arrivee: null, temps: null } }          // abandon
  ],
  spec: plain([{ metric: 'arrivee', direction: 'ASC' }], { missingPolicy: 'LAST' }),
  outcome: 'RANKED',
  expect: { ranks: { b: 1, a: 2, c: 3 } }
}

// 6 ─ scores en 1, ½, 0 conservés exacts
export const tournoiDemis: Engine = {
  id: 'fic.tournoi-demis',
  proves: 'rationnels exacts, sans conversion en décimal',
  uses: ['sum', 'chain', 'cmp'],
  entrants: [
    { id: 'a', metrics: { total: R(3, 1) } },    // 1 + ½ + 0 + ½ + 1
    { id: 'b', metrics: { total: R(5, 2) } },    // ½ × 5
    { id: 'c', metrics: { total: R(3, 1) } }     // 1 + 1 + 1
  ],
  spec: plain([{ metric: 'total', direction: 'DESC' }]),
  outcome: 'RANKED',
  expect: { ranks: { a: 1, c: 1, b: 3 }, shared: ['a', 'c'] }
}

// 7 ─ solo : appréciation plutôt que gagnant, valeur numérique conservée à part
export const soloAtelier: Engine = {
  id: 'fic.solo-atelier',
  proves: 'échelle de performance via bracket, résultat GRADED sans gagnant',
  uses: ['bracket', 'scope', 'cmp'],
  entrants: [{ id: 'table', metrics: { points: I(62), palier: E('medal', 'silver') } }],
  spec: { scope: 'TABLE', criteria: [{ metric: 'palier', direction: 'DESC' }],
          missingPolicy: 'BLOCK', rankMode: 'DENSE', remainingTie: 'DECLARED_TIE' },
  scales: { medal: ['fail', 'bronze', 'silver', 'gold'] },
  outcome: 'GRADED',
  expect: { ranks: { table: 1 }, grade: 'silver' }
}

// 8 ─ départage progressif : les valeurs n'existent pas avant d'être demandées
const RESSOURCES: Record<string, Record<string, Maybe>> = {
  spice:  { paul: I(3), chani: I(5), duncan: I(5), gurney: I(0) },
  solari: { paul: I(9), chani: I(7), duncan: I(7), gurney: I(0) },
  water:  { paul: I(1), chani: I(2), duncan: I(4), gurney: I(0) },
  troops: { paul: I(0), chani: I(0), duncan: I(0), gurney: I(0) }
}
export const askLog: { metric: string; ids: string[] }[] = []
const provider: Provider = (metric, ids) => {
  askLog.push({ metric, ids: [...ids] })
  return Object.fromEntries(ids.map(id => [id, RESSOURCES[metric]?.[id] ?? null]))
}

export const departageProgressif: Engine = {
  id: 'fic.departage-progressif',
  proves: 'acquisition paresseuse : aucune question à un joueur non candidat, arrêt dès résolution',
  uses: ['chain', 'cmp', 'onDemand'],
  entrants: [
    { id: 'paul',   metrics: { pv: I(12) } },
    { id: 'chani',  metrics: { pv: I(12) } },
    { id: 'duncan', metrics: { pv: I(12) } },
    { id: 'gurney', metrics: { pv: I(9) } }
  ],
  spec: plain([
    { metric: 'pv',     direction: 'DESC' },
    { metric: 'spice',  direction: 'DESC', acquire: 'onDemand' },
    { metric: 'solari', direction: 'DESC', acquire: 'onDemand' },
    { metric: 'water',  direction: 'DESC', acquire: 'onDemand' },
    { metric: 'troops', direction: 'DESC', acquire: 'onDemand' }
  ]),
  provider,
  outcome: 'RANKED',
  // 3 (épice) + 2 (solari) + 2 (eau) = 7 questions ; « troops » jamais atteint
  expect: { ranks: { duncan: 1, chani: 2, paul: 3, gurney: 4 }, questions: 7 }
}

export const ALL: Engine[] = [
  moindrePli, ardoise, expedition, doubleVoie,
  courseDesCols, tournoiDemis, soloAtelier, departageProgressif
]
