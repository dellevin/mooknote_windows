import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { dbPath } from '../paths'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema'

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

// 全新库：直接建成 v53 最终结构。
// 已有库（例如用户放入 Android 的 mooknote.db）：IF NOT EXISTS 只补齐缺失的索引，
// 不改动既有表结构；跨版本迁移在阶段 7 备份恢复时再处理。
function migrate(database: Database): void {
  const tx = database.transaction(() => {
    for (const stmt of SCHEMA_STATEMENTS) {
      database.exec(stmt)
    }
    database.exec(
      `CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT)`
    )
    database.prepare(
      `INSERT INTO schema_info(key,value) VALUES('version',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(String(SCHEMA_VERSION))
  })
  tx()
}
