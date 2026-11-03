import { randomUUID } from 'node:crypto'
import { getReaderDb } from './db'
import type { ReaderCategory } from '../../shared/types'

export function listCategories(): ReaderCategory[] {
  return getReaderDb()
    .prepare(
      `SELECT c.id, c.name, c.sort_order AS sortOrder, c.created_at AS createdAt,
              c.hidden AS hidden, COUNT(bc.book_id) AS count
       FROM reader_categories c
       LEFT JOIN reader_book_categories bc ON bc.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order, c.created_at`
    )
    .all()
    .map((r) => {
      const row = r as {
        id: string
        name: string
        sortOrder: number
        createdAt: number
        hidden: number
        count: number
      }
      return {
        id: row.id,
        name: row.name,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
        count: row.count,
        hidden: !!row.hidden
      }
    })
}

export function addCategory(name: string): ReaderCategory {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分类名不能为空')
  const max = getReaderDb()
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM reader_categories')
    .get() as { m: number }
  const id = randomUUID()
  const now = Date.now()
  getReaderDb()
    .prepare(
      `INSERT INTO reader_categories (id, name, sort_order, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, trimmed, max.m + 1, now)
  return { id, name: trimmed, sortOrder: max.m + 1, createdAt: now, count: 0, hidden: false }
}

export function renameCategory(id: string, name: string): boolean {  const trimmed = name.trim()
  if (!trimmed) return false
  const info = getReaderDb()
    .prepare('UPDATE reader_categories SET name = ? WHERE id = ?')
    .run(trimmed, id)
  return info.changes > 0
}

// 删除分类：关系表 ON DELETE CASCADE 自动解除与书的关联，书本身保留
export function deleteCategory(id: string): boolean {
  const info = getReaderDb().prepare('DELETE FROM reader_categories WHERE id = ?').run(id)
  return info.changes > 0
}

// 仅控制侧栏是否显示，不影响书与分类的关联
export function setCategoryHidden(id: string, hidden: boolean): boolean {
  const info = getReaderDb()
    .prepare('UPDATE reader_categories SET hidden = ? WHERE id = ?')
    .run(hidden ? 1 : 0, id)
  return info.changes > 0
}

// 拖拽排序：orderedIds 为可见分类的新顺序；隐藏分类依次排在其后（侧栏本就折叠收纳）
export function reorderCategories(orderedIds: string[]): void {
  const db = getReaderDb()
  const hiddenRows = db
    .prepare('SELECT id FROM reader_categories WHERE hidden = 1 ORDER BY sort_order, created_at')
    .all() as Array<{ id: string }>
  const full = [...orderedIds, ...hiddenRows.map((r) => r.id)]
  const tx = db.transaction(() => {
    const stmt = db.prepare('UPDATE reader_categories SET sort_order = ? WHERE id = ?')
    full.forEach((id, i) => stmt.run(i, id))
  })
  tx()
}

// 全量替换某本书的分类（事务）
export function setBookCategories(bookId: string, categoryIds: string[]): void {
  const db = getReaderDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reader_book_categories WHERE book_id = ?').run(bookId)
    const insert = db.prepare(
      'INSERT OR IGNORE INTO reader_book_categories (book_id, category_id) VALUES (?, ?)'
    )
    for (const categoryId of categoryIds) insert.run(bookId, categoryId)
  })
  tx()
}
