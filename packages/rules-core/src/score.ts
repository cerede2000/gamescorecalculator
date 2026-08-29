// P0b — moteur de score. Chaque contribution produit une LIGNE explicable.
// Invariant RG-05 : la somme des lignes est exactement le total.

import { add, type Maybe, type NumericValue, canonical } from './numeric.ts'
import { evaluate, usedOps, type Node, type Env, type Item } from './formula.ts'

export type Contribution = {
  code: string
  label: string
  when?: Node
  value: Node
  /** si vraie et satisfaite, toutes les autres contributions sont écartées */
  exclusive?: boolean
}
export type Derivation = { id: string; value: Node }

export type ScoringSpec = {
  derive?: Derivation[]
  contributions: Contribution[]
}

export type Line = { code: string; label: string; formula: string; value: Maybe }
export type Report = {
  lines: Line[]
  total: Maybe
  excluded?: string
  /** Les valeurs intermédiaires, déjà calculées : les exposer évite de les recalculer
   *  ailleurs avec un environnement légèrement différent. */
  derived: Record<string, Maybe>
}

export type Inputs = {
  values?: Record<string, Maybe>
  collections?: Record<string, Item[]>
}

export function score(spec: ScoringSpec, inputs: Inputs): Report {
  const env: Env = {
    inputs: inputs.values ?? {},
    derived: {},
    collections: inputs.collections ?? {}
  }

  // 1. dérivations, dans l'ordre déclaré
  for (const d of spec.derive ?? []) env.derived[d.id] = evaluate(d.value, env).value

  // 2. une contribution exclusive satisfaite écarte tout le reste
  for (const c of spec.contributions) {
    if (!c.exclusive) continue
    const cond = c.when ? evaluate(c.when, env).value : null
    if (cond !== null && cond.type === 'BOOLEAN' && cond.value === 'true') {
      const t = evaluate(c.value, env)
      return {
        lines: [{ code: c.code, label: c.label, formula: t.text, value: t.value }],
        total: t.value,
        excluded: `contributions écartées par ${c.code}`,
        derived: env.derived
      }
    }
  }

  // 3. contributions ordinaires
  const lines: Line[] = []
  for (const c of spec.contributions) {
    if (c.exclusive) continue
    if (c.when) {
      const cond = evaluate(c.when, env).value
      if (cond === null || cond.type !== 'BOOLEAN' || cond.value !== 'true') continue
    }
    const t = evaluate(c.value, env)
    lines.push({ code: c.code, label: c.label, formula: t.text, value: t.value })
  }

  // 4. total = somme exacte des lignes (RG-05)
  let total: Maybe = lines.length ? lines[0].value : ({ type: 'INTEGER', value: '0' } as NumericValue)
  for (let i = 1; i < lines.length; i++) total = add(total, lines[i].value)

  return { lines, total, derived: env.derived }
}

/** Vérifie RG-05 sur un rapport : somme des lignes === total. */
export function sumMatchesTotal(r: Report): boolean {
  let s: Maybe = r.lines.length ? r.lines[0].value : ({ type: 'INTEGER', value: '0' } as NumericValue)
  for (let i = 1; i < r.lines.length; i++) s = add(s, r.lines[i].value)
  return canonical(s) === canonical(r.total)
}

/** Primitives réellement employées par une spécification de score. */
export function opsOf(spec: ScoringSpec): Set<string> {
  const acc = new Set<string>()
  for (const d of spec.derive ?? []) usedOps(d.value, acc)
  for (const c of spec.contributions) {
    if (c.when) usedOps(c.when, acc)
    usedOps(c.value, acc)
  }
  return acc
}

/** Comparaison stricte de deux rapports : mêmes lignes, mêmes formules, même total. */
export function sameReport(a: Report, b: Report): boolean {
  if (canonical(a.total) !== canonical(b.total)) return false
  if (a.lines.length !== b.lines.length) return false
  return a.lines.every((l, i) =>
    l.code === b.lines[i].code &&
    l.formula === b.lines[i].formula &&
    canonical(l.value) === canonical(b.lines[i].value))
}
