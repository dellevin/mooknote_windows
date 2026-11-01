import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { dbPath } from '../paths'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION, MIGRATIONS } from './schema'

let db: Database | null = null

export function openDatabase(): Database {
  if (db) return db
  db = new BetterSqlite3(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function getDb(): Database {
  if (!db) throw new Error('Database not opened')
  return db
}

// 全新库：CREATE TABLE 直接建成最新结构。
// 已有库（旧版本库或用户放入的 Android mooknote.db）：按 MIGRATIONS 判列后 ALTER 补列，幂等可重复。
function migrate(database: Database): void {
  const tx = database.transaction(() => {
    for (const stmt of SCHEMA_STATEMENTS) {
      database.exec(stmt)
    }
    database.exec(
      `CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT)`
    )
    for (const m of MIGRATIONS) {
      const cols = database.prepare(`PRAGMA table_info(${m.table})`).all() as {
        name: string
      }[]
      if (cols.length && !cols.some((c) => c.name === m.column)) {
        database.exec(m.ddl)
      }
    }
    database.prepare(
      `INSERT INTO schema_info(key,value) VALUES('version',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(String(SCHEMA_VERSION))
  })
  tx()
}
