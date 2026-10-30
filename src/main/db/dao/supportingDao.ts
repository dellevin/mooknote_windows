import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, numOrNull, strOrNull } from '../util'
import type {
  MediaImage,
  BookExcerpt,
  ProgressEntry,
  ProgressKind,
  GameCompletion
} from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

// ========== 海报墙 / 截图（结构同构，软删除） ==========
type ImageCollectionKind = 'poster' | 'screenshot'
const IMG_CFG: Record<
  ImageCollectionKind,
  { table: string; fk: string; pathCol: string }
> = {
  poster: { table: 'movie_posters', fk: 'movie_id', pathCol: 'poster_path' },
  screenshot: { table: 'game_screenshots', fk: 'game_id', pathCol: 'screenshot_path' }
}

class ImageCollectionDao {
  private db(): Database {
    return getDb()
  }
  list(kind: ImageCollectionKind, parentId: string): MediaImage[] {
    const { table, fk, pathCol } = IMG_CFG[kind]
    const rows = this.db()
      .prepare(
        `SELECT id, ${fk} AS parent_id, ${pathCol} AS image_path, created_at
         FROM ${table} WHERE ${fk}=? AND is_deleted=0 ORDER BY created_at ASC`
      )
      .all(parentId) as {
      id: string
      parent_id: string
      image_path: string
      created_at: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      imagePath: r.image_path,
      createdAt: r.created_at
    }))
  }
  add(kind: ImageCollectionKind, id: string, parentId: string, imagePath: string): void {
    const { table, fk, pathCol } = IMG_CFG[kind]
    this.db()
      .prepare(
        `INSERT INTO ${table} (id,${fk},${pathCol},is_deleted,created_at)
         VALUES (?,?,?,0,?)`
      )
      .run(id, parentId, imagePath, new Date().toISOString())
  }
  remove(kind: ImageCollectionKind, id: string): string | null {
    const { table, fk } = IMG_CFG[kind]
    const db = this.db()
    const row = db.prepare(`SELECT ${fk} AS pid FROM ${table} WHERE id=?`).get(id) as
      | { pid: string }
      | undefined
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
    return row?.pid ?? null
  }
}
export const imageCollectionDao = new ImageCollectionDao()

// ========== 书籍摘抄 ==========
interface ExcerptRow {
  id: string
  book_id: string
  chapter: string | null
  content: string
  comment: string | null
  created_at: string
  updated_at: string
}
class ExcerptDao {
  private db(): Database {
    return getDb()
  }
  list(bookId: string): BookExcerpt[] {
    return (
      this.db()
        .prepare(
          `SELECT * FROM book_excerpts WHERE book_id=? AND is_deleted=0 ORDER BY created_at DESC`
        )
        .all(bookId) as ExcerptRow[]
    ).map((r) => ({
      id: r.id,
      bookId: r.book_id,
      chapter: r.chapter,
      content: r.content,
      comment: r.comment,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }
  upsert(e: BookExcerpt & { isNew: boolean }): void {
    const now = new Date().toISOString()
    if (e.isNew) {
      this.db()
        .prepare(
          `INSERT INTO book_excerpts (id,book_id,chapter,content,comment,is_deleted,created_at,updated_at)
           VALUES (?,?,?,?,?,0,?,?)`
        )
        .run(e.id, e.bookId, strOrNull(e.chapter), e.content, strOrNull(e.comment), now, now)
    } else {
      this.db()
        .prepare(
          `UPDATE book_excerpts SET chapter=?,content=?,comment=?,updated_at=? WHERE id=?`
        )
        .run(strOrNull(e.chapter), e.content, strOrNull(e.comment), now, e.id)
    }
  }
  remove(id: string): string | null {
    const db = this.db()
    const row = db
      .prepare(`SELECT book_id AS pid FROM book_excerpts WHERE id=?`)
      .get(id) as { pid: string } | undefined
    recordTombstone('book_excerpts', id)
    db.prepare(`DELETE FROM book_excerpts WHERE id=?`).run(id)
    return row?.pid ?? null
  }
}
export const excerptDao = new ExcerptDao()

// ========== 分集 / 章节 / 关卡 ==========
const PROG_CFG: Record<
  ProgressKind,
  { table: string; fk: string; noCol: string; doneCol: string; dateCol: string }
> = {
  episode: {
    table: 'movie_episodes',
    fk: 'movie_id',
    noCol: 'episode_no',
    doneCol: 'watched',
    dateCol: 'watch_date'
  },
  chapter: {
    table: 'book_chapters',
    fk: 'book_id',
    noCol: 'chapter_no',
    doneCol: 'read',
    dateCol: 'read_date'
  },
  level: {
    table: 'game_levels',
    fk: 'game_id',
    noCol: 'level_no',
    doneCol: 'cleared',
    dateCol: 'clear_date'
  }
}

class ProgressDao {
  private db(): Database {
    return getDb()
  }
  list(kind: ProgressKind, parentId: string): ProgressEntry[] {
    const { table, fk, noCol, doneCol, dateCol } = PROG_CFG[kind]
    const rows = this.db()
      .prepare(`SELECT * FROM ${table} WHERE ${fk}=? AND is_deleted=0 ORDER BY ${noCol} ASC`)
      .all(parentId) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string,
      parentId: r[fk] as string,
      no: r[noCol] as number,
      title: (r['title'] as string) ?? '',
      done: r[doneCol] === 1,
      date: (r[dateCol] as string | null) ?? null,
      rating: numOrNull(r['rating']),
      review: (r['review'] as string) ?? '',
      images: parseStringList(r['images']),
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string
    }))
  }

