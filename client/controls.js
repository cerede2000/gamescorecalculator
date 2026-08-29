// Les contrôles de saisie sont fabriqués à partir de la DÉCLARATION du champ.
// Aucun contrôle ne connaît un jeu ; il ne connaît qu'un type et un intitulé.

import { el } from './dom.js'
import { INT, BOOL, isUnknown } from './api.js'

/** Un interrupteur n'a pas d'état « inconnu » : éteint veut dire non.
 *  Un pas-à-pas, si : tant qu'on n'y a pas touché, la valeur n'existe pas. */
export function fieldControl(field, value, onChange) {
  switch (field.control) {
    case 'toggle': return toggle(field, value, onChange)
    case 'chips':  return chips(field, value, onChange)
    default:       return stepper(field, value, onChange)
  }
}

function toggle(field, value, onChange) {
  const on = value?.value === 'true'
  const input = el('input', { type: 'checkbox', checked: on, onchange: e => onChange(BOOL(e.target.checked)) })
  const state = el('span', { class: 'state' }, on ? 'oui' : 'non')
  input.addEventListener('change', () => { state.textContent = input.checked ? 'oui' : 'non' })
  return el('label', { class: 'toggle' }, input, el('span', { class: 'track' }), state)
}

function stepper(field, value, onChange) {
  const step = field.step ?? 1
  const input = el('input', {
    type: 'text', inputmode: field.min !== undefined && field.min >= 0 ? 'numeric' : 'text',
    value: isUnknown(value) ? '' : value.value,
    placeholder: 'inconnu',
    'aria-label': field.label,
    oninput: () => { commit(input.value) },
    onblur: () => { box.classList.toggle('empty', input.value === '') }
  })
  const bump = d => {
    // depuis l'inconnu : « + » pose la première unité, « − » pose le zéro connu
    const floor = field.min ?? 0
    let n = input.value === ''
      ? (d > 0 ? floor + step : floor)
      : Number(input.value) + d * step
    if (field.min !== undefined) n = Math.max(field.min, n)
    if (field.max !== undefined) n = Math.min(field.max, n)
    input.value = String(n)
    commit(input.value)
    box.classList.remove('empty')
  }
  const commit = raw => {
    if (raw === '' || raw === '-') return onChange(null)
    if (!/^-?\d+$/.test(raw)) return
    onChange(INT(Number(raw)))
  }
  const box = el('div', { class: 'stepper' + (isUnknown(value) ? ' empty' : '') },
    el('button', { type: 'button', 'aria-label': 'moins', onclick: () => bump(-1) }, '−'),
    input,
    el('button', { type: 'button', 'aria-label': 'plus', onclick: () => bump(+1) }, '+'))
  return box
}

function chips(field, value, onChange) {
  const wrap = el('div', { class: 'chips' })
  for (const v of field.values ?? []) {
    const b = el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(value?.value === String(v)),
      onclick: () => {
        const now = b.getAttribute('aria-pressed') === 'true'
        for (const x of wrap.children) x.setAttribute('aria-pressed', 'false')
        b.setAttribute('aria-pressed', String(!now))
        onChange(now ? null : INT(v))
      }
    }, String(v))
    wrap.append(b)
  }
  return wrap
}

// ── collections ────────────────────────────────────────────────────────────
// items : tableau de paires [k, v]. Le serveur les reçoit telles quelles.
export function collectionControl(spec, items, onChange) {
  return spec.kind === 'keyedCounts' ? keyed(spec, items, onChange) : list(spec, items, onChange)
}

function list(spec, items, onChange) {
  let cur = items.map(([, v]) => v)
  const repack = () => onChange(cur.map((v, i) => [i, v]))
  const wrap = el('div', { class: 'stack' })

  const draw = () => {
    wrap.replaceChildren()
    if (spec.values) {
      wrap.append(el('div', { class: 'chips' }, spec.values.map(v =>
        el('button', { type: 'button', class: 'chip', onclick: () => { cur.push(v); repack(); draw() } }, '+' + v))))
    } else {
      wrap.append(el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn sm ghost',
          onclick: () => { cur.push(spec.min ?? 0); repack(); draw() }
        }, '+ ajouter')))
    }
    if (cur.length) {
      const picked = el('div', { class: 'chips' })
      cur.forEach((v, i) => {
        if (spec.values) {
          picked.append(el('button', {
            type: 'button', class: 'chip removable', 'aria-pressed': 'true',
            title: 'retirer', onclick: () => { cur.splice(i, 1); repack(); draw() }
          }, String(v)))
        } else {
          picked.append(el('span', { class: 'row', style: 'gap:4px' },
            el('input', {
              type: 'text', inputmode: 'numeric', value: String(v), style: 'width:5.5rem',
              'aria-label': `${spec.label} ${i + 1}`,
              oninput: e => { if (/^-?\d*$/.test(e.target.value)) { cur[i] = Number(e.target.value || 0); repack() } }
            }),
            el('button', { type: 'button', class: 'btn sm ghost', title: 'retirer', onclick: () => { cur.splice(i, 1); repack(); draw() } }, '×')))
        }
      })
      wrap.append(picked)
      wrap.append(el('div', { class: 'tiny muted num' },
        `${cur.length} saisie(s), somme ${cur.reduce((a, b) => a + b, 0)}`))
    }
  }
  draw()
  return wrap
}

function keyed(spec, items, onChange) {
  const counts = new Map(items)
  const r = spec.keyRange
  const declared = spec.keys?.map(k => k.k) ?? []
  // on affiche les clés déclarées, celles déjà saisies, et jusqu'à la suggestion
  let shown = spec.keys
    ? declared
    : [...new Set([
        ...Array.from({ length: (r.suggest ?? r.from) - r.from + 1 }, (_, i) => r.from + i),
        ...counts.keys()
      ])].sort((a, b) => a - b)

  const wrap = el('div', { class: 'stack' })
  const emit = () => onChange([...counts.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]))

  const draw = () => {
    wrap.replaceChildren()
    for (const k of shown) {
      const label = spec.keys?.find(x => x.k === k)?.label ?? `${r.label} ${k}`
      wrap.append(el('div', { class: 'row', style: 'justify-content:space-between' },
        el('span', { class: 'tiny' }, label),
        fieldControl({ label, control: 'stepper', min: 0 },
          counts.has(k) ? INT(counts.get(k)) : null,
          v => { if (v === null) counts.delete(k); else counts.set(k, Number(v.value)); emit(); total() })))
    }
    if (r && (r.to === null || Math.max(...shown, r.from - 1) < r.to)) {
      const next = Math.max(...shown, r.from - 1) + 1
      wrap.append(el('button', {
        type: 'button', class: 'btn sm ghost', onclick: () => { shown = [...shown, next]; draw(); total() }
      }, `+ ${r.label.toLowerCase()} ${next}`))
    }
    wrap.append(sum)
    total()
  }
  const sum = el('div', { class: 'tiny muted num' })
  const total = () => {
    const t = [...counts.entries()].reduce((a, [k, v]) => a + k * v, 0)
    const n = [...counts.values()].reduce((a, v) => a + v, 0)
    sum.textContent = n ? `${n} tuile(s), valeur ${t}` : ''
  }
  draw()
  return wrap
}
