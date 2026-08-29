// P0b — les quatre vrais jeux exprimés dans le langage de formules.
//
// Règles confirmées par le détenteur des règles le 29/08/2026 :
//  · Flip 7 : le paquet ne contient QU'UN SEUL x2 — le cumul est impossible.
//    Le champ est donc un booléen, définitivement. Politique « x2Stacking » retirée.
//  · Flip 7 : les Bonus vont de +2 à +10 par pas de 2 (valeurs paires).
//  · Moon Colony : jetons sur le Moon Base ET habitants imprimés sont deux
//    populations DISTINCTES — l'addition est correcte, aucun sur-comptage.
// Règle du protocole : les contributions sont IDENTIQUES entre express et guidée.
// Seules les dérivations changent — la guidée produit les entrées de l'express (EF-051).

import type { NumericValue, Maybe } from './numeric.ts'
import type { Node } from './formula.ts'
import type { ScoringSpec, Inputs, Contribution } from './score.ts'

const I = (n: number): NumericValue => ({ type: 'INTEGER', value: String(n) })
const lit = (n: number): Node => ({ op: 'lit', value: I(n) })
const ref = (id: string): Node => ({ op: 'ref', id })
const mul = (...args: Node[]): Node => ({ op: 'mul', args })
const add = (...args: Node[]): Node => ({ op: 'add', args })
const iff = (cond: Node, then: Node, els: Node): Node => ({ op: 'if', cond, then, else: els })
const gte = (left: Node, right: Node): Node => ({ op: 'gte', left, right })
const gt = (left: Node, right: Node): Node => ({ op: 'gt', left, right })
const eq = (left: Node, right: Node): Node => ({ op: 'eq', left, right })
const not = (arg: Node): Node => ({ op: 'not', arg })
const and = (...args: Node[]): Node => ({ op: 'and', args })
const sumOver = (collection: string, each: Node): Node => ({ op: 'sumOver', collection, each })
const countDistinct = (collection: string): Node => ({ op: 'countDistinct', collection })

const B = (b: boolean): NumericValue => ({ type: 'BOOLEAN', value: String(b) })
export const bool = B
export const int = I

export type GameCase = {
  game: string
  label: string
  express: { spec: ScoringSpec; inputs: Inputs }
  guided?: { spec: ScoringSpec; inputs: Inputs }
  expect: number
}

// ─────────────────────────────────────────────────────────────── FLIP 7 ────
const FLIP7_CONTRIB: Contribution[] = [
  { code: 'round.busted', label: 'Manche perdue sur doublon',
    when: ref('busted'), value: lit(0), exclusive: true },
  // un seul x2 dans le paquet : booléen, jamais un compteur (règle confirmée)
  { code: 'round.numbers', label: 'Cartes numérotées',
    value: mul(ref('numberSum'), iff(ref('x2'), lit(2), lit(1))) },
  { code: 'round.bonus', label: 'Bonus additifs',
    when: gt(ref('bonusSum'), lit(0)), value: ref('bonusSum') },
  { code: 'round.flip7', label: 'Bonus Flip 7',
    when: ref('flip7'), value: lit(15) }
]
const flip7Express = (v: Record<string, Maybe>) =>
  ({ spec: { contributions: FLIP7_CONTRIB }, inputs: { values: v } })
const flip7Guided = (v: Record<string, Maybe>, cards: number[], bonuses: number[]) => ({
  spec: {
    derive: [
      { id: 'numberSum', value: sumOver('cards', ref('$v')) },
      { id: 'flip7',     value: eq(countDistinct('cards'), lit(7)) },
      { id: 'bonusSum',  value: sumOver('bonuses', ref('$v')) }
    ],
    contributions: FLIP7_CONTRIB
  },
  inputs: {
    values: v,
    collections: {
      cards: cards.map((c, k) => ({ k, v: c })),
      bonuses: bonuses.map((b, k) => ({ k, v: b }))
    }
  }
})

