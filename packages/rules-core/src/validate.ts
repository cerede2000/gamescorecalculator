// La PORTE DE PUBLICATION. Un bundle qui ne passe pas ici n'entre pas au catalogue.
// Chaque contrôle porte l'exigence qu'il fait respecter.

import { FORMULA_PRIMITIVES, type Node } from './formula.ts'
import type { Bundle, Field } from './bundle.ts'

export type Issue = { severity: 'error' | 'warning'; rule: string; message: string }

const BOUND = new Set(['$k', '$v'])

/** Métriques fournies par le CŒUR, référençables par tout plugin sans les déclarer.
 *  Le cumul des manches est une responsabilité du back-end (cahier des charges §19),
 *  pas du moteur de jeu : un plugin le lit, il ne le calcule pas. */
export const CORE_METRICS = new Set([
  'cumulative',    // somme des scores de manche du participant
  'roundScore',    // score de la manche courante
  'roundIndex',    // numéro de la manche
  'playerCount',   // nombre de participants
  'seatIndex',     // position du participant, parfois critère de départage
  'topCount'       // combien de participants partagent le meilleur cumul
])

function walk(n: Node, fn: (x: Node) => void): void {
  fn(n)
  for (const k of ['cond', 'then', 'else', 'each', 'input', 'left', 'right', 'arg'])
    if ((n as any)[k]) walk((n as any)[k], fn)
  for (const a of ((n as any).args ?? [])) walk(a, fn)
}

