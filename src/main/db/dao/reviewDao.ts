import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, strOrNull } from '../util'
import type { Review, ReviewInput, ReviewKind } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

// 三类评价表名与外键列
const TABLE: Record<ReviewKind, { table: string; fk: string }> = {
  movie: { table: 'movie_reviews', fk: 'movie_id' },
  book: { table: 'book_reviews', fk: 'book_id' },
  game: { table: 'game_reviews', fk: 'game_id' }
}

interface ReviewRow {
  id: string
  parent: string
  content: string
  reviewer: string | null
  source: string | null
  review_type: number
  review_date: string | null
  images: string | null
  is_deleted: number
  created_at: string
  updated_at: string
}

class ReviewDao {
  private db(): Database {
    return getDb()
  }

  private row(kind: ReviewKind, r: Record<string, unknown>): Review {
    const fk = TABLE[kind].fk
    return {
      id: r['id'] as string,
      parentId: r[fk] as string,
      content: r['content'] as string,
      reviewer: (r['reviewer'] as string | null) ?? null,
      source: (r['source'] as string | null) ?? null,
      reviewType: (r['review_type'] as number) === 2 ? 2 : 1,
      reviewDate: (r['review_date'] as string | null) ?? null,
      images: parseStringList(r['images']),
      isDeleted: r['is_deleted'] === 1,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string
    }
  }

  listByParent(kind: ReviewKind, parentId: string, includeDeleted = false): Review[] {
    const { table, fk } = TABLE[kind]
    const rows = this.db()
      .prepare(
        `SELECT * FROM ${table} WHERE ${fk}=? AND is_deleted=? ORDER BY review_type ASC, datetime(review_date) DESC, created_at DESC`
      )
      .all(parentId, includeDeleted ? 1 : 0) as Record<string, unknown>[]
    return rows.map((r) => this.row(kind, r))
  }

  insert(kind: ReviewKind, input: ReviewInput): void {
    const { table, fk } = TABLE[kind]
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO ${table} (id,${fk},content,reviewer,source,review_type,review_date,images,is_deleted,created_at,updated_at)
         VALUES (@id,@parent,@content,@reviewer,@source,@review_type,@review_date,@images,0,@created_at,@updated_at)`
      )
      .run({
        id: input.id,
        parent: input.parentId,
        content: input.content,
        reviewer: strOrNull(input.reviewer),
        source: strOrNull(input.source),
        review_type: input.reviewType,
        review_date: strOrNull(input.reviewDate),
        images: encodeList(input.images),
        created_at: now,
        updated_at: now
      })
  }

  update(kind: ReviewKind, input: ReviewInput): void {
    const { table, fk } = TABLE[kind]
    this.db()
      .prepare(
        `UPDATE ${table} SET ${fk}=@parent,content=@content,reviewer=@reviewer,source=@source,
          review_type=@review_type,review_date=@review_date,images=@images,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({
        id: input.id,
        parent: input.parentId,
        content: input.content,
        reviewer: strOrNull(input.reviewer),
        source: strOrNull(input.source),
        review_type: input.reviewType,
        review_date: strOrNull(input.reviewDate),
        images: encodeList(input.images),
        updated_at: new Date().toISOString()
      })
  }

  softDelete(kind: ReviewKind, id: string): void {
    const { table } = TABLE[kind]
    this.db()
      .prepare(`UPDATE ${table} SET is_deleted=1,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  permanentDelete(kind: ReviewKind, id: string): void {
    const { table } = TABLE[kind]
    recordTombstone(table, id)
    this.db().prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
  }
}

export const reviewDao = new ReviewDao()
