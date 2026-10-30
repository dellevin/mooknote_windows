import { getDb } from '../../db'

// sync_meta 表 KV 存取（增量同步 v2），键名与 Flutter 一致。
export const K_MANIFEST_VERSION = 'inc2_manifest_v'
export const K_SEEN_CHUNKS = 'inc2_seen_chunks'
export const K_IMAGE_MAP = 'inc2_image_map'
export const K_PUSH_AFTER = 'inc2_push_after'
export const K_APPLIED_DELTAS = 'inc2_applied_deltas'
export const K_LAST_SYNC = 'inc_last_sync'

function stmtGet() {
  return getDb().prepare('SELECT value FROM sync_meta WHERE key = ?')
}

export function metaGet(key: string): string | null {
  const row = stmtGet().get(key) as { value: string | null } | undefined
  return row ? (row.value ?? null) : null
}

export function metaSet(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function metaGetInt(key: string): number | null {
  const v = metaGet(key)
  if (v === null) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

export function getSeenChunks(): Set<string> {
  const v = metaGet(K_SEEN_CHUNKS)
  if (!v) return new Set()
  try {
    return new Set((JSON.parse(v) as unknown[]).map(String))
  } catch {
    return new Set()
  }
}

export function setSeenChunks(hashes: Set<string>): void {
  metaSet(K_SEEN_CHUNKS, JSON.stringify([...hashes]))
}

export function getImageMap(): Record<string, string> {
  const v = metaGet(K_IMAGE_MAP)
  if (!v) return {}
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(v) as Record<string, unknown>).map(([k, e]) => [k, String(e)])
    )
  } catch {
    return {}
  }
}

export function setImageMap(map: Record<string, string>): void {
  metaSet(K_IMAGE_MAP, JSON.stringify(map))
}

export function getAppliedDeltas(): Set<string> {
  const v = metaGet(K_APPLIED_DELTAS)
  if (!v) return new Set()
  try {
    return new Set((JSON.parse(v) as unknown[]).map(String))
  } catch {
    return new Set()
  }
}

export function setAppliedDeltas(names: Set<string>): void {
  metaSet(K_APPLIED_DELTAS, JSON.stringify([...names]))
}
