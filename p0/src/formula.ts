// P0b — langage de formules déclaratif. Une expression est une DONNÉE, jamais du code.
// Total (termine sur toute entrée valide), pur, sans E/S, sans horloge, sans aléa.

import { add, sub, mul, div, cmp, type Maybe, type NumericValue, type EnumScales } from './numeric.ts'

/** Primitives du langage. Liste FIGÉE : un jeu qui en exige une autre fait échouer P0b. */
export const FORMULA_PRIMITIVES = [
  'lit', 'ref', 'if',
  'add', 'sub', 'mul', 'div',
  'sumOver', 'count', 'countDistinct', 'bracket',
  'eq', 'gt', 'gte', 'lt', 'lte',
  'and', 'or', 'not'
] as const
export type Op = typeof FORMULA_PRIMITIVES[number]

export type Node =
  | { op: 'lit'; value: NumericValue }
  | { op: 'ref'; id: string }
  | { op: 'if'; cond: Node; then: Node; else: Node }
  | { op: 'add' | 'sub' | 'mul'; args: Node[] }
  | { op: 'div'; args: [Node, Node]; scale?: number; rounding?: 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNC' }
  | { op: 'sumOver'; collection: string; each: Node }
  | { op: 'count' | 'countDistinct'; collection: string }
  | { op: 'bracket'; input: Node; table: { upTo?: number; from?: number; value: NumericValue }[] }
  | { op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; left: Node; right: Node }
  | { op: 'and' | 'or'; args: Node[] }
  | { op: 'not'; arg: Node }

export type Item = { k: number; v: number }
export type Env = {
  inputs: Record<string, Maybe>
  derived: Record<string, Maybe>
  collections: Record<string, Item[]>
  scales?: EnumScales
  bound?: { k: number; v: number }      // liaisons $k et $v dans sumOver
}

/** prec : priorité de l'expression, pour parenthéser le rendu quand il le faut.
 *  atomique 9 · × ÷ 3 · + − 2 · comparaisons 1 · et/ou 0 */
export type Trace = { value: Maybe; text: string; prec: number }

/** Parenthèse le texte d'un enfant moins prioritaire que son parent. */
function paren(child: Trace, parentPrec: number): string {
  return child.prec < parentPrec ? `(${child.text})` : child.text
}

const INT = (n: number | bigint): NumericValue => ({ type: 'INTEGER', value: String(n) })
const BOOL = (b: boolean): NumericValue => ({ type: 'BOOLEAN', value: String(b) })
const isTrue = (v: Maybe): boolean => v !== null && v.type === 'BOOLEAN' && v.value === 'true'
const show = (v: Maybe): string =>
  v === null ? '?' :
  v.type === 'DECIMAL' || v.type === 'INTEGER' || v.type === 'DURATION' || v.type === 'ORDINAL' ? v.value :
  v.type === 'RATIONAL' ? (v.display ?? `${v.numerator}/${v.denominator}`) :
  v.type === 'BOOLEAN' ? (v.value === 'true' ? 'oui' : 'non') :
  v.type === 'ENUM' ? v.value : '…'

/** Vérifie qu'une expression n'utilise que des primitives du noyau. Retourne les intrus. */
export function usedOps(n: Node, acc = new Set<string>()): Set<string> {
  acc.add((n as any).op)
  for (const key of ['cond', 'then', 'else', 'each', 'input', 'left', 'right', 'arg'])
    if ((n as any)[key]) usedOps((n as any)[key], acc)
  for (const a of ((n as any).args ?? [])) usedOps(a, acc)
  return acc
}

export function evaluate(n: Node, env: Env): Trace {
  switch (n.op) {
    case 'lit': return { value: n.value, text: show(n.value), prec: 9 }

    case 'ref': {
      if (n.id === '$k') return { value: INT(env.bound!.k), text: String(env.bound!.k), prec: 9 }
      if (n.id === '$v') return { value: INT(env.bound!.v), text: String(env.bound!.v), prec: 9 }
      const v = n.id in env.derived ? env.derived[n.id]
              : n.id in env.inputs  ? env.inputs[n.id]
              : undefined
      if (v === undefined) throw new Error(`référence inconnue : ${n.id}`)
      return { value: v, text: show(v), prec: 9 }
    }

    case 'if': {
      const c = evaluate(n.cond, env)
      if (c.value === null) return { value: null, text: '?', prec: 9 }
      return isTrue(c.value) ? evaluate(n.then, env) : evaluate(n.else, env)
    }

    case 'add': case 'sub': case 'mul': {
      const parts = n.args.map(a => evaluate(a, env))
      const sign = n.op === 'add' ? ' + ' : n.op === 'sub' ? ' − ' : ' × '
      const fn = n.op === 'add' ? add : n.op === 'sub' ? sub : mul
      const prec = n.op === 'mul' ? 3 : 2
      let acc = parts[0].value
      for (let i = 1; i < parts.length; i++) acc = fn(acc, parts[i].value)
      return { value: acc, text: parts.map(p => paren(p, prec)).join(sign), prec }
    }

    case 'div': {
      const [a, b] = n.args.map(x => evaluate(x, env))
      const opts = n.scale !== undefined ? { scale: n.scale, rounding: n.rounding ?? 'HALF_UP' as const } : undefined
      return { value: div(a.value, b.value, opts), text: `${paren(a,3)} ÷ ${paren(b,3)}`, prec: 3 }
    }

    case 'sumOver': {
      const items = env.collections[n.collection]
      if (!items) throw new Error(`collection inconnue : ${n.collection}`)
      if (items.length === 0) return { value: INT(0), text: '0', prec: 9 }
      const parts = items.map(it => evaluate(n.each, { ...env, bound: it }))
      let acc: Maybe = parts[0].value
      for (let i = 1; i < parts.length; i++) acc = add(acc, parts[i].value)
      return { value: acc, text: parts.map(p => paren(p, 2)).join(' + '), prec: 2 }
    }

    case 'count': {
      const items = env.collections[n.collection] ?? []
      return { value: INT(items.length), text: String(items.length), prec: 9 }
    }
    case 'countDistinct': {
      const items = env.collections[n.collection] ?? []
      const d = new Set(items.map(i => i.v)).size
      return { value: INT(d), text: String(d), prec: 9 }
    }

    case 'bracket': {
      const x = evaluate(n.input, env)
      if (x.value === null) return { value: null, text: '?', prec: 9 }
      for (const row of n.table) {
        const hitUpTo = row.upTo !== undefined && cmp(x.value, INT(row.upTo))! <= 0
        const hitFrom = row.from !== undefined && cmp(x.value, INT(row.from))! >= 0
        if (hitUpTo || hitFrom) return { value: row.value, text: `${x.text} → ${show(row.value)}`, prec: 9 }
      }
      return { value: null, text: `${x.text} → hors barème`, prec: 9 }
    }

    case 'eq': case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = evaluate(n.left, env), b = evaluate(n.right, env)
      const c = cmp(a.value, b.value, env.scales)
      if (c === null) return { value: null, text: '?', prec: 9 }
      const r = n.op === 'eq' ? c === 0 : n.op === 'gt' ? c > 0 : n.op === 'gte' ? c >= 0 : n.op === 'lt' ? c < 0 : c <= 0
      const sym = { eq: '=', gt: '>', gte: '≥', lt: '<', lte: '≤' }[n.op]
      return { value: BOOL(r), text: `${paren(a,1)} ${sym} ${paren(b,1)}`, prec: 1 }
    }

    case 'and': case 'or': {
      const parts = n.args.map(a => evaluate(a, env))
      if (parts.some(p => p.value === null)) return { value: null, text: '?', prec: 9 }
      const bools = parts.map(p => isTrue(p.value))
      const r = n.op === 'and' ? bools.every(Boolean) : bools.some(Boolean)
      return { value: BOOL(r), text: parts.map(p => paren(p, 0)).join(n.op === 'and' ? ' et ' : ' ou '), prec: 0 }
    }
    case 'not': {
      const a = evaluate(n.arg, env)
      if (a.value === null) return { value: null, text: '?', prec: 9 }
      return { value: BOOL(!isTrue(a.value)), text: `non ${paren(a, 1)}`, prec: 9 }
    }
  }
}
