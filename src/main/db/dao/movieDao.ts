import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import {
  parseStringList,
  encodeList,
  numOrNull,
  strOrNull,
  MOVIE_ORDER_BY
} from '../util'
import type { Movie, MovieInput } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface MovieRow {
  id: string
  title: string
  poster_path: string | null
  release_date: string | null
  directors: string | null
  writers: string | null
  actors: string | null
  genres: string | null
  alternate_titles: string | null
  summary: string | null
  rating: number | null
  status: string
  category: string
  watch_date: string | null
  watch_count: number
  duration: number
  created_at: string
  updated_at: string
  is_deleted: number
  cover_offset: number
}

function rowToMovie(r: MovieRow): Movie {
  return {
    id: r.id,
    title: r.title,
    posterPath: r.poster_path,
    releaseDate: r.release_date,
    directors: parseStringList(r.directors),
    writers: parseStringList(r.writers),
    actors: parseStringList(r.actors),
    genres: parseStringList(r.genres),
    alternateTitles: parseStringList(r.alternate_titles),
    summary: r.summary,
    rating: r.rating,
    status: r.status as Movie['status'],
    category: r.category,
    watchDate: r.watch_date,
    watchCount: r.watch_count ?? 0,
    duration: r.duration ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1,
    coverOffset: r.cover_offset ?? 0
  }
}

function inputToRow(m: MovieInput): Omit<MovieRow, 'created_at' | 'updated_at' | 'is_deleted'> {
  return {
    id: m.id,
    title: m.title,
    poster_path: strOrNull(m.posterPath),
    release_date: strOrNull(m.releaseDate),
    directors: encodeList(m.directors),
    writers: encodeList(m.writers),
    actors: encodeList(m.actors),
    genres: encodeList(m.genres),
    alternate_titles: encodeList(m.alternateTitles),
    summary: strOrNull(m.summary),
    rating: numOrNull(m.rating),
    status: m.status,
    category: m.category,
    watch_date: strOrNull(m.watchDate),
    watch_count: m.watchCount ?? 0,
    duration: m.duration ?? 0,
    cover_offset: m.coverOffset ?? 0
  }
}

export interface MovieQuery {
  status?: string
  category?: string
  keyword?: string
  sortMode?: number
  limit?: number
  offset?: number
  includeDeleted?: boolean
}

class MovieDao {
  private db(): Database {
    return getDb()
  }

  private orderBy(sortMode = 0): string {
    return MOVIE_ORDER_BY[sortMode] ?? MOVIE_ORDER_BY[0]
  }

  list(q: MovieQuery = {}): Movie[] {
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
      where.push('(title LIKE ? OR alternate_titles LIKE ?)')
      args.push(`%${q.keyword}%`, `%${q.keyword}%`)
    }
    let sql = `SELECT * FROM movies WHERE ${where.join(' AND ')} ORDER BY ${this.orderBy(
      q.sortMode
    )}`
    if (q.limit != null) {
      sql += ' LIMIT ? OFFSET ?'
      args.push(q.limit, q.offset ?? 0)
    }
    return (this.db().prepare(sql).all(...args) as MovieRow[]).map(rowToMovie)
  }

  getById(id: string): Movie | null {
    const row = this.db()
      .prepare('SELECT * FROM movies WHERE id = ? AND is_deleted = 0')
      .get(id) as MovieRow | undefined
    return row ? rowToMovie(row) : null
  }

  insert(m: MovieInput): Movie {
    const now = new Date().toISOString()
    const row = inputToRow(m)
    this.db()
      .prepare(
        `INSERT INTO movies (id,title,poster_path,release_date,directors,writers,actors,genres,
          alternate_titles,summary,rating,status,category,watch_date,watch_count,duration,
          cover_offset,created_at,updated_at,is_deleted)
         VALUES (@id,@title,@poster_path,@release_date,@directors,@writers,@actors,@genres,
          @alternate_titles,@summary,@rating,@status,@category,@watch_date,@watch_count,@duration,
          @cover_offset,@created_at,@updated_at,0)`
      )
      .run({ ...row, created_at: now, updated_at: now })
    return this.getById(m.id)!
  }

  update(m: MovieInput): Movie {
    const row = inputToRow(m)
    this.db()
      .prepare(
        `UPDATE movies SET title=@title,poster_path=@poster_path,release_date=@release_date,
          directors=@directors,writers=@writers,actors=@actors,genres=@genres,
          alternate_titles=@alternate_titles,summary=@summary,rating=@rating,status=@status,
          category=@category,watch_date=@watch_date,watch_count=@watch_count,duration=@duration,
          cover_offset=@cover_offset,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({ ...row, updated_at: new Date().toISOString() })
    return this.getById(m.id)!
  }

  updateCoverOffset(id: string, offset: number): void {
    this.db()
      .prepare('UPDATE movies SET cover_offset=?,updated_at=? WHERE id=?')
      .run(offset, new Date().toISOString(), id)
  }

  softDelete(id: string): void {
    this.db()
      .prepare('UPDATE movies SET is_deleted=1,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare('UPDATE movies SET is_deleted=0,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    const tx = this.db().transaction((mid: string) => {
      const d = this.db()
      d.prepare('DELETE FROM movie_reviews WHERE movie_id=?').run(mid)
      d.prepare('DELETE FROM movie_posters WHERE movie_id=?').run(mid)
      d.prepare('DELETE FROM movie_episodes WHERE movie_id=?').run(mid)
      d.prepare('DELETE FROM movie_people WHERE movie_id=?').run(mid)
      d.prepare('DELETE FROM movie_characters WHERE movie_id=?').run(mid)
      d.prepare('DELETE FROM playlist_items WHERE item_id=?').run(mid)
      recordTombstone('movies', mid)
      d.prepare('DELETE FROM movies WHERE id=?').run(mid)
    })
    tx(id)
  }

  countByStatus(): Record<string, number> {
    const rows = this.db()
      .prepare(
        `SELECT status, COUNT(*) AS c FROM movies WHERE is_deleted=0 GROUP BY status`
      )
      .all() as { status: string; c: number }[]
    const result: Record<string, number> = {}
    for (const r of rows) result[r.status] = r.c
    return result
  }

  // 元数据去重（标签输入提示用）
  allMetadata(): { directors: string[]; writers: string[]; actors: string[]; genres: string[] } {
    const movies = this.list()
    const uniq = (key: keyof Pick<Movie, 'directors' | 'writers' | 'actors' | 'genres'>) => {
      const set = new Set<string>()
      for (const m of movies) m[key].forEach((v) => set.add(v))
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    }
    return {
      directors: uniq('directors'),
      writers: uniq('writers'),
      actors: uniq('actors'),
      genres: uniq('genres')
    }
  }
}

export const movieDao = new MovieDao()