// ──────────────────────────────────────────────────────────── AKROPOLIS ────
const cat = (id: string, label: string): Contribution => ({
  code: `cat.${id}`, label,
  value: mul(add(ref(`${id}Std`), mul(lit(2), ref(`${id}Dbl`))), ref(`${id}Stars`))
})
const AKRO_CONTRIB: Contribution[] = [
  { code: 'cat.housing', label: 'Habitations',
    value: mul(ref('housingValue'), ref('housingStars'),
               iff(and(ref('varHousing'), gte(ref('housingValue'), lit(10))), lit(2), lit(1))) },
  cat('market',   'Marchés'),
  cat('barracks', 'Casernes'),
  cat('temple',   'Temples'),
  cat('garden',   'Jardins'),
  { code: 'stones', label: 'Pierres restantes', value: ref('stones') }
]
const akroExpress = (v: Record<string, Maybe>) =>
  ({ spec: { contributions: AKRO_CONTRIB }, inputs: { values: v } })
const akroGuided = (v: Record<string, Maybe>, levels: Record<string, [number, number][]>) => ({
  spec: {
    derive: [
      { id: 'housingValue', value: sumOver('housingLevels', mul(ref('$k'), ref('$v'))) },
      ...['market', 'barracks', 'temple', 'garden'].flatMap(c => ([
        { id: `${c}Std`, value: sumOver(`${c}StdLevels`, mul(ref('$k'), ref('$v'))) },
        { id: `${c}Dbl`, value: sumOver(`${c}DblLevels`, mul(ref('$k'), ref('$v'))) }
      ]))
    ],
    contributions: AKRO_CONTRIB
  },
  inputs: {
    values: v,
    collections: Object.fromEntries(
      Object.entries(levels).map(([n, pairs]) => [n, pairs.map(([k, q]) => ({ k, v: q }))]))
  }
})

// ────────────────────────────────────────────────────────── MOON COLONY ────
// populations distinctes : addition confirmée, pas de déduplication
const MC_MULTI: Contribution[] = [
  { code: 'survivors', label: 'Survivants',
    value: add(ref('moonBaseHabitants'), ref('printedHabitants')) }
]
const MC_SOLO: Contribution[] = [
  { code: 'solo.event', label: 'Dernier Event atteint',
    when: not(ref('manualReached')), value: ref('eventNumber') }
]
const MC_SOLO_EXT: Contribution[] = [
  { code: 'solo.robots', label: 'Robots ajoutés après l\'Instruction Manual',
    value: ref('robotsAdded') }
]

// ─────────────────────────────────────────────────────── DUNE: IMPERIUM ────
const DUNE_CONTRIB: Contribution[] = [
  { code: 'victoryPoints', label: 'Points de Victoire', value: ref('finalVictoryPoints') }
]

