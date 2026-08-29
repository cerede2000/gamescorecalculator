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
const okCase = async (label: string, fn: () => Promise<unknown>) => {
  try { await fn(); ok(label, true) } catch (e: any) { ok(label, false, `— refusé : ${e.message}`) }
}
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

// ── absent n'est pas zéro, sauf là où le jeu le déclare ───────────────────
console.log()
console.log(b('Absent n\'est pas zéro'))
{
  // Dune ne déclare aucune valeur par défaut : l'absence y reste l'inconnu
  let inc = await call('POST', '/api/matches', {
    gameId: 'dune-imperium', mode: 'express',
    players: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }]
  })
  inc = await call('PUT', `/api/matches/${inc.match.id}/rounds/1`, {
    expectedVersion: inc.match.version,
    inputs: { y: { values: { finalVictoryPoints: 8 } }, z: { values: { finalVictoryPoints: 5 } } }
  })
  ok('un score jamais saisi vaut INCONNU, pas zéro', inc.totals.x === null, JSON.stringify(inc.totals.x))
  ok('un score saisi vaut son nombre', N(inc.totals.y) === 8)
  inc = await call('POST', `/api/matches/${inc.match.id}/finish`, { expectedVersion: inc.match.version })
  ok('classement refusé, pas une panne : le serveur répond et nomme qui manque',
     inc.ranking === null && inc.blocked?.ids.includes('x') && !inc.blocked.ids.includes('y'),
     JSON.stringify(inc.blocked))

  // Akropolis déclare l'inverse : une catégorie vide est un fait, pas une lacune
  let ak = await call('POST', '/api/matches', {
    gameId: 'akropolis', mode: 'express',
    players: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bruno' }]
  })
  ak = await call('PUT', `/api/matches/${ak.match.id}/rounds/1`, {
    expectedVersion: ak.match.version,
    inputs: {
      a: { values: { housingValue: 5, housingStars: 4, marketStd: 1, marketStars: 1, stones: 2 } },
      b: { values: { stones: 4 } }
    }
  })
  ok('cinq cases suffisent : 5×4 + 1 + 2 Pierres = 23', N(ak.totals.a) === 23, JSON.stringify(ak.totals.a))
  ok('un joueur qui n\'a que ses Pierres marque 4', N(ak.totals.b) === 4, JSON.stringify(ak.totals.b))
  ak = await call('POST', `/api/matches/${ak.match.id}/finish`, { expectedVersion: ak.match.version })
  ok('et la table se classe au lieu de se bloquer',
     ak.blocked === null && ak.ranking.standings[0].id === 'a')

  // ce que la porte de publication refuse : les deux à la fois
  const { validate } = await import('../packages/rules-core/src/validate.ts')
  const bad = JSON.parse(readFileSync('games/dune-imperium.json', 'utf8'))
  bad.scoringEngine.modes[0].inputs[0].required = true
  bad.scoringEngine.modes[0].inputs[0].whenAbsent = { type: 'INTEGER', value: '0' }
  ok('un champ requis ET pourvu d\'un défaut est refusé',
     validate(bad).some((i: any) => i.rule === 'RG-12' && i.severity === 'error'))
  const bad2 = JSON.parse(readFileSync('games/akropolis.json', 'utf8'))
  bad2.scoringEngine.modes[0].inputs[0].whenAbsent = { type: 'BOOLEAN', value: 'true' }
  ok('un défaut du mauvais domaine est refusé',
     validate(bad2).some((i: any) => i.rule === 'RG-12' && i.severity === 'error'))
}

// ── ce que le matériel interdit ───────────────────────────────────────────
console.log()
console.log(b('Le matériel est fini'))
const f7 = async () => call('POST', '/api/matches', {
  gameId: 'flip7', mode: 'guided',
  players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }]
})
const put = (st: any, inputs: any) =>
  call('PUT', `/api/matches/${st.match.id}/rounds/1`, { expectedVersion: st.match.version, inputs })

const T = { type: 'BOOLEAN', value: 'true' }, F = { type: 'BOOLEAN', value: 'false' }

await refuse('deux joueurs qui tiennent la seule carte ×2', async () => {
  const st = await f7()
  await put(st, { a: { values: { busted: F, x2: T } }, b: { values: { busted: F, x2: T } } })
})
await refuse('deux exemplaires de la carte 1 sur la table', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: F, x2: F }, collections: { cards: [1, 5] } },
    b: { values: { busted: F, x2: F }, collections: { cards: [1, 7] } }
  })
})
await refuse('deux fois la même carte chez un joueur', async () => {
  const st = await f7()
  await put(st, { a: { values: { busted: F, x2: F }, collections: { cards: [5, 5] } } })
})
await refuse('plus de 40 cubes Pierre sur la table', async () => {
  const st = await call('POST', '/api/matches', {
    gameId: 'akropolis', mode: 'express',
    players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  })
  await put(st, { a: { values: { stones: 25 } }, b: { values: { stones: 20 } } })
})

