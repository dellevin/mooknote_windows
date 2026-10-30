import path from 'node:path'
import type { IncEntitySpec } from './incEntities'
import { groupImageColumn, groupSpecOf } from './incEntities'
import type { Row } from './incProtocol'

// 行内图片路径的逻辑化/本地化处理（与 Flutter inc_row_codec.dart 一致）。

/** 任意设备绝对路径 → images/ 下逻辑路径 */
export function toLogical(absPath: string): string {
  const normalized = absPath.replaceAll('\\', '/')
  const idx = normalized.indexOf('/images/')
  if (idx >= 0) return normalized.substring(idx + '/images/'.length)
  return path.basename(absPath)
}

/** 字符串是否为 app 图片路径 */
export function isImagePath(v: string): boolean {
  return v.replaceAll('\\', '/').includes('/images/')
}

/** 规整逻辑路径：剔除空段、`.`、`..`，只能落在 images 根目录之内（ZipSlip 防护） */
export function sanitizeLogical(logical: string): string {
  return logical
    .replaceAll('\\', '/')
    .split('/')
    .filter((s) => s.length && s !== '.' && s !== '..')
    .join('/')
}

export class IncRowCodec {
  constructor(private readonly imagesRoot: string) {}

  /** 逻辑路径 → 本机绝对路径 */
  localPathOf(logical: string): string {
    return path.join(this.imagesRoot, sanitizeLogical(logical))
  }

  /** 将远程父行内图片路径改写为本机绝对路径 */
  localize(row: Row, spec: IncEntitySpec): Row {
    const out: Row = { ...row }
    for (const col of spec.imageColumns) {
      const v = out[col]
      if (typeof v === 'string' && v) out[col] = this.localPathOf(toLogical(v))
    }
    const jsonCol = spec.imageJsonColumn
    if (jsonCol) {
      const v = out[jsonCol]
      if (typeof v === 'string' && v) {
        try {
          const list = JSON.parse(v) as unknown[]
          out[jsonCol] = JSON.stringify(
            list.filter((e): e is string => typeof e === 'string').map((e) => this.localPathOf(toLogical(e)))
          )
        } catch {
          /* 保留原值 */
        }
      }
    }
    const mapCol = spec.imageJsonMapColumn
    if (mapCol) {
      const v = out[mapCol]
      if (typeof v === 'string' && v) {
        try {
          const map = JSON.parse(v) as Record<string, unknown>
          const updated: Record<string, unknown> = { ...map }
          let changed = false
          for (const [k, val] of Object.entries(map)) {
            if (typeof val === 'string' && isImagePath(val)) {
              updated[k] = this.localPathOf(toLogical(val))
              changed = true
            } else if (Array.isArray(val)) {
              updated[k] = val.map((e) =>
                typeof e === 'string' && isImagePath(e) ? this.localPathOf(toLogical(e)) : e
              )
              changed = true
            }
          }
          if (changed) out[mapCol] = JSON.stringify(updated)
        } catch {
          /* 保留原值 */
        }
      }
    }
    return out
  }

  /** 将子表行内图片路径改写为本机绝对路径 */
  localizeGroupRows(groupTable: string, rows: Row[]): Row[] {
    const imgCol = groupImageColumn(groupTable)
    const jsonCol = groupSpecOf(groupTable)?.imageJsonColumn ?? null
    if (!imgCol && !jsonCol) return rows
    return rows.map((r) => {
      const out: Row = { ...r }
      if (imgCol) {
        const v = out[imgCol]
        if (typeof v === 'string' && v) out[imgCol] = this.localPathOf(toLogical(v))
      }
      if (jsonCol) {
        const v = out[jsonCol]
        if (typeof v === 'string' && v) {
          try {
            const list = JSON.parse(v) as unknown[]
            out[jsonCol] = JSON.stringify(
              list.filter((e): e is string => typeof e === 'string').map((e) => this.localPathOf(toLogical(e)))
            )
          } catch {
            /* 保留原值 */
          }
        }
      }
      return out
    })
  }

  /** 解析 JSON 数组图片列，返回其中逻辑路径 */
  logicalFromJsonList(json: string | null | undefined): string[] {
    if (!json) return []
    try {
      return (JSON.parse(json) as unknown[])
        .filter((e): e is string => typeof e === 'string' && e.length > 0)
        .map((e) => toLogical(e))
    } catch {
      return []
    }
  }

  /** 收集父行当前引用的逻辑路径 */
  referencedLogical(row: Row, spec: IncEntitySpec): string[] {
    const result = new Set<string>()
    for (const col of spec.imageColumns) {
      const v = row[col]
      if (typeof v === 'string' && v) result.add(toLogical(v))
    }
    const jsonCol = spec.imageJsonColumn
    if (jsonCol) {
      const v = row[jsonCol]
      if (typeof v === 'string' && v) {
        try {
          for (const e of JSON.parse(v) as unknown[]) {
            if (typeof e === 'string' && e) result.add(toLogical(e))
          }
        } catch {
          /* ignore */
        }
      }
    }
    const mapCol = spec.imageJsonMapColumn
    if (mapCol) {
      const v = row[mapCol]
      if (typeof v === 'string' && v) {
        try {
          for (const val of Object.values(JSON.parse(v) as Record<string, unknown>)) {
            if (typeof val === 'string' && isImagePath(val)) {
              result.add(toLogical(val))
            } else if (Array.isArray(val)) {
              for (const e of val) {
                if (typeof e === 'string' && isImagePath(e)) result.add(toLogical(e))
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return [...result]
  }
}
