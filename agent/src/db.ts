import type { Address, LogEntry, UserRecord } from './types.ts'

/** The slice of node:sqlite's DatabaseSync Nest uses; worker.ts provides the same over Durable Object SQLite. */
export interface Db {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: (string | number | null)[]): { changes: number | bigint }
    get(...params: (string | number | null)[]): unknown
    all(...params: (string | number | null)[]): unknown[]
  }
  /** Runs fn atomically: all of its writes or none. */
  transaction(fn: () => void): void
}

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS users (address TEXT PRIMARY KEY, json TEXT NOT NULL, settings_nonce INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, json TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS log_address ON log(address, id)',
]
export const migrate = (db: Db) => SCHEMA.forEach(q => db.exec(q))

export const getUser = (db: Db, a: Address): UserRecord | undefined => {
  const row = db.prepare('SELECT json FROM users WHERE address = ?').get(a.toLowerCase()) as { json: string } | undefined
  return row && JSON.parse(row.json)
}

export const allUsers = (db: Db): UserRecord[] =>
  (db.prepare('SELECT json FROM users').all() as { json: string }[]).map(r => JSON.parse(r.json))

export function putUser(db: Db, u: UserRecord) {
  db.prepare('INSERT INTO users (address, json) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET json = excluded.json')
    .run(u.address.toLowerCase(), JSON.stringify(u))
}

/** Merges loop-owned fields into the latest stored record, so a settings change made mid-tick is not overwritten. */
export function patchUser(db: Db, a: Address, patch: Partial<Pick<UserRecord, 'hwmUsd' | 'status' | 'lastRebalanceAt'>>) {
  const cur = getUser(db, a)
  if (!cur) return
  // A user who paused or changed settings while the tick ran keeps their status; only an exit overrides 'active'.
  const status = patch.status === 'exited' && cur.status === 'active' ? 'exited' : cur.status
  putUser(db, { ...cur, ...patch, status, hwmUsd: Math.max(cur.hwmUsd, patch.hwmUsd ?? 0) })
}

/** Accepts a settings nonce only if it is newer than the last one used for this address. */
export function useSettingsNonce(db: Db, a: Address, nonce: number): boolean {
  const r = db.prepare('UPDATE users SET settings_nonce = ? WHERE address = ? AND settings_nonce < ?').run(nonce, a.toLowerCase(), nonce)
  return Number(r.changes) > 0
}

const lastIds = new WeakMap<Db, number>()
/** The id is part of the signed entry, so it is reserved (synchronously) before the async signing. */
export function nextLogId(db: Db): number {
  const last = lastIds.get(db) ?? ((db.prepare('SELECT MAX(id) AS m FROM log').get() as { m: number | null }).m ?? 0)
  lastIds.set(db, last + 1)
  return last + 1
}

export function addLog(db: Db, e: LogEntry) {
  db.prepare('INSERT INTO log (id, address, json) VALUES (?, ?, ?)').run(e.id, e.address.toLowerCase(), JSON.stringify(e))
}

export function getLog(db: Db, opts: { address?: Address; limit?: number }): LogEntry[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  const rows = (opts.address
    ? db.prepare('SELECT json FROM log WHERE address = ? ORDER BY id DESC LIMIT ?').all(opts.address.toLowerCase(), limit)
    : db.prepare('SELECT json FROM log ORDER BY id DESC LIMIT ?').all(limit)) as { json: string }[]
  return rows.map(r => JSON.parse(r.json))
}
