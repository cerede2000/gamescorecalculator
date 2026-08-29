// Quels champs sont encore PERTINENTS, compte tenu de ce qui est déjà saisi.
//
// Rien à déclarer : la réponse est déjà dans les données. Un champ dit quelle
// formule il sert (usedBy), et une formule dit quand elle s'applique (when).
// Il suffit de laisser cette information atteindre l'écran.

import { evaluate, type Node } from './formula.ts'
import type { Maybe } from './numeric.ts'
import type { Bundle, ScoringMode } from './bundle.ts'

export type Relevance = {
  /** false = le champ ne peut plus rien changer au décompte */
  enabled: Record<string, boolean>
  /** pourquoi, dit à l'utilisateur */
  because: Record<string, string>
}

export function refsOf(n: Node | undefined, acc = new Set<string>()): Set<string> {
  if (!n || typeof n !== 'object') return acc
  if ((n as any).op === 'ref') acc.add((n as any).id)
  for (const k of ['cond', 'then', 'else', 'each', 'input', 'left', 'right', 'arg'])
    if ((n as any)[k]) refsOf((n as any)[k], acc)
  for (const a of ((n as any).args ?? [])) refsOf(a, acc)
  return acc
}

/** true / false / null si la condition elle-même est encore inconnue. */
function holds(when: Node | undefined, env: any): boolean | null {
  if (!when) return true
  try {
    const v = evaluate(when, env).value
    if (v === null || v.type !== 'BOOLEAN') return null
    return v.value === 'true'
  } catch { return null }
}

export function relevance(
  bundle: Bundle,
  mode: ScoringMode,
  values: Record<string, Maybe>,
  collections: Record<string, { k: number; v: number }[]> = {}
): Relevance {
  const contributions = bundle.scoringEngine.contributions
  const env = {
    inputs: { ...Object.fromEntries(mode.inputs.map(f => [f.id, null as Maybe])), ...values },
    derived: {} as Record<string, Maybe>,
    collections: { ...Object.fromEntries((mode.collections ?? []).map(c => [c.id, [] as any[]])), ...collections }
  }
  for (const d of mode.derive ?? []) {
    try { env.derived[d.id] = evaluate(d.value, env).value } catch { env.derived[d.id] = null }
  }

  // une contribution exclusive satisfaite écarte toutes les autres
  const exclusive = contributions.find(c => c.exclusive && holds(c.when, env) === true)

  const enabled: Record<string, boolean> = {}
  const because: Record<string, string> = {}
  const codeOf = (usedBy?: string) => (usedBy?.startsWith('formula:') ? usedBy.slice(8) : null)

  // les champs qui pilotent la condition d'une AUTRE contribution, ou une
  // condition de fin de partie
  const endDrivers = new Set<string>()
  for (const e of bundle.scoringEngine.endConditions ?? []) refsOf(e.when, endDrivers)

  for (const f of mode.inputs) {
    const own = contributions.find(c => c.code === codeOf(f.usedBy))

    // 1. écarté par une exclusive : pas de piège, le pilote de l'exclusive
    //    reste saisissable et permet de tout rétablir
    if (exclusive && own && own.code !== exclusive.code) {
      enabled[f.id] = false; because[f.id] = exclusive.label; continue
    }
    // 2. un champ présent dans SA PROPRE condition se gouverne lui-même :
    //    le désactiver enfermerait l'utilisateur dans son dernier choix
    if (own && refsOf(own.when).has(f.id)) { enabled[f.id] = true; continue }
    // 3. un champ qui gouverne autre chose reste saisissable
    if (endDrivers.has(f.id) ||
        contributions.some(c => c.code !== own?.code && refsOf(c.when).has(f.id))) {
      enabled[f.id] = true; continue
    }
    // 4. sa formule ne s'applique pas : le champ ne peut plus rien changer
    if (own && holds(own.when, env) === false) {
      enabled[f.id] = false; because[f.id] = own.label; continue
    }
    enabled[f.id] = true
  }

  // une collection suit le sort de ce qu'elle alimente, avec les mêmes règles
  for (const c of mode.collections ?? []) {
    const derived = c.usedBy?.startsWith('derive:') ? c.usedBy.slice(7) : null
    const readers = derived
      ? contributions.filter(x => refsOf(x.value).has(derived) || refsOf(x.when).has(derived))
      : []
    if (!readers.length) { enabled[c.id] = true; continue }
    if (exclusive && !readers.some(x => x.code === exclusive.code)) {
      enabled[c.id] = false; because[c.id] = exclusive.label; continue
    }
    // auto-gouvernance : sa valeur dérivée conditionne son propre lecteur.
    // Sans cette règle, une collection vide se verrouillerait à vide —
    // « pas de bonus saisis, donc la ligne Bonus ne s'applique pas, donc
    // on ne peut pas saisir de bonus ».
    if (derived && readers.some(x => refsOf(x.when).has(derived))) { enabled[c.id] = true; continue }
    enabled[c.id] = readers.some(x => holds(x.when, env) !== false)
    if (!enabled[c.id]) because[c.id] = readers[0].label
  }

  return { enabled, because }
}
