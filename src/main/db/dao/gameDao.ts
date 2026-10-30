import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, numOrNull, strOrNull } from '../util'
import type { Game, GameInput } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface GameRow {
  id: string
  title: string
  cover_path: string | null
  rating: number | null
  status: string
  category: string
  platforms: string | null
  versions: string | null
  genres: string | null
  play_time_hours: number
  play_time_minutes: number
  play_count: number
  developer: string | null
  release_date: string | null
  purchase_platforms: string | null
  purchase_date: string | null
  purchase_price: string | null
  summary: string | null
  cover_offset: number
  created_at: string
  updated_at: string
  is_deleted: number
}

function rowToGame(r: GameRow): Game {
  return {
    id: r.id,
    title: r.title,
    coverPath: r.cover_path,
    rating: r.rating,
    status: r.status as Game['status'],
    category: r.category,
    platforms: parseStringList(r.platforms),
    versions: parseStringList(r.versions),
    genres: parseStringList(r.genres),
    playTimeHours: r.play_time_hours ?? 0,
    playTimeMinutes: r.play_time_minutes ?? 0,
    playCount: r.play_count ?? 0,
    developer: parseStringList(r.developer),
    releaseDate: r.release_date,
    purchasePlatforms: parseStringList(r.purchase_platforms),
    purchaseDate: r.purchase_date,
    purchasePrice: r.purchase_price,
    summary: r.summary,
    coverOffset: r.cover_offset ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1
  }
}

const ORDER_BY: Record<number, string> = {
  0: 'updated_at DESC',
  1: 'created_at DESC',
  2: 'rating IS NULL, rating DESC, updated_at DESC',
  3: 'release_date IS NULL, release_date DESC, created_at DESC'
}

export interface GameQuery {
  status?: string
  category?: string
  keyword?: string
  sortMode?: number
  includeDeleted?: boolean
}

class GameDao {
  private db(): Database {
    return getDb()
  }

  list(q: GameQuery = {}): Game[] {
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
      where.push('(title LIKE ? OR developer LIKE ?)')
      args.push(`%${q.keyword}%`, `%${q.keyword}%`)
    }
    const sql = `SELECT * FROM games WHERE ${where.join(' AND ')} ORDER BY ${
      ORDER_BY[q.sortMode ?? 0] ?? ORDER_BY[0]
    }`
    return (this.db().prepare(sql).all(...args) as GameRow[]).map(rowToGame)
  }

  getById(id: string): Game | null {
    const row = this.db()
      .prepare('SELECT * FROM games WHERE id = ? AND is_deleted = 0')
      .get(id) as GameRow | undefined
    return row ? rowToGame(row) : null
  }

  insert(g: GameInput): Game {
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO games (id,title,cover_path,rating,status,category,platforms,versions,genres,
          play_time_hours,play_time_minutes,play_count,developer,release_date,purchase_platforms,
          purchase_date,purchase_price,summary,cover_offset,created_at,updated_at,is_deleted)
         VALUES (@id,@title,@cover_path,@rating,@status,@category,@platforms,@versions,@genres,
          @play_time_hours,@play_time_minutes,@play_count,@developer,@release_date,@purchase_platforms,
          @purchase_date,@purchase_price,@summary,@cover_offset,@created_at,@updated_at,0)`
      )
      .run({ ...this.toRow(g), created_at: now, updated_at: now })
    return this.getById(g.id)!
  }

  update(g: GameInput): Game {
    this.db()
      .prepare(
        `UPDATE games SET title=@title,cover_path=@cover_path,rating=@rating,status=@status,
          category=@category,platforms=@platforms,versions=@versions,genres=@genres,
          play_time_hours=@play_time_hours,play_time_minutes=@play_time_minutes,play_count=@play_count,
          developer=@developer,release_date=@release_date,purchase_platforms=@purchase_platforms,
          purchase_date=@purchase_date,purchase_price=@purchase_price,summary=@summary,
          cover_offset=@cover_offset,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({ ...this.toRow(g), updated_at: new Date().toISOString() })
    return this.getById(g.id)!
  }

  private toRow(g: GameInput): Omit<GameRow, 'created_at' | 'updated_at' | 'is_deleted'> {
    return {
      id: g.id,
      title: g.title,
      cover_path: strOrNull(g.coverPath),
      rating: numOrNull(g.rating),
      status: g.status,
      category: g.category,
      platforms: encodeList(g.platforms),
      versions: encodeList(g.versions),
      genres: encodeList(g.genres),
      play_time_hours: g.playTimeHours ?? 0,
      play_time_minutes: g.playTimeMinutes ?? 0,
      play_count: g.playCount ?? 0,
      developer: encodeList(g.developer),
      release_date: strOrNull(g.releaseDate),
      purchase_platforms: encodeList(g.purchasePlatforms),
      purchase_date: strOrNull(g.purchaseDate),
      purchase_price: strOrNull(g.purchasePrice),
      summary: strOrNull(g.summary),
      cover_offset: g.coverOffset ?? 0
    }
  }

  softDelete(id: string): void {
    this.db()
      .prepare('UPDATE games SET is_deleted=1,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare('UPDATE games SET is_deleted=0,updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    const tx = this.db().transaction((gid: string) => {
      const d = this.db()
      d.prepare('DELETE FROM game_reviews WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM game_screenshots WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM game_completions WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM game_levels WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM game_people WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM game_characters WHERE game_id=?').run(gid)
      d.prepare('DELETE FROM playlist_items WHERE item_id=?').run(gid)
      recordTombstone('games', gid)
      d.prepare('DELETE FROM games WHERE id=?').run(gid)
    })
    tx(id)
  }

  countByStatus(): Record<string, number> {
    const rows = this.db()
      .prepare('SELECT status, COUNT(*) c FROM games WHERE is_deleted=0 GROUP BY status')
      .all() as { status: string; c: number }[]
    return Object.fromEntries(rows.map((r) => [r.status, r.c]))
  }

  allMetadata(): {
    platforms: string[]
    genres: string[]
    developer: string[]
  } {
    const games = this.list()
    const uniqList = (pick: (g: Game) => string[]): string[] => {
      const set = new Set<string>()
      for (const g of games) pick(g).forEach((v) => set.add(v))
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    }
    return {
      platforms: uniqList((g) => g.platforms),
      genres: uniqList((g) => g.genres),
      developer: uniqList((g) => g.developer)
    }
  }
}

export const gameDao = new GameDao()
