// Écrans et navigation. L'ordre est celui du parcours réel :
// on prépare la table, la partie se joue, on saisit le résultat, on classe.

import { api, ApiError, show, isUnknown, num, INT } from './api.js'
import { el, clear, toast } from './dom.js'

/** name est un dictionnaire de locales dans le bundle ; l'API le résout ailleurs. */
const gname = g => (typeof g.name === 'string' ? g.name : (g.name?.fr ?? g.gameId))
import { fieldControl, collectionControl } from './controls.js'

const main = document.getElementById('main')
/** Libellés d'interface, chargés une fois. Une clé absente se rend telle quelle. */
let LABELS = {}
export const t = k => LABELS[k] ?? k
const crumbs = document.getElementById('crumbs')
const TABLE = '@table'

const routes = [
  [/^\/?$/,                    home],
  [/^\/nouveau$/,              catalogue],
  [/^\/nouveau\/([\w-]+)$/,    setupScreen],
  [/^\/partie\/([\w-]+)$/,     matchScreen]
]

async function route() {
  const path = location.hash.replace(/^#/, '') || '/'
  for (const [re, view] of routes) {
    const m = path.match(re)
    if (!m) continue
    clear(main)
    document.querySelectorAll('.bar').forEach(b => b.remove())
    try { await view(...m.slice(1)) }
    catch (e) { fail(e) }
    main.focus({ preventScroll: true })
    window.scrollTo(0, 0)
    return
  }
  clear(main).append(el('h1', {}, 'Page inconnue'), link('/', 'Revenir à l\'accueil'))
}
addEventListener('hashchange', route)
fetch('/api/i18n/fr').then(r => r.json()).then(d => { LABELS = d }).catch(() => {}).finally(route)

function fail(e) {
  console.error(e)
  clear(main).append(
    el('h1', {}, 'Quelque chose a refusé'),
    el('div', { class: 'note warn' }, el('p', {}, e instanceof ApiError ? e.message : String(e?.message ?? e))),
    el('p', { style: 'margin-top:16px' }, link('/', 'Revenir à l\'accueil')))
}

const go = p => { location.hash = p }
const link = (p, text, cls = 'btn') => el('button', { class: cls, onclick: () => go(p) }, text)
function trail(...parts) {
  clear(crumbs).append(...parts.map(p => el('span', {}, p)))
}

// ── accueil ────────────────────────────────────────────────────────────────
async function home() {
  trail()
  const [list, health] = await Promise.all([api.matches(), api.health()])
  main.append(
    el('h1', {}, 'Tablée'),
    el('p', { class: 'lede' }, 'Prépare la table, puis compte. Entre les deux, la partie se joue.'),
    el('div', { class: 'row', style: 'margin:20px 0 6px' },
      el('button', { class: 'btn primary', onclick: () => go('/nouveau') }, 'Nouvelle partie')))

  if (health.refused.length)
    main.append(el('div', { class: 'note warn', style: 'margin-top:16px' },
      el('p', {}, `${health.refused.length} jeu(x) écarté(s) du catalogue : ${health.refused.map(r => r.file).join(', ')}.`)))

  main.append(el('h2', {}, 'Parties récentes'))
  if (!list.length) { main.append(el('p', { class: 'muted' }, 'Aucune partie pour l\'instant.')); return }

  main.append(el('div', { class: 'list' }, list.map(m =>
    el('div', { class: 'item', role: 'button', tabindex: '0',
      onclick: () => go(`/partie/${m.id}`),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(`/partie/${m.id}`) } } },
      el('div', {},
        el('div', {}, m.label || m.game_id),
        el('div', { class: 'sub' },
          `${m.participants.map(p => p.name).join(', ')} · ${new Date(m.updated_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`)),
      el('span', { class: 'pill' + (m.status === 'open' ? ' open' : '') },
        m.status === 'open' ? 'en cours' : 'terminée')))))
}