export function validate(b: Bundle): Issue[] {
  const out: Issue[] = []
  const err = (rule: string, message: string) => out.push({ severity: 'error', rule, message })
  const warn = (rule: string, message: string) => out.push({ severity: 'warning', rule, message })

  // ── EC-04 · manifeste complet ─────────────────────────────────────────────
  for (const k of ['gameId', 'version', 'contract', 'rulesVersion', 'playerCountRules', 'locales'] as const)
    if (b[k] === undefined) err('EC-04', `champ de manifeste manquant : ${k}`)
  if (b.playerCountRules && b.playerCountRules.min < 1)
    err('EC-04', 'playerCountRules.min doit valoir au moins 1')
  if (b.playerCountRules?.max === null && !b.playerCountRules.softMax)
    warn('EC-06', 'bornes de joueurs inconnues sans softMax : aucun garde-fou à l\'écran')

  // ── couverture de l'assistant de mise en place ────────────────────────────
  const sa = b.setupAssistant
  if (sa?.playerCountRules) {
    const g = b.playerCountRules, a = sa.playerCountRules
    if (a.min < g.min || (g.max !== null && a.max !== null && a.max > g.max))
      err('EF-031', 'l\'assistant prétend couvrir plus de configurations que le jeu')
    if (a.min > g.min || (g.max !== null && a.max !== null && a.max < g.max)) {
      if (!sa.outOfScopeNotice)
        err('EF-042', 'couverture restreinte de l\'assistant sans motif affiché à l\'utilisateur')
      else
        warn('EF-031', `assistant limité à ${a.min}-${a.max} joueurs alors que le jeu en accepte ${g.min}-${g.max ?? '?'} — le moteur de score reste disponible`)
    }
  }

  // ── EC-01 · un bundle est une donnée ──────────────────────────────────────
  const scan = (v: unknown, path = ''): void => {
    if (typeof v === 'function') err('EC-01', `valeur exécutable en ${path}`)
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) scan(x, path ? `${path}.${k}` : k)
  }
  scan(b)

  // ── EC-05 · toute politique non confirmée porte une question ──────────────
  for (const p of b.policies ?? []) {
    if (p.status === 'unconfirmed' && !p.question)
      err('EC-05', `politique « ${p.id} » non confirmée sans question formulée`)
    if (p.status === 'confirmed' && p.source === undefined)
      warn('EC-05', `politique « ${p.id} » déclarée confirmée sans source citée`)
  }

  const eng = b.scoringEngine
  if (!eng) { err('EC-02', 'scoringEngine absent'); return out }

  // cibles légitimes d'un usedBy
  const targets = new Set<string>([
    ...eng.contributions.map(c => `formula:${c.code}`),
    ...(eng.endConditions ?? []).map(e => `end:${e.code}`),
    ...eng.ranking.criteria.map(c => `ranking:${c.metric}`),
    ...(eng.tieBreakers ?? []).map(c => `tiebreak:${c.metric}`)
  ])

  const allDeriveTargets = new Set(eng.modes.flatMap(m => (m.derive ?? []).map(d => `derive:${d.id}`)))

  const express = eng.modes.find(m => m.id === 'express')
  const guided = eng.modes.find(m => m.id === 'guided')
  if (!express) err('EF-050', 'aucun mode express — il doit être proposé par défaut')
  if (eng.modes.length > 2) err('EF-050', `${eng.modes.length} modes de saisie : deux au maximum`)

  // ── EC-03 · tout champ justifie son existence ─────────────────────────────
  const allFields: Field[] = eng.modes.flatMap(m => m.inputs)
  for (const f of allFields) {
    if (!f.usedBy) { err('EC-03', `champ « ${f.id} » sans usedBy — refusé`); continue }
    if (!targets.has(f.usedBy))
      err('EC-03', `champ « ${f.id} » : usedBy « ${f.usedBy} » ne désigne rien d'existant`)
  }

  // ── références mortes et opérateurs hors langage ──────────────────────────
  for (const m of eng.modes) {
    const known = new Set<string>([...m.inputs.map(f => f.id), ...(m.derive ?? []).map(d => d.id)])
    const declaredCols = new Set((m.collections ?? []).map(c => c.id))
    const deriveTargets = new Set((m.derive ?? []).map(d => `derive:${d.id}`))
    const usedCols = new Set<string>()
    const check = (n: Node, where: string) => walk(n, x => {
      const op = (x as any).op
      if (!(FORMULA_PRIMITIVES as readonly string[]).includes(op))
        err('EC-01', `opérateur hors langage « ${op} » en ${where}`)
      if (op === 'ref') {
        const id = (x as any).id as string
        if (!BOUND.has(id) && !CORE_METRICS.has(id) && !known.has(id))
          err('EC-03', `référence morte « ${id} » en ${where} (mode ${m.id})`)
      }
      if (op === 'sumOver' || op === 'count' || op === 'countDistinct') {
        const id = (x as any).collection as string
        usedCols.add(id)
        if (!declaredCols.has(id))
          err('EC-03', `collection « ${id} » employée en ${where} (mode ${m.id}) sans être déclarée — la saisie ne saurait pas quoi demander`)
      }
    })
    for (const d of m.derive ?? []) check(d.value, `dérivation ${d.id}`)
    for (const c of eng.contributions) {
      if (c.when) check(c.when, `condition de ${c.code}`)
      check(c.value, `valeur de ${c.code}`)
    }
    for (const e of eng.endConditions ?? []) check(e.when, `fin ${e.code}`)
    for (const n of eng.notices ?? []) check(n.when, `avis ${n.code}`)

    // ── EC-03 · une collection déclarée justifie son existence et décrit sa saisie ──
    for (const c of m.collections ?? []) {
      if (!usedCols.has(c.id))
        err('EC-03', `collection « ${c.id} » déclarée mais consommée par aucune formule (mode ${m.id})`)
      if (!c.usedBy)
        err('EC-03', `collection « ${c.id} » sans usedBy — refusée`)
      if (c.kind === 'keyedCounts' && !(c.keys ?? []).length && !c.keyRange)
        err('EC-03', `collection « ${c.id} » en keyedCounts sans clés ni intervalle : rien à afficher`)
      if (c.keys && c.keyRange)
        err('EC-03', `collection « ${c.id} » déclare à la fois des clés et un intervalle : une seule forme`)
      if (c.keyRange && c.keyRange.to === null && c.keyRange.suggest === undefined)
        warn('EC-06', `collection « ${c.id} » sans plafond ni valeur suggérée : l'écran n'aura aucune borne d'affichage`)
      if (c.kind === 'valueList' && !(c.values ?? []).length && c.min === undefined)
        err('EC-03', `collection « ${c.id} » en valueList sans ensemble fermé ni borne basse : saisie non contrainte`)
      if (c.usedBy && !targets.has(c.usedBy) && !deriveTargets.has(c.usedBy))
        err('EC-03', `collection « ${c.id} » : usedBy « ${c.usedBy} » ne désigne rien d'existant`)
    }
  }

  // ── EF-051 · la guidée produit les entrées de l'express ───────────────────
  if (guided && express) {
    if (guided.derivesInputsOf !== 'express')
      err('EF-051', 'le mode guidé ne déclare pas derivesInputsOf: "express"')
    const produced = new Set([...guided.inputs.map(f => f.id), ...(guided.derive ?? []).map(d => d.id)])
    for (const f of express.inputs)
      if (!produced.has(f.id))
        err('EF-051', `la saisie guidée ne produit pas « ${f.id} », attendu par l'express`)
  }

  // ── les critères de classement doivent résoudre ───────────────────────────
  const producible = new Set<string>([
    ...CORE_METRICS,
    ...eng.modes.flatMap(m => [...m.inputs.map(f => f.id), ...(m.derive ?? []).map(d => d.id)]),
    ...eng.contributions.map(c => c.code)
  ])
  for (const c of [...eng.ranking.criteria, ...(eng.tieBreakers ?? [])])
    if (c.acquire !== 'onDemand' && !producible.has(c.metric))
      err('EF-110', `critère de classement « ${c.metric} » ne correspond à aucune métrique produite`)

  // ── matériel fini : une limite doit désigner quelque chose et citer sa source ──
  for (const sc of eng.scarcity ?? []) {
    const field = eng.modes.flatMap(m => m.inputs).find(f => f.id === sc.target)
    const col = eng.modes.flatMap(m => m.collections ?? []).find(c => c.id === sc.target)

    if (!sc.message) err('EC-03', `limite de matériel « ${sc.id} » sans message affichable`)
    if (!sc.usedBy || (!targets.has(sc.usedBy) && !allDeriveTargets.has(sc.usedBy)))
      err('EC-03', `limite de matériel « ${sc.id} » : usedBy « ${sc.usedBy} » ne désigne rien d'existant`)
    if (sc.source === undefined || sc.source === null)
      warn('EC-05', `limite de matériel « ${sc.id} » sans source citée : une quantité affirmée sans livret est une invention`)

    if (sc.kind === 'holders' || sc.kind === 'supply') {
      if (!field) { err('EC-03', `limite « ${sc.id} » : le champ « ${sc.target} » n'existe dans aucun mode`); continue }
      if (sc.kind === 'holders' && field.type !== 'BOOLEAN')
        err('EC-03', `limite « ${sc.id} » compte des détenteurs d'un champ ${field.type} : un booléen est attendu`)
      if (sc.kind === 'supply' && field.type !== 'INTEGER')
        err('EC-03', `limite « ${sc.id} » somme un champ ${field.type} : un entier est attendu`)
      if (!field.scope.startsWith('PARTICIPANT'))
        err('EC-03', `limite « ${sc.id} » porte sur un champ de portée ${field.scope} : le matériel se répartit entre participants`)
      if (sc.limit === undefined)
        err('EC-03', `limite « ${sc.id} » sans plafond déclaré`)
    } else {
      if (!col) { err('EC-03', `limite « ${sc.id} » : la collection « ${sc.target} » n'est déclarée dans aucun mode`); continue }
      if (col.kind !== 'valueList')
        err('EC-03', `limite « ${sc.id} » compte des exemplaires dans une collection ${col.kind} : valueList attendue`)
      if (!sc.byValue || !Object.keys(sc.byValue).length)
        err('EC-03', `limite « ${sc.id} » sans nombre d'exemplaires par valeur`)
      for (const [k, n] of Object.entries(sc.byValue ?? {})) {
        if (!Number.isInteger(Number(k))) err('EC-03', `limite « ${sc.id} » : clé « ${k} » non entière`)
        if (!Number.isInteger(n) || n < 1) err('EC-03', `limite « ${sc.id} » : ${n} exemplaires de « ${k} »`)
        if (col.values && !col.values.includes(Number(k)))
          err('EC-03', `limite « ${sc.id} » : la valeur ${k} n'appartient pas à l'ensemble déclaré de « ${col.id} »`)
      }
    }
  }

  // ── EC-09 · parties de référence ──────────────────────────────────────────
  if ((b.fixtures ?? []).length < 3)
    err('EC-09', `${(b.fixtures ?? []).length} partie(s) de référence — trois au minimum`)

  // ── EF-116 · l'égalité résiduelle doit avoir une issue déclarée ───────────
  if (!eng.ranking.remainingTie)
    err('EF-116', 'ranking.remainingTie non déclaré : le comportement à égalité épuisée serait indéfini')

  // ── ui · cohérence de la forme de saisie ──────────────────────────────────
  const perPlayer = express?.inputs.filter(f => f.scope.startsWith('PARTICIPANT')).length ?? 0
  if (b.ui?.layout === 'playerGrid' && perPlayer > 5)
    warn('EF-063', `grille tous joueurs avec ${perPlayer} champs par joueur : illisible sur petit écran`)

  return out
}

export const isPublishable = (issues: Issue[]) => !issues.some(i => i.severity === 'error')
