import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { readerDbPath } from '../paths'

// 阅读器独立数据库：与主库 mooknote.db 完全分离，不进入 webdav 增量同步。
let db: Database | null = null

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reader_books (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     author TEXT,
     format TEXT NOT NULL,
     file_name TEXT NOT NULL,
     original_name TEXT,
     cover_path TEXT,
     cover_custom INTEGER NOT NULL DEFAULT 0,
     imported_at INTEGER NOT NULL,
     last_read_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS reader_state (
     book_id TEXT PRIMARY KEY REFERENCES reader_books(id) ON DELETE CASCADE,
     cfi TEXT,
     percentage REAL NOT NULL DEFAULT 0,
     chapter_title TEXT,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reader_annotations (
     id TEXT PRIMARY KEY,
     book_id TEXT NOT NULL REFERENCES reader_books(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     value TEXT NOT NULL,
     color TEXT,
     note TEXT,
     chapter TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reader_annotations_book ON reader_annotations(book_id)`,
  `CREATE TABLE IF NOT EXISTS reader_categories (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reader_book_categories (
     book_id TEXT NOT NULL REFERENCES reader_books(id) ON DELETE CASCADE,
     category_id TEXT NOT NULL REFERENCES reader_categories(id) ON DELETE CASCADE,
     PRIMARY KEY (book_id, category_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reader_book_cat_cat
     ON reader_book_categories(category_id)`
]

export function openReaderDatabase(): Database {
  if (db) return db
  db = new BetterSqlite3(readerDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const tx = db.transaction(() => {
    for (const stmt of SCHEMA) db!.exec(stmt)
    migrate(db!)
  })
  tx()
  return db
}

// 旧库增量加列：CREATE TABLE IF NOT EXISTS 不会改已存在的表结构
function migrate(database: Database): void {
  const cols = database.prepare('PRAGMA table_info(reader_categories)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'hidden')) {
    database.exec('ALTER TABLE reader_categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
  }
}

export function getReaderDb(): Database {
  if (!db) throw new Error('Reader database not opened')
  return db
}

// 恢复备份前关闭连接、释放文件锁；下次访问会重新打开
export function closeReaderDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