await okCase('deux cartes 2 sur la table : le paquet en contient deux', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: F, x2: F }, collections: { cards: [2, 5] } },
    b: { values: { busted: F, x2: F }, collections: { cards: [2, 7] } }
  })
})
await okCase('un joueur éliminé ne retient plus la carte ×2 des autres', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: T, x2: T } },
    b: { values: { busted: F, x2: T } }
  })
})
await refuse('deux cartes 0, alors que le paquet n\'en contient qu\'une', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: F, x2: F }, collections: { cards: [0, 3] } },
    b: { values: { busted: F, x2: F }, collections: { cards: [0, 4] } }
  })
})
await refuse('deux joueurs qui prennent le même bonus +6', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: F, x2: F }, collections: { bonuses: [6] } },
    b: { values: { busted: F, x2: F }, collections: { bonuses: [6] } }
  })
})
await refuse('plus de 30 points de bonus sur la table', async () => {
  const st = await call('POST', '/api/matches', {
    gameId: 'flip7', mode: 'express',
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }]
  })
  await put(st, {
    a: { values: { busted: F, numberSum: 10, x2: F, bonusSum: 20, flip7: F } },
    b: { values: { busted: F, numberSum: 10, x2: F, bonusSum: 20, flip7: F } }
  })
})
await okCase('le paquet entier de bonus réparti entre deux joueurs', async () => {
  const st = await f7()
  await put(st, {
    a: { values: { busted: F, x2: F }, collections: { bonuses: [2, 8] } },
    b: { values: { busted: F, x2: F }, collections: { bonuses: [4, 6, 10] } }
  })
})

// ── le plafond qui dépend de la configuration ─────────────────────────────
console.log()
console.log(b('Une Cité ne peut pas contenir plus de Quartiers que la boîte'))
{
  const cite = (n: number) => ({ values: {}, collections: { housingLevels: [[1, n]] } })
  const table = async (players: number, quartiers: number) => {
    const st = await call('POST', '/api/matches', {
      gameId: 'akropolis', mode: 'guided',
      players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `J${i + 1}` }))
    })
    await call('PUT', `/api/matches/${st.match.id}/rounds/1`, {
      expectedVersion: st.match.version,
      inputs: Object.fromEntries(Array.from({ length: players }, (_, i) => [`p${i}`, i === 0 ? cite(quartiers) : cite(1)]))
    })
  }
  for (const [np, max] of [[2, 93], [3, 63], [4, 48]] as const) {
    await okCase(`${np} joueurs : ${max} Quartiers passent`, () => table(np, max))
    await refuse(`${np} joueurs : ${max + 1} Quartiers sont refusés`, () => table(np, max + 1))
  }
}

// ── les règles atteignent la saisie ───────────────────────────────────────
console.log()
console.log(b('Les règles atteignent la saisie'))
{
  const { relevance } = await import('../packages/rules-core/src/relevance.ts')
  const bundle = JSON.parse(readFileSync('games/flip7.json', 'utf8'))
  const mode = bundle.scoringEngine.modes[0]
  const off = (r: any) => Object.entries(r.enabled).filter(([, v]) => !v).map(([k]) => k).sort().join(',')
  ok('éliminé : plus rien d\'autre à saisir',
     off(relevance(bundle, mode, { busted: T })) === 'bonusSum,flip7,numberSum,x2')
  ok('non éliminé : tout reste saisissable',
     off(relevance(bundle, mode, { busted: F })) === '')
  ok('l\'élimination reste réversible', relevance(bundle, mode, { busted: T }).enabled.busted === true)

  const mcb = JSON.parse(readFileSync('games/moon-colony-bloodbath.json', 'utf8'))
  const me = mcb.scoringEngine.modes[0]
  ok('solo : les habitants disparaissent, l\'Événement apparaît',
     off(relevance(mcb, me, { soloVariant: T, extendedSolo: F, manualReached: F })) === 'moonBaseHabitants,printedHabitants,robotsAdded')
  ok('les interrupteurs qui pilotent restent tous accessibles',
     ['soloVariant', 'extendedSolo', 'manualReached'].every(k =>
       relevance(mcb, me, { soloVariant: T, extendedSolo: T, manualReached: T }).enabled[k] === true))

  const ak = JSON.parse(readFileSync('games/akropolis.json', 'utf8'))
  ok('un jeu sans condition ne désactive rien',
     off(relevance(ak, ak.scoringEngine.modes[0], {})) === '')
}

