// Un routeur minimal sur node:http. Aucune dépendance : le serveur ne fait
// que router, lire un corps JSON et servir des fichiers.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'

export type Ctx = {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  body: any
}
type Handler = (c: Ctx) => unknown | Promise<unknown>
type Route = { method: string; parts: string[]; handler: Handler }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.webmanifest': 'application/manifest+json'
}

export class HttpError extends Error {
  status: number
  detail?: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message); this.status = status; this.detail = detail
  }
}

export class Router {
  private readonly routes: Route[] = []
  private staticDir: string | null = null

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler })
    return this
  }
  get(p: string, h: Handler) { return this.on('GET', p, h) }
  post(p: string, h: Handler) { return this.on('POST', p, h) }
  put(p: string, h: Handler) { return this.on('PUT', p, h) }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h) }
  serve(dir: string) { this.staticDir = dir; return this }

  private match(method: string, parts: string[]): { r: Route; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < parts.length; i++) {
        const p = r.parts[i]
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i])
        else if (p !== parts[i]) { ok = false; break }
      }
      if (ok) return { r, params }
    }
    return null
  }

  listen(port: number, host: string, onReady: () => void) {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean)
      const hit = this.match(req.method ?? 'GET', parts)

      if (!hit) {
        if (this.staticDir && (req.method === 'GET' || req.method === 'HEAD'))
          return this.sendFile(res, url.pathname)
        return send(res, 404, { error: 'route inconnue' })
      }

      try {
        const body = await readBody(req)
        const out = await hit.r.handler({ req, res, params: hit.params, query: url.searchParams, body })
        if (res.writableEnded) return
        send(res, 200, out)
      } catch (e: any) {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message, detail: e.detail })
        console.error(e)
        send(res, 500, { error: e?.message ?? 'erreur interne' })
      }
    })
    server.listen(port, host, onReady)
    return server
  }

  private sendFile(res: ServerResponse, pathname: string) {
    const dir = this.staticDir!
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '')
    let file = join(dir, rel)
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html') }
    catch { file = join(dir, 'index.html') }          // l'écran est une seule page
    try { statSync(file) } catch { return send(res, 404, { error: 'introuvable' }) }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache'
    })
    createReadStream(file).pipe(res)
  }
}

function send(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload ?? null)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > 1_000_000) { reject(new HttpError(413, 'corps trop volumineux')); req.destroy() }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try { resolve(JSON.parse(raw)) } catch { reject(new HttpError(400, 'corps JSON illisible')) }
    })
    req.on('error', reject)
  })
}
