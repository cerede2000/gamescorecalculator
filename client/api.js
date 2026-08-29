// Le client ne calcule rien. Il montre ce que le serveur a calculé.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `erreur ${res.status}`)
  return json
}

export const api = {
  health:     ()               => call('GET', '/api/health'),
  catalogue:  ()               => call('GET', '/api/catalogue'),
  game:       id               => call('GET', `/api/games/${id}`),
  matches:    ()               => call('GET', '/api/matches'),
  match:      id               => call('GET', `/api/matches/${id}`),
  setup:      id               => call('GET', `/api/matches/${id}/setup`),
  gameSetup:  (id, players)    => call('GET', `/api/games/${id}/setup?players=${players}`),
  create:     body             => call('POST', '/api/matches', body),
  round:      (id, n, body)    => call('PUT', `/api/matches/${id}/rounds/${n}`, body),
  dropRound:  (id, n, body)    => call('DELETE', `/api/matches/${id}/rounds/${n}`, body),
  finish:     (id, v)          => call('POST', `/api/matches/${id}/finish`, { expectedVersion: v }),
  reopen:     (id, v)          => call('POST', `/api/matches/${id}/reopen`, { expectedVersion: v }),
  tiebreak:   (id, body)       => call('POST', `/api/matches/${id}/tiebreak`, body),
  remove:     id               => call('DELETE', `/api/matches/${id}`)
}

/** crypto.randomUUID n'existe qu'en contexte sécurisé : en HTTP sur une IP de
 *  réseau local, il est absent. Un identifiant de commande n'a besoin d'être
 *  unique que le temps d'une session — la solution de repli suffit. */
export const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${(uuid.n = (uuid.n ?? 0) + 1).toString(36)}`

// ── valeurs ────────────────────────────────────────────────────────────────
// Une valeur circule sous sa forme canonique, jamais comme un nombre JSON.
export const INT  = n => ({ type: 'INTEGER', value: String(n) })
export const BOOL = b => ({ type: 'BOOLEAN', value: String(!!b) })

/** Rendu d'une valeur. Un inconnu se voit ; il ne se déguise pas en zéro. */
export function show(v) {
  if (v === null || v === undefined) return '—'
  if (v.type === 'BOOLEAN') return v.value === 'true' ? 'oui' : 'non'
  if (v.type === 'RATIONAL') return v.display ?? `${v.numerator}/${v.denominator}`
  return v.display ?? v.value
}
export const isUnknown = v => v === null || v === undefined
export const num = v => (v === null || v === undefined ? null : Number(v.value))
