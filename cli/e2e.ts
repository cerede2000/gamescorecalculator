// Rejoue les parties de référence À TRAVERS L'API HTTP.
// Le noyau était déjà tenu par cli/play.ts ; ceci tient le serveur :
// routes, portées de champs, concurrence, départage à la demande, persistance.

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8137 + Math.floor(process.uptime() * 0) // fixe : un seul processus à la fois
const BASE = `http://127.0.0.1:${PORT}`
const DB = join(tmpdir(), `tablee-e2e-${process.pid}.db`)
const g = (s: string) => `\x1b[32m${s}\x1b[0m`, r = (s: string) => `\x1b[31m${s}\x1b[0m`
const b = (s: string) => `\x1b[1m${s}\x1b[0m`, dim = (s: string) => `\x1b[2m${s}\x1b[0m`

let pass = 0, fail = 0
const ok = (l: string, c: boolean, d = '') => {
  c ? (pass++, console.log(`  ${g('✓')} ${l}`)) : (fail++, console.log(`  ${r('✗')} ${l} ${d}`))
}

const child = spawn(process.execPath,
  ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/main.ts'],
  { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', TABLEE_DB: DB }, stdio: 'ignore' })

const stop = () => { child.kill(); try { rmSync(DB, { force: true }); rmSync(DB + '-wal', { force: true }); rmSync(DB + '-shm', { force: true }) } catch {} }
process.on('exit', stop)

async function ready(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('le serveur ne répond pas')
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${j.error}`)
  return j
}

const N = (v: any) => v === null ? null : Number(v.value)

await ready()
console.log(b('\nTablée — parties de référence rejouées à travers l\'API HTTP\n'))

const health = await call('GET', '/api/health')
ok(`catalogue chargé : ${health.games} jeux, ${health.refused.length} écarté(s)`, health.games === 4 && health.refused.length === 0)

for (const file of readdirSync('fixtures').sort()) {
  const fx = JSON.parse(readFileSync(`fixtures/${file}`, 'utf8'))
  const bundle = JSON.parse(readFileSync(`games/${fx.game}.json`, 'utf8'))
  const mode = bundle.scoringEngine.modes.find((m: any) => m.id === fx.mode)
  const scopeOf = new Map<string, string>(mode.inputs.map((f: any) => [f.id, f.scope]))
  const table = (id: string) => scopeOf.get(id) === 'GAME' || scopeOf.get(id) === 'ROUND'

  console.log(b(fx.game) + dim(`  ${fx.label}`))

  let st = await call('POST', '/api/matches', {
    gameId: fx.game, mode: fx.mode, label: fx.label,
    players: fx.participants.map((p: any) => ({ id: p.id, name: p.name }))
  })

  for (let i = 0; i < fx.rounds.length; i++) {
    const inputs: Record<string, any> = { '@table': { values: {}, collections: {} } }
    for (const p of fx.participants) {
      const raw = fx.rounds[i][p.id]
      const vals = raw.values ?? (raw.collections ? {} : raw)
      inputs[p.id] = { values: {}, collections: raw.collections ?? {} }
      for (const [k, v] of Object.entries(vals))
        (table(k) ? inputs['@table'] : inputs[p.id]).values[k] = v
    }
    st = await call('PUT', `/api/matches/${st.match.id}/rounds/${i + 1}`,
      { expectedVersion: st.match.version, inputs })
  }

  const gotTotals = Object.fromEntries(Object.entries(st.totals).map(([k, v]) => [k, N(v)]))
  ok(`totaux ${JSON.stringify(gotTotals)}`,
     Object.entries(fx.expect.totals).every(([id, t]) => gotTotals[id] === t),
     `attendu ${JSON.stringify(fx.expect.totals)}`)

  st = await call('POST', `/api/matches/${st.match.id}/finish`, { expectedVersion: st.match.version })

  let guard = 0
  while (st.question && guard++ < 12) {
    const m = st.question.metric
    const values = Object.fromEntries(st.question.ids.map((id: string) => [id, fx.tiebreak?.[m]?.[id] ?? null]))
    st = await call('POST', `/api/matches/${st.match.id}/tiebreak`,
      { expectedVersion: st.match.version, metric: m, values })
  }
  ok('chaîne de départage épuisée', !st.question)

  const ranks = Object.fromEntries(st.ranking.standings.map((s: any) => [s.id, s.rank]))
  ok(`classement ${JSON.stringify(ranks)}`,
     Object.entries(fx.expect.ranks).every(([id, rk]) => ranks[id] === rk),
     `attendu ${JSON.stringify(fx.expect.ranks)}`)
  if (fx.expect.questions !== undefined)
    ok(`${st.ranking.questionsAsked} questions de départage`,
       st.ranking.questionsAsked === fx.expect.questions, `attendu ${fx.expect.questions}`)

  // la partie relue depuis la base doit être identique à celle qu'on vient d'écrire
  const again = await call('GET', `/api/matches/${st.match.id}`)
  ok('relecture depuis la base identique',
     JSON.stringify(again.totals) === JSON.stringify(st.totals) &&
     JSON.stringify(again.ranking?.standings) === JSON.stringify(st.ranking?.standings))
  console.log()
}

// ── les refus que le serveur doit opposer ─────────────────────────────────
console.log(b('Ce que le serveur refuse'))
const refuse = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); ok(label, false, '— accepté alors qu\'il fallait refuser') }
  catch { ok(label, true) }
}
const one = await call('POST', '/api/matches', {
  gameId: 'flip7', mode: 'express', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
})
await refuse('un jeu inconnu', () => call('POST', '/api/matches', { gameId: 'nope', players: [{ name: 'A' }, { name: 'B' }] }))
await refuse('trop peu de joueurs', () => call('POST', '/api/matches', { gameId: 'akropolis', players: [{ name: 'A' }] }))
await refuse('un champ absent du mode', () => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
  { expectedVersion: one.match.version, inputs: { a: { values: { inventé: 3 } } } }))
await refuse('un booléen hors domaine', () => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
  { expectedVersion: one.match.version, inputs: { a: { values: { busted: { type: 'BOOLEAN', value: '1' } } } } }))
await refuse('un bonus négatif', () => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
  { expectedVersion: one.match.version, inputs: { a: { values: { bonusSum: -2 } } } }))
await refuse('un champ de portée table rangé sous un joueur', () => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
  { expectedVersion: one.match.version, inputs: { a: { values: { numberSum: 10 } }, b: { values: { numberSum: 5 } } } })
  .then(() => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
    { inputs: { a: { values: { soloVariant: true } } } })))
await refuse('une version périmée', () => call('PUT', `/api/matches/${one.match.id}/rounds/1`,
  { expectedVersion: 99, inputs: { a: { values: { numberSum: 10 } } } }))
await refuse('un critère de départage qui n\'existe pas', () => call('POST', `/api/matches/${one.match.id}/tiebreak`,
  { metric: 'chance', values: {} }))

// ── absent n'est pas zéro, jusque dans la réponse ─────────────────────────
console.log()
console.log(b('Absent n\'est pas zéro'))
let inc = await call('POST', '/api/matches', {
  gameId: 'akropolis', mode: 'express',
  players: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]
})
inc = await call('PUT', `/api/matches/${inc.match.id}/rounds/1`, {
  expectedVersion: inc.match.version,
  inputs: {
    x: { values: { housingValue: 9, housingStars: 3, varHousing: false } },   // le reste non saisi
    y: { values: { housingValue: 4, housingStars: 1, varHousing: false, marketStd: 0, marketDbl: 0, marketStars: 0, barracksStd: 0, barracksDbl: 0, barracksStars: 0, templeStd: 0, templeDbl: 0, templeStars: 0, gardenStd: 0, gardenDbl: 0, gardenStars: 0, stones: 0 } }
  }
})
ok('un total incomplet vaut INCONNU, pas un nombre', inc.totals.x === null, `obtenu ${JSON.stringify(inc.totals.x)}`)
ok('un total complet vaut son nombre', N(inc.totals.y) === 4)
inc = await call('POST', `/api/matches/${inc.match.id}/finish`, { expectedVersion: inc.match.version })
ok('classement refusé, pas une panne : le serveur répond et nomme qui manque',
   inc.ranking === null && inc.blocked?.ids.includes('x') && !inc.blocked.ids.includes('y'),
   JSON.stringify(inc.blocked))

// ── idempotence ───────────────────────────────────────────────────────────
console.log()
console.log(b('Idempotence'))
let idem = await call('POST', '/api/matches', {
  gameId: 'dune-imperium', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
})
const cmd = crypto.randomUUID()
const body = {
  commandId: cmd, expectedVersion: idem.match.version,
  inputs: { a: { values: { finalVictoryPoints: 8 } }, b: { values: { finalVictoryPoints: 5 } }, c: { values: { finalVictoryPoints: 3 } } }
}
const first = await call('PUT', `/api/matches/${idem.match.id}/rounds/1`, body)
const second = await call('PUT', `/api/matches/${idem.match.id}/rounds/1`, body)
ok('la même commande rejouée rend le même résultat', JSON.stringify(first) === JSON.stringify(second))
ok('et n\'a pas fait avancer la version deux fois', second.match.version === first.match.version)

console.log('\n' + '─'.repeat(66))
console.log(b(`${pass} réussis · ${fail} échoués`))
console.log('─'.repeat(66))
process.exit(fail === 0 ? 0 : 1)
