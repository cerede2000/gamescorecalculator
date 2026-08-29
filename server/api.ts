// Les commandes. Le serveur fait autorité : il revalide tout ce qu'il reçoit,
// recalcule tout ce qu'il rend, et n'accorde aucune confiance au client.

import { Router, HttpError, type Ctx } from './http.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { Store, TABLE_SCOPE } from './store.ts'
import { Catalogue } from './catalogue.ts'
import { compute, modeOf } from './engine.ts'
import { checkEntry, checkRound, type Entry as CEntry } from '../packages/rules-core/src/constraints.ts'
import { relevance } from '../packages/rules-core/src/relevance.ts'
import { resolveSetup } from '../packages/rules-core/src/setup.ts'
import { canonical, parse, type Maybe, type NumericValue } from '../packages/rules-core/src/numeric.ts'
import type { Bundle, Field, CollectionSpec } from '../packages/rules-core/src/bundle.ts'

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

// ── normalisation des valeurs reçues ────────────────────────────────────────
// Une valeur absente est null. Une valeur présente doit être du domaine annoncé
// par le champ ; sinon elle est refusée, jamais réinterprétée.
function coerce(f: Field, raw: unknown): Maybe {
  if (raw === null || raw === undefined || raw === '') return null

  let v: NumericValue
  if (typeof raw === 'boolean') v = { type: 'BOOLEAN', value: String(raw) }
  else if (typeof raw === 'number') v = { type: 'INTEGER', value: String(raw) }
  else if (typeof raw === 'object' && raw && 'type' in raw) v = raw as NumericValue
  else throw new HttpError(400, `champ « ${f.id} » : valeur illisible`)

  if (v.type !== f.type) throw new HttpError(400, `champ « ${f.id} » : ${v.type} reçu, ${f.type} attendu`)

  if (v.type === 'BOOLEAN') {
    if (v.value !== 'true' && v.value !== 'false')
      throw new HttpError(400, `champ « ${f.id} » : booléen hors domaine « ${v.value} »`)
    return v
  }
  if (v.type === 'INTEGER') {
    if (!/^-?\d+$/.test(v.value)) throw new HttpError(400, `champ « ${f.id} » : entier attendu`)
    const n = Number(v.value)
    if (f.min !== undefined && n < f.min) throw new HttpError(400, `champ « ${f.id} » : minimum ${f.min}`)
    if (f.max !== undefined && n > f.max) throw new HttpError(400, `champ « ${f.id} » : maximum ${f.max}`)
    if (f.values && !f.values.includes(n))
      throw new HttpError(400, `champ « ${f.id} » : valeur hors de l'ensemble déclaré`)
    return v
  }
  return v
}

function coerceCollection(c: CollectionSpec, raw: unknown): [number, number][] {
  if (raw === null || raw === undefined) return []
  let pairs: [number, number][]
  if (Array.isArray(raw) && raw.every(x => typeof x === 'number'))
    pairs = (raw as number[]).map((v, i) => [i, v])
  else if (Array.isArray(raw))
    pairs = (raw as [number, number][]).map(p => [Number(p[0]), Number(p[1])])
  else if (typeof raw === 'object')
    pairs = Object.entries(raw as Record<string, number>).map(([k, v]) => [Number(k), Number(v)])
  else throw new HttpError(400, `collection « ${c.id} » : forme illisible`)

  for (const [k, v] of pairs) {
    if (!Number.isInteger(k) || !Number.isInteger(v))
      throw new HttpError(400, `collection « ${c.id} » : entiers attendus`)
    if (c.kind === 'valueList') {
      if (c.values && !c.values.includes(v))
        throw new HttpError(400, `collection « ${c.id} » : ${v} hors de l'ensemble déclaré`)
      if (c.min !== undefined && v < c.min)
        throw new HttpError(400, `collection « ${c.id} » : minimum ${c.min}`)
    } else {
      const r = c.keyRange
      if (c.keys && !c.keys.some(x => x.k === k))
        throw new HttpError(400, `collection « ${c.id} » : clé ${k} non déclarée`)
      if (r && (k < r.from || (r.to !== null && k > r.to)))
        throw new HttpError(400, `collection « ${c.id} » : clé ${k} hors intervalle`)
      if (v < 0) throw new HttpError(400, `collection « ${c.id} » : un décompte ne peut être négatif`)
    }
  }
  // en keyedCounts, un décompte nul n'apporte rien au sumOver : on ne le stocke pas
  return c.kind === 'keyedCounts' ? pairs.filter(([, v]) => v !== 0) : pairs
}

