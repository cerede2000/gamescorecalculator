// P0 — le juge. Condition de sortie : les moteurs passent ET aucune primitive
// hors CORE_PRIMITIVES n'a été nécessaire. Le verdict est mécanique, pas déclaratif.

import { rank } from './src/rank.ts'
import { ALL, CORE_PRIMITIVES, askLog, I, D, R } from './src/engines.ts'
import { add, sub, mul, div, sum, abs, cmp, canonical, parse, fromRat, toRat } from './src/numeric.ts'
import { runReal } from './src/real.ts'

let pass = 0, fail = 0
const failures: string[] = []
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else { fail++; failures.push(label); console.log(`  \x1b[31m✗\x1b[0m ${label} ${detail}`) }
}

console.log('\n\x1b[1mP0 — validation du noyau de calcul\x1b[0m')

// ── 1. arithmétique exacte ──────────────────────────────────────────────────
console.log('\n\x1b[1m1. Arithmétique exacte\x1b[0m')
const c = canonical
ok('0,1 + 0,2 = 0,3 exactement', c(add(D('0.1',1), D('0.2',1))) === c(D('0.3',1)))
ok('1,5 + 0,25 = 1,75 (échelles différentes)', c(add(D('1.5',1), D('0.25',2))) === c(D('1.75',2)))
ok('8,0 + (−2,5) = 5,5 (pénalité en ADD négatif)', c(add(D('8.0',1), D('-2.5',1))) === c(D('5.5',1)))
ok('passage de positif à négatif : 2 + (−6) = −4', c(add(I(2), I(-6))) === c(I(-4)))
ok('½ + ½ + 1 = 2 (rationnel normalisé)', c(sum([R(1,2), R(1,2), R(1,1)])) === c(R(2,1)))
ok('⅓ × 3 = 1 exact', c(mul(R(1,3), I(3))) === c(R(1,1)))
ok('1 ÷ 3 reste rationnel exact', c(div(I(1), I(3))) === c(R(1,3)))
ok('|−0,25| = 0,25', c(abs(D('-0.25',2))) === c(D('0.25',2)))
ok('5/2 < 3', cmp(R(5,2), R(3,1))! < 0)
ok('multiplication d\'échelles : 1,5 × 0,25 = 0,375', c(mul(D('1.5',1), D('0.25',2))) === c(D('0.375',3)))

// ── 2. le MOMENT de l'arrondi change le résultat ────────────────────────────
console.log('\n\x1b[1m2. Arrondi : le moment compte\x1b[0m')
const tiers = [R(1,3), R(1,3), R(1,3)]
const parContribution = sum(tiers.map(t => div(t, I(1), { scale: 2, rounding: 'HALF_UP' })))
const auTotal = div(sum(tiers), I(1), { scale: 2, rounding: 'HALF_UP' })
ok('arrondi par contribution : 0,33 × 3 = 0,99', c(parContribution) === c(D('0.99',2)), c(parContribution))
ok('arrondi au total : 1,00', c(auTotal) === c(D('1.00',2)), c(auTotal))
ok('les deux diffèrent — roundAt doit être déclaré', c(parContribution) !== c(auTotal))

// ── 3. l'inconnu n'est jamais zéro ──────────────────────────────────────────
console.log('\n\x1b[1m3. Propagation de l\'inconnu (RG-12)\x1b[0m')
ok('inconnu + 5 = inconnu', add(null, I(5)) === null)
ok('inconnu × 0 = inconnu (et non 0)', mul(null, I(0)) === null)
ok('somme contenant un inconnu = inconnu', sum([I(3), null, I(4)]) === null)
ok('comparer avec un inconnu = indécidable', cmp(null, I(1)) === null)

// ── 4. sérialisation sans perte sur les huit domaines ───────────────────────
console.log('\n\x1b[1m4. Aller-retour de sérialisation\x1b[0m')
const echantillons = [
  I(-42), D('-12.75', 2), R(1,2),
  { type:'DURATION', value:'4355000' } as const,
  { type:'ORDINAL', value:'3' } as const,
  { type:'BOOLEAN', value:'true' } as const,
  { type:'ENUM', scale:'medal', value:'gold' } as const,
  { type:'VECTOR', items:[I(1), D('0.5',1)] } as const,
]
for (const v of echantillons)
  ok(`aller-retour exact : ${v.type}`, c(parse(c(v))) === c(v))
ok('aller-retour de null', parse(c(null)) === null)

// ── 5. les huit moteurs ─────────────────────────────────────────────────────
console.log('\n\x1b[1m5. Moteurs de validation\x1b[0m')
const primitivesHorsNoyau = new Set<string>()

