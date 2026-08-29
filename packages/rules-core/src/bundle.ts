// Forme d'un bundle de jeu. Un bundle est une DONNÉE : il est chargé depuis un
// fichier JSON à l'exécution, jamais compilé avec le cœur (EF-022, EC-01).

import type { Node } from './formula.ts'
import type { Contribution, Derivation } from './score.ts'
import type { RankSpec } from './rank.ts'

export type Field = {
  id: string
  label: string
  type: 'INTEGER' | 'DECIMAL' | 'RATIONAL' | 'DURATION' | 'ORDINAL' | 'BOOLEAN' | 'ENUM'
  unit?: string
  min?: number
  max?: number
  step?: number
  values?: number[]                 // ensemble fermé, rend un pavé de pastilles
  required?: boolean
  scope: 'PARTICIPANT' | 'PARTICIPANT_ROUND' | 'TEAM' | 'ROUND' | 'GAME'
  control: string
  /** OBLIGATOIRE (EC-03) : la formule, condition de fin ou règle qui consomme ce champ.
   *  Un champ sans justification est refusé à la publication. */
  usedBy: string
  help?: string
}

export type Policy = {
  id: string
  status: 'confirmed' | 'unconfirmed' | 'houseRule'
  question?: string                 // obligatoire si status = unconfirmed
  options?: string[]
  provisional: string
  affectsScore: boolean
  source?: string | null
  rationale?: string
}

/** Une collection est une liste d'items { k, v } consommée par sumOver/count/countDistinct.
 *  Le moteur n'en a jamais eu besoin — il reçoit les items déjà construits. La SAISIE,
 *  elle, doit savoir quoi demander : c'est le rôle de cette déclaration.
 *  Sans elle, un mode guidé qui emploie une collection ne peut pas être affiché. */
export type CollectionSpec = {
  id: string
  label: string
  /** valueList : chaque item est une valeur saisie, k est son rang.
   *  keyedCounts : k est une clé déclarée, v le nombre d'occurrences. */
  kind: 'valueList' | 'keyedCounts'
  /** OBLIGATOIRE (EC-03) : la dérivation ou la formule qui consomme cette collection. */
  usedBy: string
  /** valueList : ensemble fermé des valeurs proposées. */
  values?: number[]
  /** keyedCounts, ensemble fermé : les clés, dans l'ordre d'affichage. */
  keys?: { k: number; label: string }[]
  /** keyedCounts, ensemble ouvert : borne haute nulle = pas de plafond.
   *  Un livret qui énumère « 1, 2, 3, etc. » ne pose pas de plafond ;
   *  figer une liste de clés en inventerait un. */
  keyRange?: { from: number; to: number | null; suggest?: number; label: string }
  min?: number
  max?: number
  control?: 'chips' | 'stepper' | 'keypad'
  help?: string
}

export type ScoringMode = {
  id: 'express' | 'guided'
  default?: boolean
  derivesInputsOf?: 'express'
  inputs: Field[]
  derive?: Derivation[]
  collections?: CollectionSpec[]
}

export type EndCondition = {
  code: string
  label: string
  level: 'round' | 'match'
  on: string[]
  when: Node
  timing: 'immediate' | 'endOfRound' | 'lastRound' | 'manualConfirm'
  mode: 'auto' | 'confirm' | 'manual'
  reversible?: boolean
  explain?: string
}

export type Bundle = {
  gameId: string
  version: string
  contract: string
  name: Record<string, string>
  rulesVersion: { label: string; confirmed: boolean }
  playerCountRules: { min: number; max: number | null; softMax?: number }
  locales: string[]
  policies?: Policy[]
  setupAssistant?: {
    enabled: boolean
    /** L'assistant peut couvrir MOINS de configurations que le moteur de score :
     *  un groupe peut vouloir compter une partie que l'app ne sait pas préparer.
     *  Omis = couvre toutes les configurations du jeu. */
    playerCountRules?: { min: number; max: number | null }
    /** Motif affiché hors couverture — obligatoire si playerCountRules est restreint. */
    outOfScopeNotice?: string
    steps?: unknown[]
    materials?: unknown[]
  }
  scoringEngine: {
    modes: ScoringMode[]
    contributions: Contribution[]
    endConditions?: EndCondition[]
    ranking: RankSpec
    tieBreakers?: RankSpec['criteria']
  }
  ui?: { layout: 'playerGrid' | 'categoryPager'; fieldsPerPlayer?: number }
  fixtures?: string[]
}