/** Un champ de portée table est saisi une fois pour tout le monde. */
const isTableScope = (f: Field) => f.scope === 'GAME' || f.scope === 'ROUND'

export function mount(app: Router, store: Store, cat: Catalogue, clientDir: string): Router {

  // ── le noyau, servi au navigateur ─────────────────────────────────────────
  // L'écran doit désactiver les champs devenus sans objet et griser le matériel
  // déjà pris. C'est exactement ce que le serveur calcule. Plutôt que de le
  // réécrire en JavaScript et de le laisser dériver, on sert la même source :
  // Node sait retirer les types, le navigateur reçoit du JavaScript valide.
  const coreDir = join(clientDir, '..', 'packages', 'rules-core', 'src')
  const core = new Map<string, string>()
  for (const f of readdirSync(coreDir))
    if (f.endsWith('.ts'))
      core.set(f, stripTypeScriptTypes(readFileSync(join(coreDir, f), 'utf8'), { mode: 'strip' }))

  app.get('/core/:file', (c: Ctx) => {
    const js = core.get(c.params.file)
    if (js === undefined) throw new HttpError(404, 'module inconnu')
    c.res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': Buffer.byteLength(js),
      'cache-control': 'no-cache'
    })
    c.res.end(js)
  })

  // ── lecture ───────────────────────────────────────────────────────────────
  app.get('/api/health', () => ({
    ok: true,
    games: cat.all().length,
    refused: cat.refused.map(r => ({ file: r.file, issues: r.issues }))
  }))

  app.get('/api/i18n/:locale', (c: Ctx) => cat.labels[c.params.locale] ?? cat.labels['fr'] ?? {})

  app.get('/api/catalogue', (c: Ctx) => {
    const locale = c.query.get('locale') ?? 'fr'
    return cat.all().map(e => ({
      gameId: e.bundle.gameId,
      name: e.bundle.name[locale] ?? e.bundle.name['fr'] ?? e.bundle.gameId,
      version: e.bundle.version,
      rulesVersion: e.bundle.rulesVersion,
      playerCountRules: e.bundle.playerCountRules,
      setupAssistant: e.bundle.setupAssistant ?? null,
      modes: e.bundle.scoringEngine.modes.map(m => ({ id: m.id, default: !!m.default })),
      ui: e.bundle.ui ?? null,
      notes: e.issues.filter(i => i.severity === 'warning').map(i => i.message)
    }))
  })

  app.get('/api/games/:gameId', (c: Ctx) => {
    const b = cat.localized(c.params.gameId, c.query.get('locale') ?? 'fr')
    if (!b) throw new HttpError(404, 'jeu inconnu')
    return b
  })

  app.get('/api/matches', () => store.matches().map(m => {
    const ps = store.participants(m.id)
    return { ...m, participants: ps.map(p => ({ id: p.id, name: p.name, seat: p.seat })) }
  }))

  app.get('/api/matches/:id', (c: Ctx) => state(c.params.id))

  /** La fiche de mise en place, résolue pour cette table : les quantités qui
   *  dépendent du nombre de joueurs sont déjà calculées. */
  app.get('/api/matches/:id/setup', (c: Ctx) => {
    const m = need(c.params.id)
    const b = cat.localized(m.game_id, m.locale)
    if (!b) throw new HttpError(410, `le jeu « ${m.game_id} » n'est plus au catalogue`)
    const ps = store.participants(m.id)
    return { ...resolveSetup(b, ps.length), participants: ps.map(p => ({ id: p.id, name: p.name, seat: p.seat })) }
  })

  /** La même fiche avant même de créer la partie, pour un nombre de joueurs donné. */
  app.get('/api/games/:gameId/setup', (c: Ctx) => {
    const b = cat.localized(c.params.gameId, c.query.get('locale') ?? 'fr')
    if (!b) throw new HttpError(404, 'jeu inconnu')
    const n = Number(c.query.get('players') ?? b.playerCountRules.min)
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'nombre de joueurs invalide')
    return resolveSetup(b, n)
  })
  app.get('/api/matches/:id/journal', (c: Ctx) => store.journal(c.params.id)
    .map(e => ({ ...e, payload: JSON.parse(e.payload) })))

  // ── création ──────────────────────────────────────────────────────────────
  app.post('/api/matches', (c: Ctx) => {
    const { gameId, mode, players, locale = 'fr', label = '' } = c.body ?? {}
    const entry = cat.get(gameId)
    if (!entry) throw new HttpError(404, 'jeu inconnu')
    const b = entry.bundle
    modeOf(b, mode ?? b.scoringEngine.modes.find(m => m.default)?.id ?? 'express')

    if (!Array.isArray(players) || players.length === 0)
      throw new HttpError(400, 'aucun joueur')
    const r = b.playerCountRules
    if (players.length < r.min || (r.max !== null && players.length > r.max))
      throw new HttpError(400, `${players.length} joueurs : ce jeu en accepte ${r.min}${r.max === null ? ' ou plus' : ' à ' + r.max}`)

    const id = uid(), at = now()
    const chosen = mode ?? b.scoringEngine.modes.find(m => m.default)?.id ?? 'express'
    store.tx(() => {
      store.createMatch(
        { id, game_id: gameId, bundle_version: b.version, mode: chosen, locale, label, status: 'open', created_at: at, updated_at: at },
        players.map((p: any, i: number) => ({ id: p.id ?? `p${i + 1}`, name: String(p.name ?? `Joueur ${i + 1}`).slice(0, 60), seat: i })))
      store.append(id, 'MatchOpened', { gameId, mode: chosen, players: players.length }, at)
    })
    return state(id)
  })

  // ── saisie d'une manche ───────────────────────────────────────────────────
  app.put('/api/matches/:id/rounds/:round', (c: Ctx) => {
    const m = need(c.params.id)
    // La reprise passe AVANT la garde de concurrence : une commande rejouée
    // porte forcément une version périmée, puisque la première a abouti.
    const replay = idempotent(c, m.id)
    if (replay) return replay
    guard(c, m.version)
    if (m.status !== 'open') throw new HttpError(409, 'partie close — la rouvrir pour la modifier')

    const round = Number(c.params.round)
    if (!Number.isInteger(round) || round < 1) throw new HttpError(400, 'numéro de manche invalide')

    const b = need1(m.game_id)
    const mode = modeOf(b, m.mode)
    const fields = new Map(mode.inputs.map(f => [f.id, f]))
    const cols = new Map((mode.collections ?? []).map(x => [x.id, x]))
    const known = new Set(store.participants(m.id).map(p => p.id))

    const byPlayer: Record<string, any> = c.body?.inputs ?? {}
    const at = now()

    store.tx(() => {
      for (const [pid, payload] of Object.entries(byPlayer)) {
        if (pid !== TABLE_SCOPE && !known.has(pid)) throw new HttpError(400, `joueur inconnu : ${pid}`)
        for (const [fid, raw] of Object.entries(payload?.values ?? {})) {
          const f = fields.get(fid)
          if (!f) throw new HttpError(400, `champ « ${fid} » absent du mode ${m.mode}`)
          const target = isTableScope(f) ? TABLE_SCOPE : pid
          if (isTableScope(f) && pid !== TABLE_SCOPE)
            throw new HttpError(400, `champ « ${fid} » de portée table : à saisir sous ${TABLE_SCOPE}`)
          const v = coerce(f, raw)
          store.putInput(m.id, round, target, fid, v === null ? null : canonical(v))
        }
        for (const [cid, raw] of Object.entries(payload?.collections ?? {})) {
          const spec = cols.get(cid)
          if (!spec) throw new HttpError(400, `collection « ${cid} » absente du mode ${m.mode}`)
          store.putCollection(m.id, round, pid, cid, JSON.stringify(coerceCollection(spec, raw)))
        }
      }
      // le matériel est fini : la table entière est revérifiée, saisie comprise.
      // Un dépassement annule l'écriture — la transaction n'est pas validée.
      const entries = roundEntries(m.id, round, b, mode)
      const names = new Map(store.participants(m.id).map(p => [p.id, p.name]))
      const nameOf = (id: string) => names.get(id) ?? id
      const breaches = [
        ...Object.values(entries).flatMap(e => checkEntry(mode, e)),
        ...checkRound(b, mode, entries, nameOf, Object.fromEntries(
          store.inputs(m.id).filter(r => r.round === round && r.participant_id === TABLE_SCOPE)
            .map(r => [r.field_id, r.value === null ? null : parse(r.value)])))
      ]
      if (breaches.length) {
        const first = breaches[0]
        throw new HttpError(409,
          `${cat.t(m.locale, first.message) || cat.t(m.locale, first.label)} — ${first.detail}`,
          breaches.map(x => ({ ...x, message: cat.t(m.locale, x.message), label: cat.t(m.locale, x.label) })))
      }

      if (!store.bumpVersion(m.id, m.version, at)) throw new HttpError(409, 'partie modifiée entre-temps')
      store.append(m.id, 'RoundRecorded', { round, players: Object.keys(byPlayer).length }, at)
    })
    return remember(c, m.id, state(m.id))
  })

  app.delete('/api/matches/:id/rounds/:round', (c: Ctx) => {
    const m = need(c.params.id)
    const replay = idempotent(c, m.id)
    if (replay) return replay
    guard(c, m.version)
    if (m.status !== 'open') throw new HttpError(409, 'partie close — la rouvrir pour la modifier')

    const round = Number(c.params.round)
    const last = store.roundCount(m.id)
    if (!Number.isInteger(round) || round < 1 || round > last)
      throw new HttpError(404, `la manche ${c.params.round} n'existe pas`)

    const at = now()
    store.tx(() => {
      store.dropRound(m.id, round)
      if (!store.bumpVersion(m.id, m.version, at)) throw new HttpError(409, 'partie modifiée entre-temps')
      store.append(m.id, 'RoundDiscarded', { round, renumbered: last - round }, at)
    })
    return remember(c, m.id, state(m.id))
  })

  // ── clôture, réouverture ──────────────────────────────────────────────────
  app.post('/api/matches/:id/finish', (c: Ctx) => {
    const m = need(c.params.id)
    guard(c, m.version)
    const at = now()
    store.tx(() => {
      store.setStatus(m.id, 'finished', at)
      store.bumpVersion(m.id, m.version, at)
      store.append(m.id, 'MatchClosed', {}, at)
    })
    return state(m.id)
  })

  app.post('/api/matches/:id/reopen', (c: Ctx) => {
    const m = need(c.params.id)
    guard(c, m.version)
    const at = now()
    store.tx(() => {
      store.setStatus(m.id, 'open', at)
      store.bumpVersion(m.id, m.version, at)
      // les réponses de départage sont des faits observés à la table :
      // rouvrir la partie ne les efface pas, on ne redemande pas ce qu'on sait
      store.append(m.id, 'MatchReopened', {}, at)
    })
    return state(m.id)
  })

  // ── départage à la demande ────────────────────────────────────────────────
  app.post('/api/matches/:id/tiebreak', (c: Ctx) => {
    const m = need(c.params.id)
    const replay = idempotent(c, m.id)
    if (replay) return replay
    guard(c, m.version)

    const b = need1(m.game_id)
    const metric = String(c.body?.metric ?? '')
    const crit = [...b.scoringEngine.ranking.criteria, ...(b.scoringEngine.tieBreakers ?? [])]
      .find(x => x.metric === metric)
    if (!crit) throw new HttpError(400, `« ${metric} » n'est pas un critère de ce jeu`)
    if (crit.acquire !== 'onDemand')
      throw new HttpError(400, `« ${metric} » n'est pas un critère demandé à la volée`)

    const known = new Set(store.participants(m.id).map(p => p.id))
    const at = now()
    store.tx(() => {
      for (const [pid, raw] of Object.entries(c.body?.values ?? {})) {
        if (!known.has(pid)) throw new HttpError(400, `joueur inconnu : ${pid}`)
        if (raw === null || raw === undefined || raw === '') { store.putTiebreak(m.id, metric, pid, null); continue }
        const n = typeof raw === 'object' ? (raw as any).value : raw
        if (!/^-?\d+$/.test(String(n))) throw new HttpError(400, `« ${metric} » : entier attendu`)
        store.putTiebreak(m.id, metric, pid, canonical({ type: 'INTEGER', value: String(n) }))
      }
      store.bumpVersion(m.id, m.version, at)
      store.append(m.id, 'TiebreakAnswered', { metric, players: Object.keys(c.body?.values ?? {}).length }, at)
    })
    return remember(c, m.id, state(m.id))
  })

  app.delete('/api/matches/:id/tiebreak', (c: Ctx) => {
    const m = need(c.params.id)
    const at = now()
    store.tx(() => {
      store.clearTiebreaks(m.id)
      store.bumpVersion(m.id, m.version, at)
      store.append(m.id, 'TiebreakCleared', {}, at)
    })
    return state(m.id)
  })

  app.delete('/api/matches/:id', (c: Ctx) => { store.deleteMatch(c.params.id); return { deleted: true } })

  app.serve(clientDir)
  return app

  // ── aides ─────────────────────────────────────────────────────────────────
  function need(id: string) {
    const m = store.match(id)
    if (!m) throw new HttpError(404, 'partie inconnue')
    return m
  }
  function need1(gameId: string): Bundle {
    const e = cat.get(gameId)
    if (!e) throw new HttpError(410, `le jeu « ${gameId} » n'est plus au catalogue`)
    return e.bundle
  }
  /** Concurrence optimiste : If-Match, ou expectedVersion dans le corps. */
  function guard(c: Ctx, version: number) {
    const h = c.req.headers['if-match']
    const want = h !== undefined ? Number(String(h).replace(/"/g, '')) : c.body?.expectedVersion
    if (want !== undefined && Number(want) !== version)
      throw new HttpError(409, `partie en version ${version}, commande écrite pour la ${want}`)
  }
  function idempotent(c: Ctx, matchId: string) {
    const id = c.body?.commandId
    if (!id) return null
    const prior = store.recall(String(id))
    return prior ? JSON.parse(prior) : null
  }
  function remember(c: Ctx, matchId: string, result: unknown) {
    if (c.body?.commandId) store.remember(String(c.body.commandId), matchId, result, now())
    return result
  }

  /** L'état d'une manche, participant par participant, tel que les contrôles
   *  de matériel l'attendent. Les champs de portée table en sont exclus :
   *  le matériel se répartit entre les joueurs, il n'appartient pas à la table. */
  function roundEntries(
    matchId: string, round: number, bundle: Bundle, mode: ReturnType<typeof modeOf>
  ): Record<string, CEntry> {
    const out: Record<string, CEntry> = {}
    const table: Record<string, Maybe> = {}
    for (const p of store.participants(matchId)) out[p.id] = { values: {}, collections: {} }

    for (const r of store.inputs(matchId)) {
      if (r.round !== round) continue
      const v = r.value === null ? null : parse(r.value)
      if (r.participant_id === TABLE_SCOPE) table[r.field_id] = v
      else if (out[r.participant_id]) out[r.participant_id].values[r.field_id] = v
    }
    for (const r of store.collections(matchId))
      if (r.round === round && out[r.participant_id])
        out[r.participant_id].collections[r.collection_id] = JSON.parse(r.items)

    // Une valeur devenue non pertinente ne décrit plus la table : un joueur
    // éliminé ne « tient » plus la carte qu'il avait cochée avant de l'être.
    for (const [pid, e] of Object.entries(out)) {
      const rel = relevance(bundle, mode, { ...table, ...e.values },
        Object.fromEntries(Object.entries(e.collections).map(([k, items]) => [k, items.map(([a, b]) => ({ k: a, v: b }))])))
      for (const k of Object.keys(e.values)) if (rel.enabled[k] === false) delete e.values[k]
      for (const k of Object.keys(e.collections)) if (rel.enabled[k] === false) delete e.collections[k]
    }
    return out
  }

  function state(id: string) {
    const m = need(id)
    const entry = cat.get(m.game_id)
    if (!entry) throw new HttpError(410, `le jeu « ${m.game_id} » n'est plus au catalogue`)
    const b = cat.localized(m.game_id, m.locale)!
    const ps = store.participants(id)

    const answers: Record<string, Record<string, Maybe>> = {}
    for (const t of store.tiebreaks(id))
      (answers[t.metric] ??= {})[t.participant_id] = t.value === null ? null : parse(t.value)

    const c = compute(b, m.mode, ps, store.inputs(id), store.collections(id), answers, m.status === 'finished')

    // saisies telles quelles, pour réafficher les écrans
    const entered: Record<number, Record<string, { values: Record<string, Maybe>; collections: Record<string, [number, number][]> }>> = {}
    for (const r of store.inputs(id)) {
      const slot = ((entered[r.round] ??= {})[r.participant_id] ??= { values: {}, collections: {} })
      slot.values[r.field_id] = r.value === null ? null : parse(r.value)
    }
    for (const r of store.collections(id)) {
      const slot = ((entered[r.round] ??= {})[r.participant_id] ??= { values: {}, collections: {} })
      slot.collections[r.collection_id] = JSON.parse(r.items)
    }

    const sa = b.setupAssistant
    const outOfScope = sa?.playerCountRules
      && (ps.length < sa.playerCountRules.min
        || (sa.playerCountRules.max !== null && ps.length > sa.playerCountRules.max))

    return {
      match: {
        id: m.id, gameId: m.game_id, mode: m.mode, locale: m.locale, label: m.label,
        status: m.status, version: m.version, createdAt: m.created_at, updatedAt: m.updated_at
      },
      game: {
        gameId: b.gameId, name: b.name[m.locale] ?? b.name['fr'], version: b.version,
        rulesVersion: b.rulesVersion, ui: b.ui ?? null,
        playerCountRules: b.playerCountRules,
        modes: b.scoringEngine.modes.map(x => ({ id: x.id, default: !!x.default })),
        policies: (b.policies ?? []).filter(p => p.status !== 'confirmed'),
        scopeNotes: (b as any).scopeNotes ?? [],
        setupAssistant: sa ?? null,
        setupOutOfScope: outOfScope ? (sa?.outOfScopeNotice ?? '') : null
      },
      participants: ps.map(p => ({ id: p.id, name: p.name, seat: p.seat })),
      entered,
      rounds: c.rounds,
      totals: c.totals,
      ranking: c.ranking,
      question: c.question,
      blocked: c.blocked,
      triggers: c.triggers,
      gameNotices: c.notices,
      tiebreaks: answers,
      notes: entry.issues.filter(i => i.severity === 'warning').map(i => i.message)
    }
  }
}
