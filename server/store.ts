// Persistance. Le seul module qui connaît un moteur de stockage.
//
// Le cahier des charges vise PostgreSQL 17. Cette version testable emploie
// node:sqlite, intégré à Node : un conteneur unique, aucun service externe,
// aucune dépendance. Le schéma et les requêtes restent du SQL portable ;
// changer de moteur ne touche que ce fichier.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type MatchRow = {
  id: string; game_id: string; bundle_version: string; mode: string
  locale: string; status: string; version: number
  created_at: string; updated_at: string; label: string
}
export type ParticipantRow = { match_id: string; id: string; name: string; seat: number }

/** Le participant fictif qui porte les champs de portée GAME / ROUND. */
export const TABLE_SCOPE = '@table'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS match (
  id             TEXT PRIMARY KEY,
  game_id        TEXT    NOT NULL,
  bundle_version TEXT    NOT NULL,
  mode           TEXT    NOT NULL,
  locale         TEXT    NOT NULL DEFAULT 'fr',
  label          TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL CHECK (status IN ('open','finished')),
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS participant (
  match_id TEXT    NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  id       TEXT    NOT NULL,
  name     TEXT    NOT NULL,
  seat     INTEGER NOT NULL,
  PRIMARY KEY (match_id, id)
);

-- RG-12 : une valeur absente est NULL, jamais 0. La contrainte interdit
-- l'encodage d'un inconnu par une chaîne vide, qui se lirait comme une valeur.
CREATE TABLE IF NOT EXISTS round_input (
  match_id       TEXT    NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL CHECK (round >= 1),
  participant_id TEXT    NOT NULL,
  field_id       TEXT    NOT NULL,
  value          TEXT,
  PRIMARY KEY (match_id, round, participant_id, field_id),
  CHECK (value IS NULL OR value <> '')
);

CREATE TABLE IF NOT EXISTS round_collection (
  match_id       TEXT    NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  round          INTEGER NOT NULL CHECK (round >= 1),
  participant_id TEXT    NOT NULL,
  collection_id  TEXT    NOT NULL,
  items          TEXT    NOT NULL,
  PRIMARY KEY (match_id, round, participant_id, collection_id)
);

-- Une réponse de départage est acquise une fois et ne se redemande jamais.
CREATE TABLE IF NOT EXISTS tiebreak_answer (
  match_id       TEXT NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  metric         TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  value          TEXT,
  PRIMARY KEY (match_id, metric, participant_id),
  CHECK (value IS NULL OR value <> '')
);

-- Journal allégé, en ajout seul : ce qui s'est passé, pas l'état.
CREATE TABLE IF NOT EXISTS event (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  at       TEXT NOT NULL,
  kind     TEXT NOT NULL,
  payload  TEXT NOT NULL
);

-- Idempotence : une commande rejouée rend son premier résultat.
CREATE TABLE IF NOT EXISTS command (
  id       TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  at       TEXT NOT NULL,
  result   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS event_by_match ON event(match_id, seq);
CREATE INDEX IF NOT EXISTS match_by_date  ON match(updated_at DESC);
`

export class Store {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(SCHEMA)
  }

  close(): void { this.db.close() }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try { const r = fn(); this.db.exec('COMMIT'); return r }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
  }

  // ── parties ───────────────────────────────────────────────────────────────
  createMatch(m: Omit<MatchRow, 'version'>, players: { id: string; name: string; seat: number }[]): void {
    this.db.prepare(`INSERT INTO match
      (id, game_id, bundle_version, mode, locale, label, status, version, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?)`)
      .run(m.id, m.game_id, m.bundle_version, m.mode, m.locale, m.label, m.status, m.created_at, m.updated_at)
    const ins = this.db.prepare('INSERT INTO participant (match_id, id, name, seat) VALUES (?,?,?,?)')
    for (const p of players) ins.run(m.id, p.id, p.name, p.seat)
  }

  match(id: string): MatchRow | undefined {
    return this.db.prepare('SELECT * FROM match WHERE id = ?').get(id) as MatchRow | undefined
  }

  matches(limit = 50): MatchRow[] {
    return this.db.prepare('SELECT * FROM match ORDER BY updated_at DESC LIMIT ?').all(limit) as MatchRow[]
  }

  participants(matchId: string): ParticipantRow[] {
    return this.db.prepare('SELECT * FROM participant WHERE match_id = ? ORDER BY seat').all(matchId) as ParticipantRow[]
  }

  deleteMatch(id: string): void {
    this.db.prepare('DELETE FROM match WHERE id = ?').run(id)
  }

  /** Concurrence optimiste : la version attendue doit être celle en base. */
  bumpVersion(id: string, expected: number, at: string): boolean {
    const r = this.db.prepare('UPDATE match SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .run(at, id, expected)
    return Number(r.changes) === 1
  }

  setStatus(id: string, status: 'open' | 'finished', at: string): void {
    this.db.prepare('UPDATE match SET status = ?, updated_at = ? WHERE id = ?').run(status, at, id)
  }

  setLabel(id: string, label: string): void {
    this.db.prepare('UPDATE match SET label = ? WHERE id = ?').run(label, id)
  }

  // ── saisies ───────────────────────────────────────────────────────────────
  putInput(matchId: string, round: number, pid: string, field: string, canonical: string | null): void {
    this.db.prepare(`INSERT INTO round_input (match_id, round, participant_id, field_id, value)
      VALUES (?,?,?,?,?)
      ON CONFLICT (match_id, round, participant_id, field_id) DO UPDATE SET value = excluded.value`)
      .run(matchId, round, pid, field, canonical)
  }

  putCollection(matchId: string, round: number, pid: string, col: string, items: string): void {
    this.db.prepare(`INSERT INTO round_collection (match_id, round, participant_id, collection_id, items)
      VALUES (?,?,?,?,?)
      ON CONFLICT (match_id, round, participant_id, collection_id) DO UPDATE SET items = excluded.items`)
      .run(matchId, round, pid, col, items)
  }

  inputs(matchId: string): { round: number; participant_id: string; field_id: string; value: string | null }[] {
    return this.db.prepare('SELECT round, participant_id, field_id, value FROM round_input WHERE match_id = ? ORDER BY round')
      .all(matchId) as any
  }

  collections(matchId: string): { round: number; participant_id: string; collection_id: string; items: string }[] {
    return this.db.prepare('SELECT round, participant_id, collection_id, items FROM round_collection WHERE match_id = ? ORDER BY round')
      .all(matchId) as any
  }

  roundCount(matchId: string): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(round), 0) AS n FROM round_input WHERE match_id = ?').get(matchId) as any
    return Number(r.n)
  }

  /** Supprime une manche et RESSERRE la numérotation : une partie ne saute
   *  pas de la manche 1 à la manche 3. La manche n disparaît, les suivantes
   *  reculent d'un cran — aucune collision de clé possible, la place est libre. */
  dropRound(matchId: string, round: number): void {
    this.db.prepare('DELETE FROM round_input WHERE match_id = ? AND round = ?').run(matchId, round)
    this.db.prepare('DELETE FROM round_collection WHERE match_id = ? AND round = ?').run(matchId, round)
    this.db.prepare('UPDATE round_input SET round = round - 1 WHERE match_id = ? AND round > ?').run(matchId, round)
    this.db.prepare('UPDATE round_collection SET round = round - 1 WHERE match_id = ? AND round > ?').run(matchId, round)
  }

  // ── départage ─────────────────────────────────────────────────────────────
  putTiebreak(matchId: string, metric: string, pid: string, canonical: string | null): void {
    this.db.prepare(`INSERT INTO tiebreak_answer (match_id, metric, participant_id, value)
      VALUES (?,?,?,?)
      ON CONFLICT (match_id, metric, participant_id) DO UPDATE SET value = excluded.value`)
      .run(matchId, metric, pid, canonical)
  }

  tiebreaks(matchId: string): { metric: string; participant_id: string; value: string | null }[] {
    return this.db.prepare('SELECT metric, participant_id, value FROM tiebreak_answer WHERE match_id = ?')
      .all(matchId) as any
  }

  clearTiebreaks(matchId: string): void {
    this.db.prepare('DELETE FROM tiebreak_answer WHERE match_id = ?').run(matchId)
  }

  // ── journal ───────────────────────────────────────────────────────────────
  append(matchId: string, kind: string, payload: unknown, at: string): void {
    this.db.prepare('INSERT INTO event (match_id, at, kind, payload) VALUES (?,?,?,?)')
      .run(matchId, at, kind, JSON.stringify(payload))
  }

  journal(matchId: string): { seq: number; at: string; kind: string; payload: string }[] {
    return this.db.prepare('SELECT seq, at, kind, payload FROM event WHERE match_id = ? ORDER BY seq').all(matchId) as any
  }

  // ── idempotence ───────────────────────────────────────────────────────────
  recall(commandId: string): string | undefined {
    const r = this.db.prepare('SELECT result FROM command WHERE id = ?').get(commandId) as any
    return r?.result
  }

  remember(commandId: string, matchId: string, result: unknown, at: string): void {
    this.db.prepare('INSERT OR REPLACE INTO command (id, match_id, at, result) VALUES (?,?,?,?)')
      .run(commandId, matchId, at, JSON.stringify(result))
  }
}
