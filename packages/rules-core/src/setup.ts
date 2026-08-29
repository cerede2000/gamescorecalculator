// L'assistant de mise en place, résolu pour une table donnée.
//
// Aucune instruction n'est écrite ici : ce module lit des étapes déclarées et
// calcule les quantités qui dépendent de la configuration.

import { evaluate } from './formula.ts'
import type { Maybe } from './numeric.ts'
import type { Bundle, SetupStep, SetupQuantity } from './bundle.ts'

export type ResolvedQuantity = {
  label: string
  unit?: string
  /** une quantité pour toute la table, ou null si elle n'a pas pu être calculée */
  value: number | null
  /** ou une quantité par siège, dans l'ordre du tour */
  bySeat?: number[]
}
export type ResolvedStep = {
  id: string
  title: string
  body?: string
  scope: 'TABLE' | 'PER_PLAYER'
  source?: string | null
  quantities: ResolvedQuantity[]
}
export type ResolvedSetup = {
  /** false quand aucune fiche n'existe, ou que la configuration n'est pas couverte */
  available: boolean
  notice: string | null
  steps: ResolvedStep[]
}

function env(playerCount: number, table: Record<string, Maybe>) {
  return {
    inputs: { ...table, playerCount: { type: 'INTEGER' as const, value: String(playerCount) } },
    derived: {} as Record<string, Maybe>,
    collections: {} as Record<string, { k: number; v: number }[]>
  }
}

function num(node: any, e: ReturnType<typeof env>): number | null {
  try {
    const v = evaluate(node, e).value
    return v === null || v.type !== 'INTEGER' ? null : Number(v.value)
  } catch { return null }
}

function holds(node: any, e: ReturnType<typeof env>): boolean {
  if (!node) return true
  try {
    const v = evaluate(node, e).value
    return v !== null && v.type === 'BOOLEAN' && v.value === 'true'
  } catch { return false }
}

function quantity(q: SetupQuantity, playerCount: number, e: ReturnType<typeof env>): ResolvedQuantity {
  if (q.bySeat) return { label: q.label, unit: q.unit, value: null, bySeat: q.bySeat.slice(0, playerCount) }
  if (q.valueExpr) return { label: q.label, unit: q.unit, value: num(q.valueExpr, e) }
  return { label: q.label, unit: q.unit, value: q.value ?? null }
}

export function resolveSetup(
  bundle: Bundle,
  playerCount: number,
  table: Record<string, Maybe> = {}
): ResolvedSetup {
  const sa = bundle.setupAssistant
  if (!sa || !sa.enabled)
    return { available: false, notice: sa?.missingNotice ?? null, steps: [] }

  const r = sa.playerCountRules
  if (r && (playerCount < r.min || (r.max !== null && playerCount > r.max)))
    return { available: false, notice: sa.outOfScopeNotice ?? null, steps: [] }

  const e = env(playerCount, table)
  const steps: ResolvedStep[] = []
  for (const st of sa.steps ?? []) {
    if (!holds(st.when, e)) continue
    steps.push({
      id: st.id, title: st.title, body: st.body, scope: st.scope, source: st.source ?? null,
      quantities: (st.quantities ?? []).map(q => quantity(q, playerCount, e))
    })
  }
  return { available: true, notice: null, steps }
}