// ── la règle des 200 points ───────────────────────────────────────────────
console.log()
console.log(b('Égalité à 200 : on joue une manche supplémentaire'))
{
  const round = (st: any, n: number, byPlayer: Record<string, number | 'out'>) =>
    call('PUT', `/api/matches/${st.match.id}/rounds/${n}`, {
      expectedVersion: st.match.version,
      inputs: Object.fromEntries(Object.entries(byPlayer).map(([id, v]) => [id, {
        values: v === 'out'
          ? { busted: true, numberSum: 0, x2: false, bonusSum: 0, flip7: false }
          : { busted: false, numberSum: v, x2: false, bonusSum: 0, flip7: false }
      }]))
    })

  let st = await call('POST', '/api/matches', {
    gameId: 'flip7', mode: 'express',
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }]
  })
  st = await round(st, 1, { a: 50, b: 50 })
  st = await round(st, 2, { a: 160, b: 160 })
  ok('à 210 partout, la partie ne se termine pas', st.triggers.length === 0)
  ok('et l\'écran dit pourquoi',
     st.gameNotices.some((n: any) => n.code === 'tieAtThreshold'),
     JSON.stringify(st.gameNotices))

  st = await round(st, 3, { a: 12, b: 'out' })
  ok('après la manche de départage, la partie se termine',
     st.triggers.some((t: any) => t.code === 'threshold'))
  ok('et plus aucun avis d\'égalité', st.gameNotices.length === 0)
  ok('Ana l\'emporte 222 à 210',
     N(st.totals.a) === 222 && N(st.totals.b) === 210)
}
// ── corriger et supprimer une manche ──────────────────────────────────────
console.log()
console.log(b('Revenir sur une manche'))
{
  const mk = () => call('POST', '/api/matches', {
    gameId: 'flip7', mode: 'express',
    players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }]
  })
  const write = (st: any, n: number, ana: number) =>
    call('PUT', `/api/matches/${st.match.id}/rounds/${n}`, {
      expectedVersion: st.match.version,
      inputs: {
        a: { values: { busted: false, numberSum: ana, x2: false, bonusSum: 0, flip7: false } },
        b: { values: { busted: false, numberSum: 1, x2: false, bonusSum: 0, flip7: false } }
      }
    })

  let st = await mk()
  st = await write(st, 1, 10)
  st = await write(st, 2, 20)
  st = await write(st, 3, 30)
  ok('trois manches, cumul 60', N(st.totals.a) === 60)

  // corriger une manche déjà saisie
  st = await write(st, 2, 25)
  ok('une manche se corrige sans en créer une nouvelle',
     st.rounds.length === 3 && N(st.totals.a) === 65)

  // supprimer celle du milieu
  st = await call('DELETE', `/api/matches/${st.match.id}/rounds/2`, { expectedVersion: st.match.version })
  ok('la manche du milieu disparaît', st.rounds.length === 2 && N(st.totals.a) === 40)
  ok('et la numérotation se resserre : pas de manche 3 orpheline',
     JSON.stringify(st.rounds.map((r: any) => r.round)) === '[1,2]')
  ok('les scores restants sont les bons',
     N(st.rounds[0].byParticipant.a.total) === 10 && N(st.rounds[1].byParticipant.a.total) === 30)

  // le piège : deux manches créées d'affilée ne doivent pas retomber au même endroit
  {
    let m = await mk()
    m = await write(m, 1, 10)
    m = await write(m, 2, 20)
    m = await write(m, 3, 30)
    ok('trois manches successives restent trois manches distinctes',
       m.rounds.length === 3 && N(m.totals.a) === 60,
       `${m.rounds.length} manche(s), cumul ${N(m.totals.a)}`)
  }

  await refuse('supprimer une manche qui n\'existe pas',
    () => call('DELETE', `/api/matches/${st.match.id}/rounds/9`, { expectedVersion: st.match.version }))

  const closed = await call('POST', `/api/matches/${st.match.id}/finish`, { expectedVersion: st.match.version })
  await refuse('supprimer une manche d\'une partie close',
    () => call('DELETE', `/api/matches/${st.match.id}/rounds/1`, { expectedVersion: closed.match.version }))
  const open2 = await call('POST', `/api/matches/${st.match.id}/reopen`, { expectedVersion: closed.match.version })
  await okCase('après réouverture, la suppression redevient possible',
    () => call('DELETE', `/api/matches/${st.match.id}/rounds/1`, { expectedVersion: open2.match.version }))
}

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