// ──────────────────────────────────────────────────────────────── CAS ──────
export const CASES: GameCase[] = [
  // Flip 7 — la manche du volume 5
  { game: 'flip7', label: 'Ana · 16 × 2, aucun bonus', expect: 32,
    express: flip7Express({ busted: B(false), numberSum: I(16), x2: B(true), bonusSum: I(0), flip7: B(false) }),
    guided:  flip7Guided({ busted: B(false), x2: B(true) }, [7, 9], []) },

  { game: 'flip7', label: 'Bo · manche perdue sur doublon', expect: 0,
    express: flip7Express({ busted: B(true), numberSum: I(7), x2: B(false), bonusSum: I(4), flip7: B(false) }) },

  { game: 'flip7', label: 'Cy · 39 + 6 + Flip 7', expect: 60,
    express: flip7Express({ busted: B(false), numberSum: I(39), x2: B(false), bonusSum: I(6), flip7: B(true) }),
    guided:  flip7Guided({ busted: B(false), x2: B(false) }, [5, 8, 12, 1, 0, 2, 11], [6]) },

  // Akropolis — la partie des volumes 3 et 5
  { game: 'akropolis', label: 'Ada · Casernes annulées faute d\'étoile', expect: 46,
    express: akroExpress({
      housingValue: I(9), housingStars: I(3), varHousing: B(true),
      marketStd: I(5),   marketDbl: I(0),   marketStars: I(2),
      barracksStd: I(5), barracksDbl: I(0), barracksStars: I(0),
      templeStd: I(1),   templeDbl: I(0),   templeStars: I(2),
      gardenStd: I(4),   gardenDbl: I(0),   gardenStars: I(1),
      stones: I(3) }),
    guided: akroGuided({
      housingStars: I(3), varHousing: B(true),
      marketStars: I(2), barracksStars: I(0), templeStars: I(2), gardenStars: I(1), stones: I(3) },
      { housingLevels: [[1, 5], [2, 2]],
        marketStdLevels: [[1, 2], [3, 1]], marketDblLevels: [],
        barracksStdLevels: [[1, 3], [2, 1]], barracksDblLevels: [],
        templeStdLevels: [[1, 1]], templeDblLevels: [],
        gardenStdLevels: [[1, 2], [2, 1]], gardenDblLevels: [] }) },

  { game: 'akropolis', label: 'Bruno · les cinq variantes, seuil Habitations à 10', expect: 74,
    express: akroExpress({
      housingValue: I(10), housingStars: I(2), varHousing: B(true),
      marketStd: I(1),   marketDbl: I(2),   marketStars: I(3),
      barracksStd: I(1), barracksDbl: I(1), barracksStars: I(1),
      templeStd: I(1),   templeDbl: I(3),   templeStars: I(1),
      gardenStd: I(2),   gardenDbl: I(1),   gardenStars: I(2),
      stones: I(1) }) },

  { game: 'akropolis', label: 'Chloé · valeur 5, seuil de variante non atteint', expect: 46,
    express: akroExpress({
      housingValue: I(5), housingStars: I(2), varHousing: B(true),
      marketStd: I(3),   marketDbl: I(0),   marketStars: I(1),
      barracksStd: I(4), barracksDbl: I(0), barracksStars: I(2),
      templeStd: I(2),   templeDbl: I(0),   templeStars: I(2),
      gardenStd: I(8),   gardenDbl: I(0),   gardenStars: I(2),
      stones: I(5) }) },

  // Moon Colony Bloodbath
  { game: 'moon-colony', label: 'Bo · 9 + 11 survivants', expect: 20,
    express: { spec: { contributions: MC_MULTI },
               inputs: { values: { moonBaseHabitants: I(9), printedHabitants: I(11) } } },
    guided: { spec: { derive: [{ id: 'printedHabitants', value: sumOver('buildings', ref('$v')) }],
                      contributions: MC_MULTI },
              inputs: { values: { moonBaseHabitants: I(9) },
                        collections: { buildings: [{ k: 0, v: 4 }, { k: 1, v: 3 }, { k: 2, v: 4 }] } } } },

  { game: 'moon-colony', label: 'solo · défaite à l\'Event 12', expect: 12,
    express: { spec: { contributions: MC_SOLO },
               inputs: { values: { manualReached: B(false), eventNumber: I(12) } } } },

  { game: 'moon-colony', label: 'solo · victoire, aucun score', expect: 0,
    express: { spec: { contributions: MC_SOLO },
               inputs: { values: { manualReached: B(true), eventNumber: I(0) } } } },

  { game: 'moon-colony', label: 'solo prolongé · 7 Robots', expect: 7,
    express: { spec: { contributions: MC_SOLO_EXT },
               inputs: { values: { robotsAdded: I(7) } } } },

  // Dune: Imperium
  { game: 'dune-imperium', label: 'Duncan · 12 Points de Victoire', expect: 12,
    express: { spec: { contributions: DUNE_CONTRIB },
               inputs: { values: { finalVictoryPoints: I(12) } } } },

  { game: 'dune-imperium', label: 'score visible 9 + Intrigue +2', expect: 11,
    express: { spec: { contributions: DUNE_CONTRIB },
               inputs: { values: { finalVictoryPoints: I(11) } } },
    guided: { spec: { derive: [{ id: 'finalVictoryPoints',
                                 value: add(ref('visibleVictoryPoints'), ref('endgameIntrigueAdjustment')) }],
                      contributions: DUNE_CONTRIB },
              inputs: { values: { visibleVictoryPoints: I(9), endgameIntrigueAdjustment: I(2) } } } },

  { game: 'dune-imperium', label: 'ajustement Intrigue négatif : 12 − 3', expect: 9,
    express: { spec: { contributions: DUNE_CONTRIB },
               inputs: { values: { finalVictoryPoints: I(9) } } },
    guided: { spec: { derive: [{ id: 'finalVictoryPoints',
                                 value: add(ref('visibleVictoryPoints'), ref('endgameIntrigueAdjustment')) }],
                      contributions: DUNE_CONTRIB },
              inputs: { values: { visibleVictoryPoints: I(12), endgameIntrigueAdjustment: I(-3) } } } }
]
