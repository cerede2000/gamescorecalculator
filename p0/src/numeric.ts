// P0 — noyau numérique exact. Aucune E/S, aucune horloge, aucun aléa.
// Règle absolue : aucun flottant binaire dans un calcul métier.

export type Domain =
  | 'INTEGER' | 'DECIMAL' | 'RATIONAL' | 'DURATION'
  | 'ORDINAL' | 'BOOLEAN' | 'ENUM' | 'VECTOR'

export type NumericValue =
  | { type: 'INTEGER';  value: string }
  | { type: 'DECIMAL';  value: string; scale: number }
  | { type: 'RATIONAL'; numerator: string; denominator: string; display?: string }
  | { type: 'DURATION'; value: string; display?: string }
  | { type: 'ORDINAL';  value: string }
  | { type: 'BOOLEAN';  value: string }
  | { type: 'ENUM';     scale: string; value: string }
  | { type: 'VECTOR';   items: NumericValue[] }

/** null signifie INCONNU. Ce n'est jamais zéro. */
export type Maybe = NumericValue | null

export type Rounding = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNC'

// ── rationnels exacts sur BigInt ────────────────────────────────────────────
type Rat = { n: bigint; d: bigint }

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b
  while (b) { const t = a % b; a = b; b = t }
  return a
}
function norm(r: Rat): Rat {
  if (r.d === 0n) throw new Error('dénominateur nul')
  let { n, d } = r
  if (d < 0n) { n = -n; d = -d }
  const g = gcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}
function decToRat(s: string): Rat {
  const neg = s.startsWith('-')
  const t = neg ? s.slice(1) : s
  const [i, f = ''] = t.split('.')
  const n = BigInt((i || '0') + f) * (neg ? -1n : 1n)
  return norm({ n, d: 10n ** BigInt(f.length) })
}
function decStr(k: bigint, scale: number): string {
  const neg = k < 0n
  const a = (neg ? -k : k).toString().padStart(scale + 1, '0')
  const i = a.slice(0, a.length - scale)
  const f = scale > 0 ? '.' + a.slice(a.length - scale) : ''
  return (neg ? '-' : '') + i + f
}
function divRound(a: bigint, b: bigint, mode: Rounding): bigint {
  const q = a / b, rem = a % b
  if (rem === 0n) return q
  const twice = (rem < 0n ? -rem : rem) * 2n
  const away = a < 0n ? q - 1n : q + 1n
  switch (mode) {
    case 'TRUNC': return q
    case 'FLOOR': return a < 0n ? q - 1n : q
    case 'CEIL':  return a > 0n ? q + 1n : q
    case 'HALF_EVEN':
      if (twice > b) return away
      if (twice < b) return q
      return q % 2n === 0n ? q : away
    default:
      return twice >= b ? away : q
  }
}

// ── conversion valeur ↔ rationnel ───────────────────────────────────────────
const NUMERIC: Domain[] = ['INTEGER', 'DECIMAL', 'RATIONAL', 'DURATION', 'ORDINAL']

export function isNumeric(v: NumericValue): boolean { return NUMERIC.includes(v.type) }

export function toRat(v: NumericValue): Rat {
  switch (v.type) {
    case 'INTEGER':  return { n: BigInt(v.value), d: 1n }
    case 'DURATION': return { n: BigInt(v.value), d: 1n }
    case 'ORDINAL':  return { n: BigInt(v.value), d: 1n }
    case 'DECIMAL':  return decToRat(v.value)
    case 'RATIONAL': return norm({ n: BigInt(v.numerator), d: BigInt(v.denominator) })
    default: throw new Error(`domaine non numérique : ${v.type}`)
  }
}