  private write(kind: ProgressKind, e: ProgressEntry, isNew: boolean): void {
    const { table, fk, noCol, doneCol, dateCol } = PROG_CFG[kind]
    const now = new Date().toISOString()
    if (isNew) {
      this.db()
        .prepare(
          `INSERT INTO ${table} (id,${fk},${noCol},title,${doneCol},${dateCol},rating,review,images,is_deleted,created_at,updated_at)
           VALUES (@id,@parent,@no,@title,@done,@date,@rating,@review,@images,0,@created_at,@updated_at)`
        )
        .run({
          id: e.id,
          parent: e.parentId,
          no: e.no,
          title: e.title,
          done: e.done ? 1 : 0,
          date: strOrNull(e.date),
          rating: numOrNull(e.rating),
          review: e.review,
          images: encodeList(e.images),
          created_at: now,
          updated_at: now
        })
    } else {
      this.db()
        .prepare(
          `UPDATE ${table} SET ${noCol}=@no,title=@title,${doneCol}=@done,${dateCol}=@date,
            rating=@rating,review=@review,images=@images,updated_at=@updated_at WHERE id=@id`
        )
        .run({
          id: e.id,
          no: e.no,
          title: e.title,
          done: e.done ? 1 : 0,
          date: strOrNull(e.date),
          rating: numOrNull(e.rating),
          review: e.review,
          images: encodeList(e.images),
          updated_at: now
        })
    }
  }
  insert(kind: ProgressKind, e: ProgressEntry): void {
    this.write(kind, e, true)
  }
  update(kind: ProgressKind, e: ProgressEntry): void {
    this.write(kind, e, false)
  }
  toggleDone(kind: ProgressKind, id: string, done: boolean): string | null {
    const { table, fk, doneCol, dateCol } = PROG_CFG[kind]
    const db = this.db()
    db.prepare(
      `UPDATE ${table} SET ${doneCol}=?, ${dateCol}=?, updated_at=? WHERE id=?`
    ).run(done ? 1 : 0, done ? new Date().toISOString() : null, new Date().toISOString(), id)
    const row = db.prepare(`SELECT ${fk} AS pid FROM ${table} WHERE id=?`).get(id) as
      | { pid: string }
      | undefined
    return row?.pid ?? null
  }
  parentIdOf(kind: ProgressKind, id: string): string | null {
    const { table, fk } = PROG_CFG[kind]
    const row = this.db().prepare(`SELECT ${fk} AS pid FROM ${table} WHERE id=?`).get(id) as
      | { pid: string }
      | undefined
    return row?.pid ?? null
  }
  remove(kind: ProgressKind, id: string): string | null {
    const pid = this.parentIdOf(kind, id)
    const { table } = PROG_CFG[kind]
    this.db().prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
    return pid
  }
}
export const progressDao = new ProgressDao()

// ========== 游戏通关记录 ==========
class CompletionDao {
  private db(): Database {
    return getDb()
  }
  list(gameId: string): GameCompletion[] {
    return (
      this.db()
        .prepare(
          `SELECT * FROM game_completions WHERE game_id=? AND is_deleted=0 ORDER BY completion_date DESC`
        )
        .all(gameId) as {
        id: string
        game_id: string
        completion_date: string
        note: string
        created_at: string
        updated_at: string
      }[]
    ).map((r) => ({
      id: r.id,
      gameId: r.game_id,
      completionDate: r.completion_date,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }
  add(c: GameCompletion): void {
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO game_completions (id,game_id,completion_date,note,is_deleted,created_at,updated_at)
         VALUES (?,?,?,?,0,?,?)`
      )
      .run(c.id, c.gameId, c.completionDate, c.note, now, now)
  }
  remove(id: string): string | null {
    const db = this.db()
    const row = db
      .prepare(`SELECT game_id AS pid FROM game_completions WHERE id=?`)
      .get(id) as { pid: string } | undefined
    db.prepare(`DELETE FROM game_completions WHERE id=?`).run(id)
    return row?.pid ?? null
  }
}
export const completionDao = new CompletionDao()
