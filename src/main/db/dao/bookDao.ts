import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, numOrNull, strOrNull } from '../util'
import type { Book, BookInput } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface BookRow {
  id: string
  title: string
  cover_path: string | null
  authors: string | null
  translators: string | null
  alternate_titles: string | null
  publisher: string | null
  genres: string | null
  summary: string | null
  rating: number | null
  status: string
  category: string
  isbn: string | null
  publish_date: string | null
  start_date: string | null
  finish_date: string | null
  read_count: number
  created_at: string
  updated_at: string
  is_deleted: number
  cover_offset: number
}

function rowToBook(r: BookRow): Book {
  return {
    id: r.id,
    title: r.title,
    coverPath: r.cover_path,
    authors: parseStringList(r.authors),
    translators: parseStringList(r.translators),
    alternateTitles: parseStringList(r.alternate_titles),
    publisher: r.publisher,
    genres: parseStringList(r.genres),
    summary: r.summary,
    rating: r.rating,
    status: r.status as Book['status'],
    category: r.category,
    isbn: r.isbn,
    publishDate: r.publish_date,
    startDate: r.start_date,
    finishDate: r.finish_date,
    readCount: r.read_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1,
    coverOffset: r.cover_offset ?? 0
  }
}

const ORDER_BY: Record<number, string> = {
  0: 'updated_at DESC',
  1: 'created_at DESC',
  2: 'rating IS NULL, rating DESC, updated_at DESC',
  3: 'finish_date IS NULL, finish_date DESC, created_at DESC',
  4: 'publish_date IS NULL, publish_date DESC, created_at DESC'
}

export interface BookQuery {
  status?: string
  category?: string
  keyword?: string
  sortMode?: number
  includeDeleted?: boolean
}

class BookDao {
  private db(): Database {
    return getDb()
  }

  list(q: BookQuery = {}): Book[] {
    const where: string[] = ['is_deleted = ?']
    const args: unknown[] = [q.includeDeleted ? 1 : 0]
    if (q.status) {
      where.push('status = ?')
      args.push(q.status)
    }
    if (q.category) {
      where.push('category = ?')
      args.push(q.category)
    }
    if (q.keyword) {
      where.push('(title LIKE ? OR alternate_titles LIKE ? OR authors LIKE ?)')
      args.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`)
    }
    const sql = `SELECT * FROM books WHERE ${where.join(' AND ')} ORDER BY ${
      ORDER_BY[q.sortMode ?? 0] ?? ORDER_BY[0]
    }`
    return (this.db().prepare(sql).all(...args) as BookRow[]).map(rowToBook)
  }

  getById(id: string): Book | null {
    const row = this.db()
      .prepare('SELECT * FROM books WHERE id = ? AND is_deleted = 0')
      .get(id) as BookRow | undefined
    return row ? rowToBook(row) : null
  }

  insert(b: BookInput): Book {
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO books (id,title,cover_path,authors,translators,alternate_titles,publisher,genres,
          summary,rating,status,category,isbn,publish_date,start_date,finish_date,read_count,
          cover_offset,created_at,updated_at,is_deleted)
         VALUES (@id,@title,@cover_path,@authors,@translators,@alternate_titles,@publisher,@genres,
          @summary,@rating,@status,@category,@isbn,@publish_date,@start_date,@finish_date,@read_count,
          @cover_offset,@created_at,@updated_at,0)`
      )
      .run({ ...this.toRow(b), created_at: now, updated_at: now })
    return this.getById(b.id)!
  }

  update(b: BookInput): Book {
    this.db()
      .prepare(
        `UPDATE books SET title=@title,cover_path=@cover_path,authors=@authors,translators=@translators,
          alternate_titles=@alternate_titles,publisher=@publisher,genres=@genres,summary=@summary,
          rating=@rating,status=@status,category=@category,isbn=@isbn,publish_date=@publish_date,
          start_date=@start_date,finish_date=@finish_date,read_count=@read_count,
          cover_offset=@cover_offset,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({ ...this.toRow(b), updated_at: new Date().toISOString() })
    return this.getById(b.id)!
  }

  private toRow(b: BookInput): Omit<BookRow, 'created_at' | 'updated_at' | 'is_deleted'> {
    return {
      id: b.id,
      title: b.title,
      cover_path: strOrNull(b.coverPath),
      authors: encodeList(b.authors),
      translators: encodeList(b.translators),
      alternate_titles: encodeList(b.alternateTitles),
      publisher: strOrNull(b.publisher),
      genres: encodeList(b.genres),
      summary: strOrNull(b.summary),
      rating: numOrNull(b.rating),
      status: b.status,
      category: b.category,
      isbn: strOrNull(b.isbn),
      publish_date: strOrNull(b.publishDate),
      start_date: strOrNull(b.startDate),
      finish_date: strOrNull(b.finishDate),
      read_count: b.readCount ?? 0,
      cover_offset: b.coverOffset ?? 0
    }
  }

  softDelete(id: string): void {
    this.db()
      .prepare('UPDATE books SET is_deleted=1,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare('UPDATE books SET is_deleted=0,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    const tx = this.db().transaction((bid: string) => {
      const d = this.db()
      d.prepare('DELETE FROM book_reviews WHERE book_id=?').run(bid)
      d.prepare('DELETE FROM book_excerpts WHERE book_id=?').run(bid)
      d.prepare('DELETE FROM book_chapters WHERE book_id=?').run(bid)
      d.prepare('DELETE FROM book_people WHERE book_id=?').run(bid)
      d.prepare('DELETE FROM book_characters WHERE book_id=?').run(bid)
      d.prepare('DELETE FROM playlist_items WHERE item_id=?').run(bid)
      recordTombstone('books', bid)
      d.prepare('DELETE FROM books WHERE id=?').run(bid)
    })
    tx(id)
  }

  countByStatus(): Record<string, number> {
    const rows = this.db()
      .prepare('SELECT status, COUNT(*) c FROM books WHERE is_deleted=0 GROUP BY status')
      .all() as { status: string; c: number }[]
    return Object.fromEntries(rows.map((r) => [r.status, r.c]))
  }

  allMetadata(): { authors: string[]; translators: string[]; genres: string[]; publishers: string[] } {
    const books = this.list()
    const strs = new Set<string>()
    // 合并 tags 表中未隐藏的类型标签，使 0 引用的标签也能在编辑时被选到
    const tagGenres = (
      this.db()
        .prepare('SELECT name FROM tags WHERE type = ? AND is_hidden = 0')
        .all('book_genre') as { name: string }[]
    ).map((r) => r.name)
    const uniqList = (pick: (b: Book) => string[], extras: string[] = []): string[] => {
      const set = new Set<string>(extras)
      for (const b of books) pick(b).forEach((v) => set.add(v))
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    }
    for (const b of books) if (b.publisher) strs.add(b.publisher)
    return {
      authors: uniqList((b) => b.authors),
      translators: uniqList((b) => b.translators),
      genres: uniqList((b) => b.genres, tagGenres),
      publishers: [...strs].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    }
  }
}

export const bookDao = new BookDao()