for (const e of ALL) {
  for (const u of e.uses) if (!(CORE_PRIMITIVES as readonly string[]).includes(u)) primitivesHorsNoyau.add(u)
  let r
  try { r = rank(e.entrants, e.spec, { provider: e.provider, scales: e.scales }) }
  catch (err) { ok(`${e.id} — ${e.proves}`, false, String(err)); continue }

  const got = Object.fromEntries(r.standings.map(s => [s.id, s.rank]))
  const rangsOk = Object.entries(e.expect.ranks).every(([id, rk]) => got[id] === rk)
  ok(`${e.id} — ${e.proves}`, rangsOk, `attendu ${JSON.stringify(e.expect.ranks)} obtenu ${JSON.stringify(got)}`)

  if (e.expect.shared)
    ok(`  └ rang partagé déclaré : ${e.expect.shared.join(' et ')}`,
       e.expect.shared.every(id => r.standings.find(s => s.id === id)?.shared === true))
  if (e.expect.questions !== undefined)
    ok(`  └ ${e.expect.questions} questions posées, pas ${e.entrants.length * 4}`,
       r.questionsAsked === e.expect.questions, `obtenu ${r.questionsAsked}`)
}

// ── 6. le départage progressif tient ses promesses ──────────────────────────
console.log('\n\x1b[1m6. Départage progressif (EF-113, EF-114)\x1b[0m')
const gurneyInterroge = askLog.some(a => a.ids.includes('gurney'))
ok('aucune question au joueur hors course (gurney)', !gurneyInterroge)
ok('l\'épice est demandée à 3 candidats', askLog.find(a => a.metric === 'spice')?.ids.length === 3)
ok('le solari est demandé à 2 candidats seulement', askLog.find(a => a.metric === 'solari')?.ids.length === 2)
ok('« troops » n\'est jamais demandé — chaîne résolue avant', !askLog.some(a => a.metric === 'troops'))
const dune = rank(ALL[7].entrants, ALL[7].spec, { provider: ALL[7].provider })
ok('le critère qui a tranché est conservé',
   dune.standings.find(s => s.id === 'duncan')?.resolvedBy === 'water',
   String(dune.standings.find(s => s.id === 'duncan')?.resolvedBy))
ok('« troops » figure comme critère non atteint',
   dune.chain.find(s => s.metric === 'troops')?.skipped === true)

// ── 6bis. les exemples documentés des quatre vrais jeux ─────────────────────
console.log('\n\x1b[1m6bis. Exemples documentés des vrais jeux\x1b[0m')
runReal(ok)

// ── 7. déterminisme ─────────────────────────────────────────────────────────
console.log('\n\x1b[1m7. Déterminisme (RG-07)\x1b[0m')
const a1 = JSON.stringify(rank(ALL[0].entrants, ALL[0].spec).standings)
const a2 = JSON.stringify(rank([...ALL[0].entrants].reverse(), ALL[0].spec).standings)
ok('l\'ordre de saisie ne change pas le classement',
   JSON.stringify(JSON.parse(a1).sort((x:any,y:any)=>x.id<y.id?-1:1)) ===
   JSON.stringify(JSON.parse(a2).sort((x:any,y:any)=>x.id<y.id?-1:1)))

// ── 8. comparaisons illégales détectées ─────────────────────────────────────
console.log('\n\x1b[1m8. Comparaisons illégales\x1b[0m')
const leve = (f: () => unknown) => { try { f(); return false } catch { return true } }
ok('DURATION vs INTEGER refusé', leve(() => cmp({type:'DURATION',value:'1000'}, I(1000))))
ok('BOOLEAN vs INTEGER refusé', leve(() => cmp({type:'BOOLEAN',value:'true'}, I(1))))
ok('ENUM sans échelle refusé', leve(() => cmp({type:'ENUM',scale:'x',value:'a'}, {type:'ENUM',scale:'x',value:'b'})))
ok('DECIMAL non exact sans arrondi refusé', leve(() => fromRat(toRat(R(1,3)), 'DECIMAL', 2)))
ok('division par zéro refusée', leve(() => div(I(1), I(0))))
ok('1 ÷ 3 arrondi déclaré = 0,33', c(div(I(1), I(3), { scale: 2, rounding: 'HALF_UP' })) === c(D('0.33',2)))

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(64))
console.log(`\x1b[1mVerdict P0\x1b[0m   ${pass} réussis · ${fail} échoués`)
console.log(`Primitives du noyau utilisées : ${CORE_PRIMITIVES.length} déclarées`)
if (primitivesHorsNoyau.size === 0)
  console.log('\x1b[32mAucune primitive ajoutée au noyau.\x1b[0m Les huit moteurs s\'expriment avec la liste figée.')
else
  console.log(`\x1b[31mPrimitives hors noyau exigées : ${[...primitivesHorsNoyau].join(', ')}\x1b[0m`)
console.log('─'.repeat(64))
if (fail > 0) { console.log('\nÉchecs :'); failures.forEach(f => console.log('  · ' + f)) }
process.exit(fail === 0 && primitivesHorsNoyau.size === 0 ? 0 : 1)
