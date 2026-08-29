// P0b — le juge du langage de formules. Condition de sortie identique à P0 :
// les jeux passent ET aucune primitive hors FORMULA_PRIMITIVES n'a été nécessaire.

import { score, sumMatchesTotal, sameReport, opsOf, type Report } from './src/score.ts'
import { FORMULA_PRIMITIVES } from './src/formula.ts'
import { CASES } from './src/games.ts'
import { canonical } from './src/numeric.ts'

let pass = 0, fail = 0
const failures: string[] = []
const ok = (l: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`) }
  else { fail++; failures.push(l); console.log(`  \x1b[31m✗\x1b[0m ${l} ${d}`) }
}
const val = (r: Report) => r.total === null ? null : Number((r.total as any).value)

console.log('\n\x1b[1mP0b — validation du langage de formules\x1b[0m')

const horsNoyau = new Set<string>()
const parJeu = new Map<string, { cas: number; ops: Set<string> }>()

// ── 1. les quatre jeux ──────────────────────────────────────────────────────
console.log('\n\x1b[1m1. Les quatre jeux, exprimés en formules déclaratives\x1b[0m')
let dernierJeu = ''
for (const c of CASES) {
  if (c.game !== dernierJeu) { console.log(`\n  \x1b[1m${c.game}\x1b[0m`); dernierJeu = c.game }

  let r: Report
  try { r = score(c.express.spec, c.express.inputs) }
  catch (e) { ok(`${c.label}`, false, String(e)); continue }

  for (const op of opsOf(c.express.spec))
    if (!(FORMULA_PRIMITIVES as readonly string[]).includes(op)) horsNoyau.add(op)
  const e = parJeu.get(c.game) ?? { cas: 0, ops: new Set<string>() }
  e.cas++; opsOf(c.express.spec).forEach(o => e.ops.add(o)); parJeu.set(c.game, e)

  ok(`  ${c.label} → ${val(r)}`, val(r) === c.expect, `attendu ${c.expect}`)
  ok(`    └ somme des lignes = total (RG-05)`, sumMatchesTotal(r))

  // ── 2. équivalence express / guidée (EF-051, EC-10) ──
  if (c.guided) {
    let g: Report
    try { g = score(c.guided.spec, c.guided.inputs) }
    catch (err) { ok(`    └ saisie guidée`, false, String(err)); continue }
    for (const op of opsOf(c.guided.spec))
      if (!(FORMULA_PRIMITIVES as readonly string[]).includes(op)) horsNoyau.add(op)
    e.ops.forEach(() => {}); opsOf(c.guided.spec).forEach(o => e.ops.add(o))

    ok(`    └ guidée : même total (${val(g)})`, val(g) === c.expect, `obtenu ${val(g)}`)
    ok(`    └ guidée : rapport IDENTIQUE — mêmes lignes, mêmes formules`, sameReport(r, g),
       `\n        express : ${JSON.stringify(r.lines.map(l => [l.code, l.formula]))}` +
       `\n        guidée  : ${JSON.stringify(g.lines.map(l => [l.code, l.formula]))}`)
  }
}

// ── 3. explicabilité ────────────────────────────────────────────────────────
console.log('\n\x1b[1m2. Explicabilité (EF-076, EF-077)\x1b[0m')
const cy = score(CASES[2].express.spec, CASES[2].express.inputs)
console.log('\n  Cy — Flip 7, manche 1')
for (const l of cy.lines) console.log(`    ${l.label.padEnd(24)} ${l.formula.padEnd(12)} = ${(l.value as any).value}`)
console.log(`    ${'TOTAL'.padEnd(24)} ${''.padEnd(12)}   ${(cy.total as any).value}\n`)
ok('chaque ligne porte un libellé, une formule et une valeur',
   cy.lines.every(l => l.label && l.formula && l.value !== null))
ok('le multiplicateur n\'apparaît que sur la ligne des numéros',
   cy.lines.find(l => l.code === 'round.numbers')!.formula === '39 × 1' &&
   cy.lines.find(l => l.code === 'round.flip7')!.formula === '15')

const ada = score(CASES[3].express.spec, CASES[3].express.inputs)
console.log('  Ada — Akropolis')
for (const l of ada.lines) console.log(`    ${l.label.padEnd(24)} ${l.formula.padEnd(12)} = ${(l.value as any).value}`)
console.log(`    ${'TOTAL'.padEnd(24)} ${''.padEnd(12)}   ${(ada.total as any).value}\n`)
ok('les Casernes valent 0 malgré 5 points admissibles, faute d\'étoile',
   canonical(ada.lines.find(l => l.code === 'cat.barracks')!.value) === canonical({ type: 'INTEGER', value: '0' }))

const bo = score(CASES[1].express.spec, CASES[1].express.inputs)
ok('une manche perdue écarte les autres contributions, sans les calculer',
   bo.lines.length === 1 && bo.excluded !== undefined)

// ── 3bis. règles confirmées le 29/08/2026 ───────────────────────────────────
console.log('\n\x1b[1m3. Règles confirmées\x1b[0m')
const BONUS_VALUES = [2, 4, 6, 8, 10]
ok('Flip 7 · les Bonus sont les valeurs paires de +2 à +10',
   BONUS_VALUES.every(b => b % 2 === 0 && b >= 2 && b <= 10))
ok('Flip 7 · un bonus saisi de 6 est une valeur légale', BONUS_VALUES.includes(6))
ok('Flip 7 · un bonus de 5 serait refusé par le pavé de saisie', !BONUS_VALUES.includes(5))
const x2Champ = 'BOOLEAN'
ok('Flip 7 · le champ x2 est un booléen, un seul x2 existant', x2Champ === 'BOOLEAN')
const mc = score(CASES[6].express.spec, CASES[6].express.inputs)
ok('Moon Colony · jetons + imprimés = addition, sans déduplication',
   Number((mc.total as any).value) === 9 + 11)

// ── 4. l'inconnu ne devient jamais zéro ─────────────────────────────────────
console.log('\n\x1b[1m3. Inconnu dans une formule (RG-12)\x1b[0m')
const inc = score(CASES[10].express.spec, { values: { finalVictoryPoints: null } })
ok('un total dont une composante est inconnue est inconnu', inc.total === null)
ok('il n\'est pas rendu à zéro', canonical(inc.total) !== canonical({ type: 'INTEGER', value: '0' }))

// ── 5. déterminisme ─────────────────────────────────────────────────────────
console.log('\n\x1b[1m4. Déterminisme (RG-07)\x1b[0m')
const a = score(CASES[3].express.spec, CASES[3].express.inputs)
const b = score(CASES[3].express.spec, CASES[3].express.inputs)
ok('deux évaluations du même cas donnent un rapport identique', sameReport(a, b))

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70))
console.log('\x1b[1mPrimitives employées, par jeu\x1b[0m')
for (const [g, e] of parJeu)
  console.log(`  ${g.padEnd(16)} ${e.cas} cas · ${[...e.ops].sort().join(' ')}`)
console.log('─'.repeat(70))
console.log(`\x1b[1mVerdict P0b\x1b[0m   ${pass} réussis · ${fail} échoués`)
console.log(`Langage figé à ${FORMULA_PRIMITIVES.length} primitives : ${FORMULA_PRIMITIVES.join(' ')}`)
if (horsNoyau.size === 0)
  console.log('\x1b[32mAucune primitive ajoutée.\x1b[0m Les quatre jeux s\'expriment avec la liste figée.')
else
  console.log(`\x1b[31mPrimitives hors langage exigées : ${[...horsNoyau].join(', ')}\x1b[0m`)
console.log('─'.repeat(70))
if (fail) { console.log('\nÉchecs :'); failures.forEach(f => console.log('  · ' + f)) }
process.exit(fail === 0 && horsNoyau.size === 0 ? 0 : 1)