/** Domaine de sortie d'une opération binaire. Promotion sans perte. */
function promote(a: Domain, b: Domain): Domain {
  if (a === b) return a
  const rank: Record<string, number> = { INTEGER: 1, DURATION: 1, ORDINAL: 1, DECIMAL: 2, RATIONAL: 3 }
  if (!(a in rank) || !(b in rank)) throw new Error(`comparaison illégale ${a} / ${b}`)
  if ((a === 'DURATION') !== (b === 'DURATION')) throw new Error(`mélange DURATION avec ${a === 'DURATION' ? b : a}`)
  return rank[a] >= rank[b] ? a : b
}
function scaleOf(v: NumericValue): number { return v.type === 'DECIMAL' ? v.scale : 0 }

export function fromRat(r: Rat, dom: Domain, scale = 0, mode: Rounding = 'HALF_UP'): NumericValue {
  const x = norm(r)
  switch (dom) {
    case 'INTEGER': case 'DURATION': case 'ORDINAL': {
      if (x.d !== 1n) throw new Error(`${dom} non entier — un arrondi doit être déclaré`)
      return dom === 'INTEGER' ? { type: 'INTEGER', value: x.n.toString() }
           : dom === 'DURATION' ? { type: 'DURATION', value: x.n.toString(), display: hms(x.n) }
           : { type: 'ORDINAL', value: x.n.toString() }
    }
    case 'DECIMAL': {
      const k = x.n * 10n ** BigInt(scale)
      if (k % x.d !== 0n) throw new Error('DECIMAL non exact — un arrondi doit être déclaré')
      return { type: 'DECIMAL', value: decStr(k / x.d, scale), scale }
    }
    case 'RATIONAL':
      return { type: 'RATIONAL', numerator: x.n.toString(), denominator: x.d.toString(), display: ratDisplay(x) }
    default: throw new Error(`fromRat: ${dom}`)
  }
}
function ratDisplay(x: Rat): string {
  if (x.d === 1n) return x.n.toString()
  const half = x.d === 2n && (x.n === 1n || x.n === -1n)
  return half ? (x.n < 0n ? '-½' : '½') : `${x.n}/${x.d}`
}
function hms(ms: bigint): string {
  const s = ms / 1000n
  const p = (n: bigint) => n.toString().padStart(2, '0')
  return `${p(s / 3600n)}:${p((s / 60n) % 60n)}:${p(s % 60n)}`
}

// ── opérations. Toute opération sur un INCONNU rend INCONNU. ────────────────
type Bin = (a: Rat, b: Rat) => Rat
const rAdd: Bin = (a, b) => norm({ n: a.n * b.d + b.n * a.d, d: a.d * b.d })
const rSub: Bin = (a, b) => norm({ n: a.n * b.d - b.n * a.d, d: a.d * b.d })
const rMul: Bin = (a, b) => norm({ n: a.n * b.n, d: a.d * b.d })

function binary(op: Bin, a: Maybe, b: Maybe, scaleRule: (x: number, y: number) => number): Maybe {
  if (a === null || b === null) return null              // RG-12 : propagation
  const dom = promote(a.type as Domain, b.type as Domain)
  const sc = scaleRule(scaleOf(a), scaleOf(b))
  return fromRat(op(toRat(a), toRat(b)), dom === 'ORDINAL' ? 'INTEGER' : dom, sc)
}

export const add = (a: Maybe, b: Maybe): Maybe => binary(rAdd, a, b, Math.max)
export const sub = (a: Maybe, b: Maybe): Maybe => binary(rSub, a, b, Math.max)
export const mul = (a: Maybe, b: Maybe): Maybe => binary(rMul, a, b, (x, y) => x + y)

/** DIVIDE n'est pas close sur DECIMAL : soit promotion en RATIONAL, soit arrondi déclaré. */
export function div(a: Maybe, b: Maybe, opts?: { scale: number; rounding: Rounding }): Maybe {
  if (a === null || b === null) return null
  const ra = toRat(a), rb = toRat(b)
  if (rb.n === 0n) throw new Error('division par zéro')
  const q = norm({ n: ra.n * rb.d, d: ra.d * rb.n })
  if (!opts) return fromRat(q, 'RATIONAL')                       // exact, arrondi différé
  const k = divRound(q.n * 10n ** BigInt(opts.scale), q.d, opts.rounding)
  return { type: 'DECIMAL', value: decStr(k, opts.scale), scale: opts.scale }
}

