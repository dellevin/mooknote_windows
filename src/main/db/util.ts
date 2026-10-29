// 行 <-> 模型 转换辅助

// 兼容 JSON 数组 / 逗号分隔串 / 单值（对齐 Flutter parseStringListGeneric）
export function parseStringList(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0)
  const raw = String(value).trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.map((v) => String(v)).filter((s) => s.length > 0)
    } catch {
      /* fall through */
    }
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function encodeList(list: string[] | null | undefined): string {
  return JSON.stringify(list ?? [])
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.length ? s : null
}

// 兼容老设备 SQLite（避免 NULLS LAST）：空值排尾
export const MOVIE_ORDER_BY: Record<number, string> = {
  0: 'updated_at DESC',
  1: 'created_at DESC',
  2: 'rating IS NULL, rating DESC, updated_at DESC',
  3: 'watch_date IS NULL, watch_date DESC, created_at DESC',
  4: 'release_date IS NULL, release_date DESC, created_at DESC'
}
