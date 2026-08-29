// Porte de publication : refuse tout bundle non conforme au contrat.
// Le validateur du noyau est pur — il n'a pas de système de fichiers. Les
// contrôles qui en ont besoin vivent ici : une partie de référence déclarée
// doit exister, comme tout le reste doit désigner quelque chose de réel.
import { readFileSync, readdirSync } from 'node:fs'
import { validate, isPublishable } from '../packages/rules-core/src/validate.ts'

const files = new Set(readdirSync('fixtures').filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')))
const claimed = new Map<string, string>()

let refused = 0
for (const f of readdirSync('games').sort()) {
  const b = JSON.parse(readFileSync(`games/${f}`, 'utf8'))
  const issues = validate(b)

  for (const name of b.fixtures ?? []) {
    if (!files.has(name))
      issues.push({ severity: 'error', rule: 'EC-09', message: `partie de référence déclarée « ${name} » : aucun fichier fixtures/${name}.json` })
    else if (JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8')).game !== b.gameId)
      issues.push({ severity: 'error', rule: 'EC-09', message: `partie de référence « ${name} » appartient à un autre jeu` })
    else claimed.set(name, b.gameId)
  }

  const ok = isPublishable(issues)
  if (!ok) refused++
  console.log(`${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${f.padEnd(30)} ${issues.length ? issues.length + ' remarque(s)' : 'conforme'}`)
  for (const i of issues) console.log(`    [${i.severity}] ${i.rule} — ${i.message}`)
}

// une partie de référence qu'aucun bundle ne revendique ne prouve rien
for (const name of files)
  if (!claimed.has(name)) {
    console.log(`\x1b[31m✗\x1b[0m ${('fixtures/' + name).padEnd(30)} revendiquée par aucun bundle`)
    refused++
  }

process.exit(refused === 0 ? 0 : 1)
