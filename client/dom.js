// Assemblage de nœuds. Rien de plus : pas de moteur de rendu, pas de diff.

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'html') n.innerHTML = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'dataset') Object.assign(n.dataset, v)
    else if (k in n && k !== 'list' && typeof v !== 'object') n[k] = v
    else n.setAttribute(k, v === true ? '' : String(v))
  }
  add(n, kids)
  return n
}
function add(parent, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue
    parent.append(k instanceof Node ? k : document.createTextNode(String(k)))
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); add(f, kids); return f }
export const clear = n => { while (n.firstChild) n.firstChild.remove(); return n }

let toastTimer
export function toast(message, bad = false) {
  const t = document.getElementById('toast')
  t.textContent = message
  t.className = 'toast on' + (bad ? ' bad' : '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.className = 'toast' }, 3600)
}

/** Confirmation avant une action irréversible. Rend une promesse : vrai si
 *  l'utilisateur confirme.
 *
 *  Ne s'appuie PAS sur l'événement « close » du <dialog> : certains moteurs
 *  ne le déclenchent jamais, et la promesse ne se résolvait alors jamais.
 *  Chaque sortie — bouton, Échap, clic sur le fond — conclut elle-même. */
export function confirmAction({ title, body, confirm, danger = false }) {
  return new Promise(resolve => {
    let done = false
    const finish = ok => {
      if (done) return
      done = true
      try { dialog.close() } catch {}
      dialog.remove()
      resolve(ok)
    }
    const dialog = el('dialog', {
      class: 'ask',
      oncancel: e => { e.preventDefault(); finish(false) },
      onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); finish(false) } },
      onclick: e => { if (e.target === dialog) finish(false) }      // clic hors du cadre
    },
      el('div', { class: 'ask-body' },
        el('h3', {}, title),
        body ? el('p', { class: 'tiny muted' }, body) : null,
        el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
          el('button', { type: 'button', class: 'btn ghost', onclick: () => finish(false) }, 'Annuler'),
          el('button', {
            type: 'button', class: 'btn ' + (danger ? 'danger-solid' : 'primary'),
            onclick: () => finish(true)
          }, confirm))))

    document.body.append(dialog)
    dialog.showModal()
    dialog.querySelector('.danger-solid, .primary')?.focus()
  })
}
