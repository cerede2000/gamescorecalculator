// Démarrage. Rien d'autre : la configuration, le catalogue, les routes.

import { Router } from './http.ts'
import { Store } from './store.ts'
import { Catalogue } from './catalogue.ts'
import { mount } from './api.ts'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'
const DB = process.env.TABLEE_DB ?? join(process.env.DATA_DIR ?? join(root, 'data'), 'tablee.db')

const cat = new Catalogue(join(root, 'games'), join(root, 'i18n'))
const store = new Store(DB)
const app = mount(new Router(), store, cat, join(root, 'client'))

for (const r of cat.refused) {
  console.error(`✗ ${r.file} écarté du catalogue :`)
  for (const i of r.issues.filter(x => x.severity === 'error')) console.error(`    ${i.rule} — ${i.message}`)
}

app.listen(PORT, HOST, () => {
  console.log(`Tablée — ${cat.all().length} jeu(x) au catalogue, base ${DB}`)
  for (const e of cat.all()) {
    const w = e.issues.filter(i => i.severity === 'warning')
    console.log(`  · ${e.bundle.gameId.padEnd(24)} v${e.bundle.version}${w.length ? `  (${w.length} remarque)` : ''}`)
  }
  console.log(`  écoute sur http://${HOST}:${PORT}`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => { store.close(); process.exit(0) })
