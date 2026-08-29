// Forme d'un bundle de jeu. Un bundle est une DONNÉE : il est chargé depuis un
// fichier JSON à l'exécution, jamais compilé avec le cœur (EF-022, EC-01).

import type { Node } from './formula.ts'
import type { NumericValue } from './numeric.ts'
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
  /** Ce que vaut le champ quand rien n'est saisi.
   *
   *  Par défaut, absent veut dire INCONNU (RG-12) et l'inconnu se propage.
   *  Certains jeux veulent l'inverse : dans un décompte par catégories, ne
   *  rien avoir dans une catégorie est un fait ordinaire, pas une lacune —
   *  et sans cette déclaration une seule case vide rendrait tout le total
   *  inconnu, puisque les catégories se multiplient par leurs étoiles.
   *
   *  C'est un choix du JEU, jamais du cœur : il se déclare champ par champ,
   *  et il est incompatible avec `required`. */
  whenAbsent?: NumericValue
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
  /** valueList : deux fois la même valeur est impossible pour un participant. */
  distinct?: boolean
  /** valueList : nombre maximal d'éléments pour un participant. */
  maxItems?: number
}

/** Le MATÉRIEL est fini. Ce qu'une boîte contient limite ce qu'une table peut
 *  déclarer, et cette limite porte sur tous les participants à la fois.
 *  La vérification porte sur une manche : pour un jeu à manche unique,
 *  la manche est la partie. */
export type Scarcity = {
  id: string
  label: string
  /** holders : au plus `limit` participants tiennent ce champ booléen.
   *  supply  : la somme de ce champ entier sur la table ne dépasse pas `limit`.
   *  copies  : chaque valeur de cette collection n'existe qu'en `byValue`
   *            exemplaires — une valeur absente de la table n'est pas limitée. */
  kind: 'holders' | 'supply' | 'copies'
  target?: string
  /** supply : plusieurs sources additionnées — champs entiers ou collections,
   *  une collection comptant pour la somme de ses éléments. */
  targets?: string[]
  /** supply : 'table' (défaut) somme tous les participants ; 'each' plafonne
   *  chacun séparément, ce qui est plus serré quand la dotation est par joueur. */
  per?: 'table' | 'each'
  limit?: number
  /** Le plafond dépend de la configuration : une expression du même langage,
   *  évaluée sur les métriques de cœur et les champs de portée table. */
  limitExpr?: Node
  byValue?: Record<string, number>
  usedBy: string
  message: string
  source?: string | null
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

/** Un fait de la partie qu'il faut DIRE, sans qu'il change l'état.
 *  Une condition de fin arrête la partie ; un avis explique seulement
 *  pourquoi elle ne s'arrête pas encore. */
export type Notice = {
  code: string
  label: string
  when: Node
  level: 'info' | 'warn'
  source?: string | null
}

/** Une quantité de matériel. Elle dépend souvent de la configuration :
 *  c'est tout l'intérêt d'un assistant de mise en place. */
export type SetupQuantity = {
  label: string
  /** un nombre fixe */
  value?: number
  /** un nombre calculé — expression du même langage, sur les métriques de cœur */
  valueExpr?: Node
  /** un nombre par siège : [1er joueur, 2e, 3e, …] */
  bySeat?: number[]
  unit?: string
}

export type SetupStep = {
  id: string
  title: string
  body?: string
  /** TABLE : une fois pour tout le monde. PER_PLAYER : chacun le fait chez lui. */
  scope: 'TABLE' | 'PER_PLAYER'
  quantities?: SetupQuantity[]
  /** L'étape ne s'affiche que si la condition tient — un mode solo ne se
   *  prépare pas comme une table de quatre. */
  when?: Node
  /** D'où vient l'instruction. Une mise en place sans source est une invention. */
  source?: string | null
}

export type SetupAssistant = {
  /** false = aucune fiche n'est rédigée, et l'écran le dit au lieu de faire semblant */
  enabled: boolean
  /** L'assistant peut couvrir MOINS de configurations que le moteur de score :
   *  un groupe peut vouloir compter une partie que l'app ne sait pas préparer.
   *  Omis = couvre toutes les configurations du jeu. */
  playerCountRules?: { min: number; max: number | null }
  /** Motif affiché hors couverture — obligatoire si playerCountRules est restreint. */
  outOfScopeNotice?: string
  /** Motif affiché quand aucune fiche n'existe. */
  missingNotice?: string
  steps?: SetupStep[]
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
  setupAssistant?: SetupAssistant
  scoringEngine: {
    modes: ScoringMode[]
    contributions: Contribution[]
    endConditions?: EndCondition[]
    notices?: Notice[]
    scarcity?: Scarcity[]
    ranking: RankSpec
    tieBreakers?: RankSpec['criteria']
  }
  ui?: { layout: 'playerGrid' | 'categoryPager'; fieldsPerPlayer?: number }
  fixtures?: string[]
}
