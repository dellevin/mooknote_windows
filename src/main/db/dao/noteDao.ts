import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList } from '../util'
import type { Note, NoteInput } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface NoteRow {
  id: string
  title: string | null
  content: string
  content_type: string | null
  tags: string | null
  images: string | null
  is_pinned: number
  is_deleted: number
  created_at: string
  updated_at: string
}

export interface NoteQuery {
  keyword?: string
  tag?: string
  sortMode?: number
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

// 与 Flutter NoteDao._buildOrderBy 一致，置顶始终最前
const ORDER_BY: Record<number, string> = {
  0: 'is_pinned DESC, updated_at DESC',
  1: 'is_pinned DESC, created_at DESC',
  2: "is_pinned DESC, title COLLATE NOCASE ASC"
}

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content,
    contentType: r.content_type ?? 'markdown',
    tags: parseStringList(r.tags),
    images: parseStringList(r.images),
    isPinned: r.is_pinned === 1,
    isDeleted: r.is_deleted === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

class NoteDao {
  private db(): Database {
    return getDb()
  }

  list(q: NoteQuery = {}): Note[] {
    const where: string[] = []
    const params: unknown[] = []
    if (!q.includeDeleted) where.push('is_deleted=0')
    else if (q.includeDeleted) where.push('is_deleted=1')
    const kw = q.keyword?.trim()
    if (kw) {
      where.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)')
      const like = `%${kw}%`
      params.push(like, like, like)
    }
    if (q.tag?.trim()) {
      where.push('tags LIKE ?')
      params.push(`%${q.tag.trim()}%`)
    }
    const order =
      q.includeDeleted
        ? 'created_at DESC' // 回收站固定按创建时间
        : ORDER_BY[q.sortMode ?? 0] ?? ORDER_BY[0]
    let sql = `SELECT * FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${order}`
    if (q.limit != null) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(q.limit, q.offset ?? 0)
    }
    return (this.db().prepare(sql).all(...params) as NoteRow[]).map(rowToNote)
  }

  getById(id: string): Note | null {
    const row = this.db()
      .prepare(`SELECT * FROM notes WHERE id=? AND is_deleted=0`)
      .get(id) as NoteRow | undefined
    return row ? rowToNote(row) : null
  }

  insert(input: NoteInput): Note {
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO notes (id,title,content,content_type,tags,images,is_pinned,is_deleted,
          created_at,updated_at)
         VALUES (@id,@title,@content,@content_type,@tags,@images,@is_pinned,0,@created_at,@updated_at)`
      )
      .run({
        id: input.id,
        title: input.title,
        content: input.content,
        content_type: input.contentType || 'markdown',
        tags: encodeList(input.tags),
        images: encodeList(input.images),
        is_pinned: input.isPinned ? 1 : 0,
        created_at: now,
        updated_at: now
      })
    return this.getById(input.id)!
  }

  // 不覆盖 created_at，保持创建时间不变（与 Flutter updateNote 一致）
  update(input: NoteInput): Note {
    this.db()
      .prepare(
        `UPDATE notes SET title=@title,content=@content,content_type=@content_type,
          tags=@tags,images=@images,is_pinned=@is_pinned,updated_at=@updated_at WHERE id=@id`
      )
      .run({
        id: input.id,
        title: input.title,
        content: input.content,
        content_type: input.contentType || 'markdown',
        tags: encodeList(input.tags),
        images: encodeList(input.images),
        is_pinned: input.isPinned ? 1 : 0,
        updated_at: new Date().toISOString()
      })
    return this.getById(input.id)!
  }

  softDelete(id: string): void {
    this.db()
      .prepare(`UPDATE notes SET is_deleted=1,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare(`UPDATE notes SET is_deleted=0,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  togglePin(id: string, pinned: boolean): void {
    this.db()
      .prepare(`UPDATE notes SET is_pinned=?,updated_at=? WHERE id=?`)
      .run(pinned ? 1 : 0, new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    recordTombstone('notes', id)
    this.db().prepare(`DELETE FROM notes WHERE id=?`).run(id)
  }

  // 全部标签（未删除笔记），用于标签筛选
  allTags(): string[] {
    const set = new Set<string>()
    const rows = this.db()
      .prepare(`SELECT tags FROM notes WHERE is_deleted=0 AND tags IS NOT NULL`)
      .all() as { tags: string | null }[]
    for (const r of rows) parseStringList(r.tags).forEach((t) => set.add(t))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }
}

export const noteDao = new NoteDao()