// ── catalogue ──────────────────────────────────────────────────────────────
async function catalogue() {
  trail('Nouvelle partie')
  const games = await api.catalogue()
  main.append(el('h1', {}, 'Choisir un jeu'),
    el('p', { class: 'lede' }, 'Quatre jeux au catalogue, chacun chargé comme une donnée.'))
  main.append(el('div', { class: 'grid', style: 'margin-top:20px' }, games.map(g => {
    const r = g.playerCountRules
    return el('div', { class: 'card', role: 'button', tabindex: '0', style: 'cursor:pointer',
      onclick: () => go(`/nouveau/${g.gameId}`),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(`/nouveau/${g.gameId}`) } } },
      el('div', { class: 'eyebrow' }, `${r.min}${r.max === null ? '+' : '–' + r.max} joueurs`),
      el('h3', { style: 'margin-top:6px;font-size:18px' }, g.name),
      el('div', { class: 'tiny muted' }, g.rulesVersion.label),
      g.notes.length ? el('div', { class: 'tiny', style: 'margin-top:8px;color:var(--wood)' }, g.notes[0]) : null)
  })))
}

// ── mise en place ──────────────────────────────────────────────────────────
async function setupScreen(gameId) {
  const game = await api.game(gameId)
  trail('Nouvelle partie', gname(game))
  const r = game.playerCountRules
  const sa = game.setupAssistant
  let count = Math.max(r.min, Math.min(r.max ?? 4, 3))
  const names = []
  const mode = { id: game.scoringEngine.modes.find(m => m.default)?.id ?? 'express' }

  main.append(el('h1', {}, gname(game)), el('p', { class: 'lede' }, 'Qui est à la table ?'))

  const box = el('div', { class: 'stack', style: 'margin-top:18px' })
  const notice = el('div')
  main.append(box, notice)

  const drawNotice = () => {
    clear(notice)
    if (!sa) return
    const out = sa.playerCountRules &&
      (count < sa.playerCountRules.min || (sa.playerCountRules.max !== null && count > sa.playerCountRules.max))
    if (out) {
      notice.append(el('div', { class: 'note', style: 'margin-top:16px' },
        el('div', { class: 'eyebrow', style: 'color:var(--wood)' }, 'Hors périmètre de l\'assistant'),
        el('p', { style: 'margin:6px 0 0' }, sa.outOfScopeNotice)))
    } else if (!sa.steps?.length) {
      notice.append(el('div', { class: 'note calm', style: 'margin-top:16px' },
        el('p', { style: 'margin:0' }, 'Aucune fiche de mise en place n\'est encore rédigée pour ce jeu. Le décompte, lui, est complet.')))
    }
  }

  const drawPlayers = () => {
    clear(box)
    box.append(el('div', { class: 'row' },
      el('span', { class: 'tiny muted' }, 'Nombre de joueurs'),
      fieldControl({ label: 'joueurs', control: 'stepper', min: r.min, max: r.max ?? 12 }, INT(count), v => {
        if (v === null) return
        count = Number(v.value); drawPlayers(); drawNotice()
      })))
    for (let i = 0; i < count; i++) {
      box.append(el('div', { class: 'field' },
        el('label', { for: `n${i}` }, `Joueur ${i + 1}`),
        el('input', { id: `n${i}`, type: 'text', value: names[i] ?? '',
          placeholder: `Joueur ${i + 1}`, oninput: e => { names[i] = e.target.value } })))
    }
    if (game.scoringEngine.modes.length > 1) {
      box.append(el('div', { class: 'field' },
        el('span', { class: 'lab' }, 'Saisie'),
        el('div', { class: 'seg' }, game.scoringEngine.modes.map(m =>
          el('button', { type: 'button', 'aria-pressed': String(m.id === mode.id),
            onclick: e => {
              mode.id = m.id
              for (const b of e.target.parentElement.children) b.setAttribute('aria-pressed', String(b === e.target))
            } }, m.id === 'express' ? 'Express' : 'Guidée'))),
        el('div', { class: 'help' }, 'Les deux saisies donnent exactement le même décompte : la guidée compte à votre place, l\'express prend vos totaux.')))
    }
  }
  drawPlayers(); drawNotice()

  bar(el('button', { class: 'btn ghost', onclick: () => go('/nouveau') }, 'Retour'),
      el('button', { class: 'btn primary', onclick: async e => {
        e.target.disabled = true
        try {
          const st = await api.create({
            gameId, mode: mode.id, label: gname(game),
            players: Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: names[i] || `Joueur ${i + 1}` }))
          })
          go(`/partie/${st.match.id}`)
        } catch (err) { e.target.disabled = false; toast(err.message, true) }
      } }, 'Commencer'))
}

