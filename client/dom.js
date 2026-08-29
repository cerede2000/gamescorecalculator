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
