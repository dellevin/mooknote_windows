import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { numOrNull, strOrNull } from '../util'
import type {
  Playlist,
  PlaylistInput,
  PlaylistItemView,
  PlaylistType
} from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface PlaylistRow {
  id: string
  name: string
  description: string
  type: PlaylistType
  cover_path: string | null
  item_count: number
  sort_order: number
  is_deleted: number
  created_at: string
  updated_at: string
}

function rowToPlaylist(r: PlaylistRow): Playlist {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    type: r.type,
    coverPath: r.cover_path,
    itemCount: r.item_count ?? 0,
    sortOrder: r.sort_order ?? 0,
    isDeleted: r.is_deleted === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const MEDIA_TABLE: Record<PlaylistType, { table: string; coverCol: string }> = {
  movie: { table: 'movies', coverCol: 'poster_path' },
  book: { table: 'books', coverCol: 'cover_path' },
  game: { table: 'games', coverCol: 'cover_path' }
}

class PlaylistDao {
  private db(): Database {
    return getDb()
  }

  list(includeDeleted = false): Playlist[] {
    const sql = `SELECT * FROM playlists ${includeDeleted ? '' : 'WHERE is_deleted=0'}
                 ORDER BY sort_order ASC, updated_at DESC`
    return (this.db().prepare(sql).all() as PlaylistRow[]).map((r) => this.hydrate(r))
  }

  getById(id: string): Playlist | null {
    const row = this.db()
      .prepare(`SELECT * FROM playlists WHERE id=? AND is_deleted=0`)
      .get(id) as PlaylistRow | undefined
    return row ? this.hydrate(row) : null
  }

  // 数量实时统计（仅未软删媒体），不依赖 item_count 缓存列——
  // 媒体软删/硬删不一定会刷新缓存，直接读缓存会显示已删除条目数
  private hydrate(r: PlaylistRow): Playlist {
    const p = rowToPlaylist(r)
    p.itemCount = this.liveCount(r.type, r.id)
    return p
  }

  private liveCount(type: PlaylistType, playlistId: string): number {
    const { table } = MEDIA_TABLE[type]
    const row = this
      .db()
      .prepare(
        `SELECT COUNT(*) AS c FROM playlist_items pi
         JOIN ${table} m ON m.id = pi.item_id AND m.is_deleted = 0
         WHERE pi.playlist_id = ?`
      )
      .get(playlistId) as { c: number }
    return row.c
  }

  insert(input: PlaylistInput): Playlist {
    const now = new Date().toISOString()
    const maxRow = this.db()
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM playlists`)
      .get() as { m: number }
    this.db()
      .prepare(
        `INSERT INTO playlists (id,name,description,type,cover_path,item_count,sort_order,
          is_deleted,created_at,updated_at)
         VALUES (?,?,?,?,?,0,?,0,?,?)`
      )
      .run(
        input.id,
        input.name,
        input.description ?? '',
        input.type,
        strOrNull(input.coverPath),
        maxRow.m + 1,
        now,
        now
      )
    return this.getById(input.id)!
  }

  update(input: PlaylistInput): Playlist {
    this.db()
      .prepare(
        `UPDATE playlists SET name=?,description=?,type=?,cover_path=?,updated_at=? WHERE id=?`
      )
      .run(
        input.name,
        input.description ?? '',
        input.type,
        strOrNull(input.coverPath),
        new Date().toISOString(),
        input.id
      )
    return this.getById(input.id)!
  }

  softDelete(id: string): void {
    const db = this.db()
    db.transaction(() => {
      // 与 Flutter 一致：软删片单时清空条目
      db.prepare(`DELETE FROM playlist_items WHERE playlist_id=?`).run(id)
      db.prepare(`UPDATE playlists SET is_deleted=1,item_count=0,updated_at=? WHERE id=?`).run(
        new Date().toISOString(),
        id
      )
    })()
  }

  restore(id: string): void {
    this.db()
      .prepare(`UPDATE playlists SET is_deleted=0,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    const db = this.db()
    db.transaction(() => {
      db.prepare(`DELETE FROM playlist_items WHERE playlist_id=?`).run(id)
      recordTombstone('playlists', id)
      db.prepare(`DELETE FROM playlists WHERE id=?`).run(id)
    })()
  }

  items(playlistId: string): PlaylistItemView[] {
    const pl = this.getById(playlistId)
    if (!pl) return []
    const { table, coverCol } = MEDIA_TABLE[pl.type]
    const rows = this.db()
      .prepare(
        `SELECT pi.id, pi.item_id, pi.sort_order, pi.added_at,
                m.title, m.${coverCol} AS cover_path, m.status, m.rating, m.is_deleted
         FROM playlist_items pi
         LEFT JOIN ${table} m ON m.id = pi.item_id
         WHERE pi.playlist_id=?
         ORDER BY pi.sort_order ASC, pi.added_at DESC`
      )
      .all(playlistId) as {
      id: string
      item_id: string
      sort_order: number
      added_at: string
      title: string | null
      cover_path: string | null
      status: string | null
      rating: number | null
      is_deleted: number | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      sortOrder: r.sort_order ?? 0,
      addedAt: r.added_at,
      title: r.title ?? '（已删除）',
      coverPath: r.cover_path,
      status: r.status ?? '',
      rating: numOrNull(r.rating),
      isDeleted: r.is_deleted === 1 || r.title == null
    }))
  }

  contains(playlistId: string, itemId: string): boolean {
    return (
      this.db()
        .prepare(
          `SELECT 1 FROM playlist_items WHERE playlist_id=? AND item_id=? LIMIT 1`
        )
        .get(playlistId, itemId) !== undefined
    )
  }

  addItem(playlistId: string, itemId: string): void {
    const db = this.db()
    db.transaction(() => {
      if (this.contains(playlistId, itemId)) return
      const maxRow = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS m FROM playlist_items WHERE playlist_id=?`
        )
        .get(playlistId) as { m: number }
      db.prepare(
        `INSERT INTO playlist_items (id,playlist_id,item_id,sort_order,added_at)
         VALUES (?,?,?,?,?)`
      ).run(
        randomUUID(),
        playlistId,
        itemId,
        maxRow.m + 1,
        new Date().toISOString()
      )
      this.refreshItemCount(db, playlistId)
    })()
  }

  removeItem(playlistItemId: string, playlistId: string): void {
    const db = this.db()
    db.transaction(() => {
      db.prepare(`DELETE FROM playlist_items WHERE id=?`).run(playlistItemId)
      this.refreshItemCount(db, playlistId)
    })()
  }

  // 媒体彻底删除后：清掉相关条目并重算计数（媒体 DAO 事务外调用也可）
  onMediaPurged(itemId: string, type: PlaylistType): void {
    const db = this.db()
    const rows = db
      .prepare(
        `SELECT DISTINCT playlist_id FROM playlist_items WHERE item_id=?
         AND playlist_id IN (SELECT id FROM playlists WHERE type=?)`
      )
      .all(itemId, type) as { playlist_id: string }[]
    if (!rows.length) return
    db.transaction(() => {
      db.prepare(
        `DELETE FROM playlist_items WHERE item_id=?
         AND playlist_id IN (SELECT id FROM playlists WHERE type=?)`
      ).run(itemId, type)
      for (const r of rows) this.refreshItemCount(db, r.playlist_id)
    })()
  }

  // 与 Flutter _refreshItemCount 同口径：只统计未软删媒体
  private refreshItemCount(db: Database, playlistId: string): void {
    const row = db
      .prepare(`SELECT type FROM playlists WHERE id=?`)
      .get(playlistId) as { type: PlaylistType } | undefined
    if (!row) return
    const { table } = MEDIA_TABLE[row.type]
    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM playlist_items pi
         JOIN ${table} m ON m.id = pi.item_id AND m.is_deleted = 0
         WHERE pi.playlist_id=?`
      )
      .get(playlistId) as { c: number }
    db.prepare(`UPDATE playlists SET item_count=?,updated_at=? WHERE id=?`).run(
      count.c,
      new Date().toISOString(),
      playlistId
    )
  }
}

export const playlistDao = new PlaylistDao()
