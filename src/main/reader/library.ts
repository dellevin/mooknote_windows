import path from 'node:path'
import { readerLibraryDir, readerCoversDir } from '../paths'
import { getReaderDb } from './db'

export interface ReaderAnnotation {
  id: string
  bookId: string
  type: string
  value: string
  color: string | null
  note: string | null
  chapter: string | null
  createdAt: number
}

// ---- 阅读进度（每本书一行 upsert） ----
export function saveProgress(input: {
  bookId: string
  cfi: string
  percentage: number
  chapterTitle: string | null
}): void {
  getReaderDb()
    .prepare(
      `INSERT INTO reader_state (book_id, cfi, percentage, chapter_title, updated_at)
       VALUES (@bookId, @cfi, @percentage, @chapterTitle, @now)
       ON CONFLICT(book_id) DO UPDATE SET
         cfi = excluded.cfi,
         percentage = excluded.percentage,
         chapter_title = excluded.chapter_title,
         updated_at = excluded.updated_at`
    )
    .run({
      bookId: input.bookId,
      cfi: input.cfi,
      percentage: input.percentage,
      chapterTitle: input.chapterTitle,
      now: Date.now()
    })
  getReaderDb()
    .prepare('UPDATE reader_books SET last_read_at = ? WHERE id = ?')
    .run(Date.now(), input.bookId)
}

export function getProgress(bookId: string): {
  cfi: string | null
  percentage: number
  chapterTitle: string | null
} | null {
  const row = getReaderDb()
    .prepare('SELECT cfi, percentage, chapter_title FROM reader_state WHERE book_id = ?')
    .get(bookId) as { cfi: string | null; percentage: number; chapter_title: string | null } | undefined
  if (!row) return null
  return { cfi: row.cfi, percentage: row.percentage, chapterTitle: row.chapter_title }
}

// ---- 书签 / 批注（foliate-js annotation） ----
export function listAnnotations(bookId: string): ReaderAnnotation[] {
  return (
    getReaderDb()
      .prepare(
        `SELECT id, book_id AS bookId, type, value, color, note, chapter, created_at AS createdAt
         FROM reader_annotations WHERE book_id = ? ORDER BY created_at`
      )
      .all(bookId) as ReaderAnnotation[]
  )
}

export function addAnnotation(a: {
  bookId: string
  id: string
  type: string
  value: string
  color?: string | null
  note?: string | null
  chapter?: string | null
}): void {
  getReaderDb()
    .prepare(
      `INSERT INTO reader_annotations (id, book_id, type, value, color, note, chapter, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      a.id,
      a.bookId,
      a.type,
      a.value,
      a.color ?? null,
      a.note ?? null,
      a.chapter ?? null,
      Date.now()
    )
}

export function removeAnnotationByValue(bookId: string, value: string): boolean {
  const info = getReaderDb()
    .prepare('DELETE FROM reader_annotations WHERE book_id = ? AND value = ?')
    .run(bookId, value)
  return info.changes > 0
}

export function getBookStoredPath(fileName: string): string {
  return path.join(readerLibraryDir(), fileName)
}

export { readerCoversDir }