export function abs(a: Maybe): Maybe {
  if (a === null) return null
  const r = toRat(a); const dom = a.type as Domain
  return fromRat({ n: r.n < 0n ? -r.n : r.n, d: r.d }, dom === 'ORDINAL' ? 'INTEGER' : dom, scaleOf(a))
}
export function sum(xs: Maybe[]): Maybe {
  if (xs.length === 0) return { type: 'INTEGER', value: '0' }
  return xs.reduce((acc, x) => add(acc, x), xs[0] === null ? null : zeroLike(xs[0]))
}
function zeroLike(v: NumericValue): NumericValue {
  return v.type === 'DECIMAL' ? { type: 'DECIMAL', value: decStr(0n, v.scale), scale: v.scale }
       : v.type === 'RATIONAL' ? { type: 'RATIONAL', numerator: '0', denominator: '1', display: '0' }
       : { type: 'INTEGER', value: '0' }
}
export const minOf = (xs: Maybe[]): Maybe => pick(xs, -1)
export const maxOf = (xs: Maybe[]): Maybe => pick(xs, 1)
function pick(xs: Maybe[], dir: number): Maybe {
  let best: Maybe = null
  for (const x of xs) {
    if (x === null) return null
    if (best === null) { best = x; continue }
    if (cmp(x, best)! * dir > 0) best = x
  }
  return best
}

// ── comparaison ─────────────────────────────────────────────────────────────
export type EnumScales = Record<string, string[]>

export function cmp(a: Maybe, b: Maybe, scales: EnumScales = {}): number | null {
  if (a === null || b === null) return null
  if (a.type === 'BOOLEAN' || b.type === 'BOOLEAN') {
    if (a.type !== b.type) throw new Error('comparaison illégale BOOLEAN / autre')
    const x = a.value === 'true' ? 1 : 0, y = (b as any).value === 'true' ? 1 : 0
    return x === y ? 0 : x < y ? -1 : 1
  }
  if (a.type === 'ENUM' || b.type === 'ENUM') {
    if (a.type !== b.type || a.scale !== (b as any).scale) throw new Error('comparaison illégale ENUM')
    const order = scales[a.scale]
    if (!order) throw new Error(`échelle ENUM inconnue : ${a.scale}`)
    const x = order.indexOf(a.value), y = order.indexOf((b as any).value)
    if (x < 0 || y < 0) throw new Error('valeur hors échelle')
    return x === y ? 0 : x < y ? -1 : 1
  }
  if (a.type === 'VECTOR' || b.type === 'VECTOR') {
    if (a.type !== b.type) throw new Error('comparaison illégale VECTOR / autre')
    const A = a.items, B = (b as any).items as NumericValue[]
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (A[i] === undefined) return -1
      if (B[i] === undefined) return 1
      const c = cmp(A[i], B[i], scales)
      if (c === null) return null
      if (c !== 0) return c
    }
    return 0
  }
  promote(a.type as Domain, b.type as Domain)   // lève si illégal
  const ra = toRat(a), rb = toRat(b)
  const l = ra.n * rb.d, r = rb.n * ra.d
  return l === r ? 0 : l < r ? -1 : 1
}

// ── sérialisation canonique ─────────────────────────────────────────────────
export function canonical(v: Maybe): string {
  if (v === null) return 'null'
  const keys = Object.keys(v).filter(k => k !== 'display').sort()
  return JSON.stringify(Object.fromEntries(keys.map(k => [k, (v as any)[k]])))
}
export function parse(s: string): Maybe {
  return s === 'null' ? null : JSON.parse(s) as NumericValue
}
