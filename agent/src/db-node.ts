import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Db } from './db.ts'

export function openDb(file = process.env.DB_FILE ?? new URL('../data/nest.db', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL')
  const db: Db = Object.assign(sqlite, {
    transaction(fn: () => void) {
      sqlite.exec('BEGIN')
      try { fn(); sqlite.exec('COMMIT') } catch (e) { sqlite.exec('ROLLBACK'); throw e }
    },
  })
  migrate(db)
  return db
}
