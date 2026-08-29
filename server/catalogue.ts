// Chargement du catalogue. Les jeux sont des DONNÉES lues au démarrage,
// jamais compilées avec le serveur. Un bundle qui ne franchit pas la porte
// de publication n'entre pas au catalogue : il est signalé et écarté.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validate, isPublishable, type Issue } from '../packages/rules-core/src/validate.ts'
import type { Bundle } from '../packages/rules-core/src/bundle.ts'

export type Entry = { bundle: Bundle; issues: Issue[]; file: string }

export class Catalogue {
  private readonly entries = new Map<string, Entry>()
  readonly refused: { file: string; issues: Issue[] }[] = []
  readonly labels: Record<string, Record<string, string>> = {}

  constructor(gamesDir: string, i18nDir: string) {
    for (const file of readdirSync(gamesDir).sort()) {
      if (!file.endsWith('.json')) continue
      const bundle = JSON.parse(readFileSync(join(gamesDir, file), 'utf8')) as Bundle
      const issues = validate(bundle)
      if (!isPublishable(issues)) { this.refused.push({ file, issues }); continue }
      this.entries.set(bundle.gameId, { bundle, issues, file })
    }
    for (const file of readdirSync(i18nDir).sort()) {
      if (!file.endsWith('.json')) continue
      this.labels[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(i18nDir, file), 'utf8'))
    }
  }

  get(gameId: string): Entry | undefined { return this.entries.get(gameId) }
  all(): Entry[] { return [...this.entries.values()] }

  /** Résout « i18n:xx.yy » dans la locale demandée. Une clé absente se rend
   *  telle quelle : un libellé manquant doit se voir, pas se deviner. */
  t(locale: string, key: string | undefined): string {
    if (!key) return ''
    if (!key.startsWith('i18n:')) return key
    const k = key.slice(5)
    return this.labels[locale]?.[k] ?? this.labels['fr']?.[k] ?? k
  }

  /** Le bundle tel que l'écran le reçoit : libellés résolus, formules intactes. */
  localized(gameId: string, locale: string): Bundle | undefined {
    const e = this.entries.get(gameId)
    if (!e) return undefined
    const walk = (v: any): any => {
      if (typeof v === 'string') return v.startsWith('i18n:') ? this.t(locale, v) : v
      if (Array.isArray(v)) return v.map(walk)
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
      return v
    }
    return walk(e.bundle) as Bundle
  }
}
