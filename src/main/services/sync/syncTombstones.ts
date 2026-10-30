import { getDb } from '../../db'
import { clientId } from './syncIdentity'

// 增量同步墓碑：记录本客户端的彻底删除，供推送时生成删除 op。
// 表 sync_tombstones(entity_id, entity_type, deleted_at, client_id, pushed)。

export interface TombRow {
  entity_id: string
  entity_type: string
  deleted_at: string
  client_id: string
  pushed: number
}

/**
 * 记录一次彻底删除。可在 better-sqlite3 事务回调内调用（同一连接），
 * 从而与删除操作在同一事务原子提交。失败不阻塞删除本身。
 */
export function recordTombstone(entityType: string, entityId: string): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO sync_tombstones (entity_id, entity_type, deleted_at, client_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entity_id, entity_type) DO UPDATE SET
           deleted_at = excluded.deleted_at, client_id = excluded.client_id, pushed = 0`
      )
      .run(entityId, entityType, new Date().toISOString(), clientId())
  } catch {
    // 墓碑写入失败不应阻塞删除
  }
}

/** 待推送墓碑（pushed=0） */
export function takePending(): TombRow[] {
  return getDb().prepare('SELECT * FROM sync_tombstones WHERE pushed = 0').all() as TombRow[]
}

/** 推送成功后标记已推送（记录保留，待压实嵌入 manifest 后清除） */
export function markPushed(rows: TombRow[]): void {
  const stmt = getDb().prepare(
    'UPDATE sync_tombstones SET pushed = 1 WHERE entity_id = ? AND entity_type = ?'
  )
  for (const r of rows) stmt.run(r.entity_id, r.entity_type)
}

/** 全部墓碑（含已推送），构建/压实 manifest 用 */
export function allTombstones(): TombRow[] {
  return getDb().prepare('SELECT * FROM sync_tombstones').all() as TombRow[]
}

/** 墓碑已嵌入 manifest 后清除对应记录 */
export function clearEmbedded(rows: TombRow[]): void {
  const stmt = getDb().prepare(
    'DELETE FROM sync_tombstones WHERE entity_id = ? AND entity_type = ?'
  )
  for (const r of rows) stmt.run(r.entity_id, r.entity_type)
}

/** 应用远程删除时本地落墓碑，防止被旧快照/旧 delta 复活 */
export function recordRemote(
  entityType: string,
  entityId: string,
  deletedAt: string,
  originClientId: string
): void {
  const db = getDb()
  const existing = db
    .prepare('SELECT deleted_at FROM sync_tombstones WHERE entity_id = ? AND entity_type = ?')
    .get(entityId, entityType) as { deleted_at: string } | undefined
  if (existing) {
    // 同 ID 重建后又被删除：保留最新删除时间
    if (existing.deleted_at && existing.deleted_at >= deletedAt) return
    db.prepare(
      'UPDATE sync_tombstones SET deleted_at = ?, client_id = ?, pushed = 0 WHERE entity_id = ? AND entity_type = ?'
    ).run(deletedAt, originClientId, entityId, entityType)
    return
  }
  db.prepare(
    'INSERT INTO sync_tombstones (entity_id, entity_type, deleted_at, client_id) VALUES (?, ?, ?, ?)'
  ).run(entityId, entityType, deletedAt, originClientId)
}