// ── partie ─────────────────────────────────────────────────────────────────
async function matchScreen(id) {
  let st = await api.match(id)
  const game = await api.game(st.match.gameId)
  const mode = game.scoringEngine.modes.find(m => m.id === st.match.mode)
  const perRound = mode.inputs.some(f => f.scope === 'PARTICIPANT_ROUND' || f.scope === 'ROUND')

  let round = Math.max(1, ...Object.keys(st.entered).map(Number))
  let page = 0
  let draft = {}

  const seed = () => {
    draft = {}
    for (const p of [...st.participants.map(x => x.id), TABLE])
      draft[p] = {
        values: { ...(st.entered[round]?.[p]?.values ?? {}) },
        collections: { ...(st.entered[round]?.[p]?.collections ?? {}) }
      }
    // un interrupteur n'a pas d'inconnu : à défaut il vaut « non »
    for (const f of mode.inputs) {
      if (f.control !== 'toggle') continue
      for (const p of scopeOwners(f)) if (draft[p].values[f.id] === undefined) draft[p].values[f.id] = { type: 'BOOLEAN', value: 'false' }
    }
  }
  const isTable = f => f.scope === 'GAME' || f.scope === 'ROUND'
  const scopeOwner = (f, pid) => (isTable(f) ? TABLE : pid)
  const scopeOwners = f => (isTable(f) ? [TABLE] : st.participants.map(p => p.id))
  seed()

  render()

  function nameOf(pid) { return st.participants.find(p => p.id === pid)?.name ?? pid }

  function render() {
    clear(main)
    document.querySelectorAll('.bar').forEach(b => b.remove())
    trail(st.game.name, st.match.status === 'open' ? `manche ${round}` : 'terminée')

    main.append(el('div', { class: 'spread' },
      el('h1', {}, st.game.name),
      el('span', { class: 'pill' + (st.match.status === 'open' ? ' open' : '') },
        st.match.status === 'open' ? 'en cours' : 'terminée')))
    main.append(el('p', { class: 'lede' }, st.participants.map(p => p.name).join(' · ')))

    if (st.game.setupOutOfScope)
      main.append(el('div', { class: 'note tiny', style: 'margin-top:10px' }, st.game.setupOutOfScope))

    if (st.match.status === 'open') entry()
    results()
    if (st.match.status === 'finished') verdict()
    policies()
  }

  // ── saisie ───────────────────────────────────────────────────────────────
  function entry() {
    main.append(el('h2', {}, perRound ? `Saisie — manche ${round}` : 'Saisie'))

    const tableFields = mode.inputs.filter(isTable)
    if (tableFields.length)
      main.append(el('div', { class: 'card', style: 'margin-bottom:12px' },
        el('div', { class: 'eyebrow' }, 'Toute la table'),
        tableFields.map(f => fieldRow(f, TABLE))))

    const own = mode.inputs.filter(f => !isTable(f))
    const cols = (mode.collections ?? [])

    if (game.ui?.layout === 'categoryPager' && own.length > 5) {
      // les pages viennent des données : un champ dit déjà quelle formule il sert
      const order = [...new Set(own.map(f => f.usedBy))]
      const title = k => game.scoringEngine.contributions.find(c => `formula:${c.code}` === k)?.label ?? k
      main.append(el('div', { class: 'pager' }, order.map((k, i) =>
        el('button', { type: 'button', 'aria-current': String(i === page), onclick: () => { page = i; render() } }, title(k)))))
      const here = own.filter(f => f.usedBy === order[page])
      main.append(el('div', { class: 'grid' }, st.participants.map(p =>
        playerCard(p, here, colsFor(order[page], cols)))))
    } else {
      main.append(el('div', { class: 'grid' }, st.participants.map(p => playerCard(p, own, cols))))
    }

    const filled = st.participants.filter(p =>
      mode.inputs.filter(f => !isTable(f)).every(f => !isUnknown(draft[p.id].values[f.id]))).length

    bar(el('span', { class: 'fill' },
        perRound ? `Manche ${round} · ${filled}/${st.participants.length} complets` : `${filled}/${st.participants.length} complets`),
      perRound && round > 1
        ? el('button', { class: 'btn ghost', onclick: () => { round--; seed(); render() } }, '‹ manche précédente')
        : null,
      el('button', { class: 'btn', onclick: () => save() }, 'Enregistrer'),
      perRound
        ? el('button', { class: 'btn', onclick: () => save().then(() => { round++; seed(); render() }) }, 'Manche suivante')
        : null,
      el('button', { class: 'btn primary', onclick: () => save().then(finish) }, 'Terminer la partie'))
  }

  /** Les collections d'une page : celles qui alimentent une dérivation
   *  consommée par la formule de la page. */
  function colsFor(usedBy, cols) {
    const derived = new Set((mode.derive ?? []).map(d => d.id))
    const fieldsOfPage = mode.inputs.filter(f => f.usedBy === usedBy).map(f => f.id)
    const targets = new Set(fieldsOfPage.map(id => `derive:${id}`))
    const contrib = game.scoringEngine.contributions.find(c => `formula:${c.code}` === usedBy)
    if (contrib) for (const id of refsOf(contrib.value)) if (derived.has(id)) targets.add(`derive:${id}`)
    return cols.filter(c => targets.has(c.usedBy))
  }
  function refsOf(node, acc = []) {
    if (!node || typeof node !== 'object') return acc
    if (node.op === 'ref') acc.push(node.id)
    for (const k of ['cond', 'then', 'else', 'each', 'input', 'left', 'right', 'arg']) if (node[k]) refsOf(node[k], acc)
    for (const a of node.args ?? []) refsOf(a, acc)
    return acc
  }

  function playerCard(p, fields, cols) {
    return el('div', { class: 'card' },
      el('div', { class: 'eyebrow' }, p.name),
      fields.map(f => fieldRow(f, p.id)),
      cols.map(c => el('div', { class: 'field' },
        el('span', { class: 'lab' }, c.label),
        c.help ? el('span', { class: 'help' }, c.help) : null,
        collectionControl(c, draft[p.id].collections[c.id] ?? [], items => { draft[p.id].collections[c.id] = items }))))
  }

  function fieldRow(f, owner) {
    return el('div', { class: 'field' },
      el('span', { class: 'lab' }, f.label,
        f.required ? el('span', { class: 'tiny', style: 'color:var(--wood);font-weight:400' }, ' — requis') : null),
      f.help ? el('span', { class: 'help' }, f.help) : null,
      fieldControl(f, draft[owner].values[f.id] ?? null, v => { draft[owner].values[f.id] = v }))
  }

  async function save() {
    const inputs = {}
    for (const [owner, slot] of Object.entries(draft)) {
      const values = {}
      for (const f of mode.inputs) {
        if (scopeOwner(f, owner) !== owner) continue
        if (isTable(f) !== (owner === TABLE)) continue
        values[f.id] = slot.values[f.id] ?? null
      }
      inputs[owner] = { values, collections: slot.collections }
    }
    st = await api.round(id, round, { expectedVersion: st.match.version, commandId: crypto.randomUUID(), inputs })
      .catch(e => { toast(e.message, true); throw e })
    render()
  }

  async function finish() {
    st = await api.finish(id, st.match.version)
    render()
  }

  // ── décompte ─────────────────────────────────────────────────────────────
  function results() {
    // un mur de tirets n'apprend rien : le décompte attend une première saisie
    if (!st.rounds.length || !Object.keys(st.entered).length) return
    main.append(el('h2', {}, 'Décompte'))
    for (const r of st.rounds) {
      if (st.rounds.length > 1) main.append(el('div', { class: 'eyebrow', style: 'margin:14px 0 6px' }, `Manche ${r.round}`))
      main.append(el('div', { class: 'grid' }, st.participants.map(p => {
        const rep = r.byParticipant[p.id]
        return el('div', { class: 'card' },
          el('div', { class: 'eyebrow' }, p.name),
          el('div', { class: 'overflow' }, el('table', { class: 'lines' }, el('tbody', {},
            rep.lines.map(l => el('tr', {},
              el('td', {}, el('div', {}, l.label),
                l.formula === show(l.value) ? null : el('div', { class: 'f' }, l.formula)),
              el('td', { class: 'v' + (isUnknown(l.value) ? ' unknown' : '') }, show(l.value))))))),
          rep.excluded ? el('div', { class: 'tiny muted', style: 'margin-top:6px' }, rep.excluded) : null,
          el('div', { class: 'total' },
            el('span', { class: 'tiny muted' }, 'Total'),
            el('span', { class: 'n' + (isUnknown(rep.total) ? ' unknown' : '') }, show(rep.total))))
      })))
    }
    if (st.rounds.length > 1) {
      main.append(el('div', { class: 'card', style: 'margin-top:12px' },
        el('div', { class: 'eyebrow' }, 'Cumul'),
        el('table', { class: 'lines' }, el('tbody', {}, st.participants.map(p =>
          el('tr', {}, el('td', {}, p.name),
            el('td', { class: 'v' + (isUnknown(st.totals[p.id]) ? ' unknown' : '') }, show(st.totals[p.id]))))))))
    }
    for (const t of st.triggers)
      main.append(el('div', { class: 'note', style: 'margin-top:12px' },
        el('div', { class: 'eyebrow', style: 'color:var(--wood)' }, 'Fin de partie'),
        el('p', { style: 'margin:4px 0 0' }, `${t.label} — ${t.by.map(nameOf).join(', ')}. `,
          t.mode === 'confirm' ? 'À confirmer.' : t.reversible ? 'Réversible.' : '')))
  }

  // ── verdict ──────────────────────────────────────────────────────────────
  function verdict() {
    if (st.blocked) {
      main.append(el('h2', {}, 'Classement refusé'),
        el('div', { class: 'note warn' },
          el('p', {}, `Le décompte de ${st.blocked.ids.map(nameOf).join(', ')} est incomplet : ce jeu refuse de classer sur une donnée manquante, plutôt que de la lire comme un zéro.`)),
        el('div', { class: 'row', style: 'margin-top:12px' },
          el('button', { class: 'btn', onclick: async () => { st = await api.reopen(id, st.match.version); seed(); render() } }, 'Reprendre la saisie')))
      return
    }
    if (st.question) { tiebreak(); return }
    if (!st.ranking) return

    main.append(el('h2', {}, 'Classement'))
    main.append(el('div', { class: 'standings' }, st.ranking.standings.map(s => {
      const why = s.resolvedBy && s.resolvedBy !== 'cumulative'
        ? labelOfMetric(s.resolvedBy) : null
      return el('div', { class: 'standing' + (s.rank === 1 ? ' first' : '') },
        el('span', { class: 'r' }, s.rank),
        el('div', {},
          el('div', {}, nameOf(s.id),
            s.verdict === 'SHARED_WIN' ? el('span', { class: 'pill', style: 'margin-left:8px' }, 'victoire partagée') : null,
            s.verdict === 'DECLARED_TIE' ? el('span', { class: 'pill', style: 'margin-left:8px' }, 'égalité déclarée') : null),
          why ? el('div', { class: 'why' }, `départagé à « ${why} »`) : null),
        el('span', { class: 's' + (isUnknown(st.totals[s.id]) ? ' unknown' : '') }, show(st.totals[s.id])))
    })))

    if (st.ranking.questionsAsked)
      main.append(el('p', { class: 'tiny muted', style: 'margin-top:10px' },
        `${st.ranking.questionsAsked} question(s) de départage posées — seulement aux joueurs encore à égalité, et seulement jusqu'à ce que ce soit tranché.`))

    bar(el('button', { class: 'btn ghost', onclick: () => go('/') }, 'Accueil'),
        el('button', { class: 'btn', onclick: async () => { st = await api.reopen(id, st.match.version); seed(); render() } }, 'Rouvrir'),
        el('button', { class: 'btn primary', onclick: () => go('/nouveau') }, 'Nouvelle partie'))
  }

  function labelOfMetric(m) {
    const c = [...game.scoringEngine.ranking.criteria, ...(game.scoringEngine.tieBreakers ?? [])].find(x => x.metric === m)
    return c?.label ?? m
  }

  // ── départage ────────────────────────────────────────────────────────────
  function tiebreak() {
    const q = st.question
    const values = {}
    main.append(el('h2', {}, 'Départage'))
    main.append(el('div', { class: 'note calm' },
      el('p', { style: 'margin:0' },
        `Encore à égalité. Combien de « ${q.label} » ${q.ids.length > 1 ? 'ont' : 'a'} `,
        el('strong', {}, q.ids.map(nameOf).join(', ')),
        ' ? Les autres joueurs ne sont pas dérangés.')))
    main.append(el('div', { class: 'card', style: 'margin-top:12px' },
      q.ids.map(pid => el('div', { class: 'field' },
        el('span', { class: 'lab' }, nameOf(pid)),
        fieldControl({ label: `${q.label} de ${nameOf(pid)}`, control: 'stepper', min: 0 }, null,
          v => { values[pid] = v === null ? null : Number(v.value) })))))

    bar(el('span', { class: 'fill' }, `${st.ranking?.questionsAsked ?? 0} question(s) posées jusqu'ici`),
      el('button', { class: 'btn primary', onclick: async e => {
        e.target.disabled = true
        try {
          st = await api.tiebreak(id, {
            expectedVersion: st.match.version, commandId: crypto.randomUUID(),
            metric: q.metric, values: Object.fromEntries(q.ids.map(p => [p, values[p] ?? null]))
          })
          render()
        } catch (err) { e.target.disabled = false; toast(err.message, true) }
      } }, 'Départager'))
  }

  // ── politiques ───────────────────────────────────────────────────────────
  function policies() {
    const ps = st.game.policies
    if (!ps.length) return
    main.append(el('h2', {}, 'Appliqué sans confirmation de la source'))
    main.append(el('div', { class: 'stack' }, ps.map(p =>
      el('div', { class: 'note tiny' },
        el('p', { style: 'margin:0 0 4px' }, el('strong', {}, p.question ?? p.id)),
        el('p', { style: 'margin:0' },
          `Choix provisoire appliqué : ${t('policy.' + p.provisional)}.`,
          p.affectsScore ? ' Ce choix change le score.' : ' Ce choix ne change pas le score.'),
        (p.options ?? []).length > 1
          ? el('p', { style: 'margin:4px 0 0' }, 'Autres possibilités : ' +
              p.options.filter(o => o !== p.provisional).map(o => t('policy.' + o)).join(', ') + '.')
          : null,
        p.source ? el('p', { style: 'margin:4px 0 0', class: 'muted' }, p.source) : null))))
  }
}

function bar(...kids) {
  document.querySelectorAll('.bar').forEach(b => b.remove())
  document.body.append(el('div', { class: 'bar' }, kids.filter(Boolean)))
}
