import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDb } from '../db'
import { getDataRoot, imagesRoot } from '../paths'
import { prefs } from '../prefs'

// 含单张图片路径字段的结构：[表名, 列名][]
const SINGLE_IMAGE_COLS: Array<[string, string]> = [
  ['movies', 'poster_path'],
  ['books', 'cover_path'],
  ['movie_posters', 'poster_path'],
  ['games', 'cover_path'],
  ['game_screenshots', 'screenshot_path'],
  ['people', 'photo_path'],
  ['movie_characters', 'image_path'],
  ['book_characters', 'image_path'],
  ['game_characters', 'image_path'],
  ['custom_module_items', 'cover_path']
]

// 含图片路径 JSON 数组字段的结构
const JSON_IMAGE_COLS: Array<[string, string]> = [
  ['notes', 'images'],
  ['movie_reviews', 'images'],
  ['book_reviews', 'images'],
  ['game_reviews', 'images'],
  ['movie_episodes', 'images'],
  ['book_chapters', 'images'],
  ['game_levels', 'images']
]

// NOT NULL 的从属图片表：引用失效时删除整行，其余单值字段置空
const DELETE_ROW_TABLES = new Set(['movie_posters', 'game_screenshots'])

/** 把数据库中存储的图片路径解析为真实磁盘绝对路径；无法落到 images 目录则返回 null */
function storedToAbs(raw: string): string | null {
  let p = raw.trim()
  if (!p) return null
  p = p.replace(/^mookimg:\/+/, '')

  // Windows 绝对路径（C:\... 或 C:/...）
  if (/^[A-Za-z]:[\\/]/.test(p)) return p

  // 安卓遗留绝对路径：/data/.../images/<相对路径>
  if (p.startsWith('/data/') || p.startsWith('data/')) {
    const idx = p.indexOf('/images/')
    if (idx >= 0) p = p.slice(idx + '/images/'.length)
  }

  // 其余按 images 下的逻辑相对路径处理（含 POSIX 绝对路径归一化）
  if (path.isAbsolute(p)) {
    const norm = p.replaceAll('\\', '/')
    const idx = norm.indexOf('/images/')
    if (idx < 0) return null
    p = norm.slice(idx + '/images/'.length)
  }
  return path.join(imagesRoot(), ...p.split(/[/\\]/))
}

/** 该引用指向的文件是否存在；无法解析路径视为无效 */
function refExists(raw: string): boolean {
  const abs = storedToAbs(raw)
  return abs ? fs.existsSync(abs) : false
}

function parseStringList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []
  } catch {
    return []
  }
}

interface RefTarget {
  kind: 'single' | 'json' | 'prefs'
  table?: string
  col?: string
  rowid?: number | string
  value: string
}

function tableExists(table: string): boolean {
  const row = getDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table)
  return !!row
}

/** 兼容安卓导入库：表存在但列可能缺失 */
function columnExists(table: string, col: string): boolean {
  const cols = getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[]
  return cols.some((c) => c.name === col)
}

interface JsonRowKey {
  table: string
  col: string
  rid: number | string
}

/** 遍历全库所有图片引用 */
function collectRefs(): RefTarget[] {
  const db = getDb()
  const refs: RefTarget[] = []

  for (const [table, col] of SINGLE_IMAGE_COLS) {
    if (!tableExists(table) || !columnExists(table, col)) continue
    const rows = db
      .prepare(`SELECT rowid AS rid, ${col} AS p FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`)
      .all() as { rid: number; p: string }[]
    for (const r of rows) refs.push({ kind: 'single', table, col, rowid: r.rid, value: r.p })
  }

  for (const [table, col] of JSON_IMAGE_COLS) {
    if (!tableExists(table) || !columnExists(table, col)) continue
    const rows = db
      .prepare(`SELECT rowid AS rid, ${col} AS p FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`)
      .all() as { rid: number; p: string }[]
    for (const r of rows) {
      for (const v of parseStringList(r.p)) {
        refs.push({ kind: 'json', table, col, rowid: r.rid, value: v })
      }
    }
  }

  // 自定义条目 data_json 中的图片（海报字符串、多图列表）
  if (tableExists('custom_module_items') && columnExists('custom_module_items', 'data_json')) {
    const rows = db
      .prepare(
        `SELECT rowid AS rid, data_json FROM custom_module_items
         WHERE data_json IS NOT NULL AND data_json != ''`
      )
      .all() as { rid: number; data_json: string }[]
    for (const r of rows) {
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(r.data_json)
      } catch {
        continue
      }
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && v.replaceAll('\\', '/').includes('/images/')) {
          refs.push({ kind: 'json', table: 'custom_module_items', col: 'data_json', rowid: r.rid, value: v })
        } else if (Array.isArray(v)) {
          for (const e of v) {
            if (typeof e === 'string' && e.replaceAll('\\', '/').includes('/images/')) {
              refs.push({ kind: 'json', table: 'custom_module_items', col: 'data_json', rowid: r.rid, value: e })
            }
          }
        }
      }
    }
  }

  const avatar = prefs.get<string>('avatarPath', '')
  if (avatar) refs.push({ kind: 'prefs', col: 'avatarPath', value: avatar })

  return refs
}

/**
 * 清除无效图片引用：数据库/prefs 中指向已不存在文件的路径。
 * 单值字段置空（NOT NULL 从属表删行），JSON 数组移除对应项，自定义 data_json 同步剔除。
 * removed 为受影响的字段/条目数量。
 */
export function cleanInvalidImageRefs(): { removed: number } {
  const db = getDb()
  let removed = 0

  const tx = db.transaction(() => {
    const refs = collectRefs()

    // 单值字段：从属图片表（海报/截图）删除整行，其余置空
    for (const ref of refs) {
      if (ref.kind !== 'single' || !ref.table || !ref.col || ref.rowid === undefined) continue
      if (refExists(ref.value)) continue
      if (DELETE_ROW_TABLES.has(ref.table)) {
        db.prepare(`DELETE FROM ${ref.table} WHERE rowid = ?`).run(ref.rowid)
      } else {
        db.prepare(`UPDATE ${ref.table} SET ${ref.col} = NULL WHERE rowid = ?`).run(ref.rowid)
      }
      removed++
    }

    // JSON 数组字段：按 表/列/行 聚合，一次性过滤掉无效项
    const jsonRowMap = new Map<string, JsonRowKey>()
    for (const ref of refs) {
      if (
        ref.kind === 'json' &&
        ref.table &&
        ref.col &&
        ref.col !== 'data_json' &&
        ref.rowid !== undefined
      ) {
        jsonRowMap.set(`${ref.table}\u0000${ref.col}\u0000${String(ref.rowid)}`, {
          table: ref.table,
          col: ref.col,
          rid: ref.rowid
        })
      }
    }
    for (const { table, col, rid } of jsonRowMap.values()) {
      const row = db.prepare(`SELECT ${col} AS p FROM ${table} WHERE rowid = ?`).get(rid) as
        | { p: string }
        | undefined
      const list = parseStringList(row?.p)
      const next = list.filter(refExists)
      if (next.length === list.length) continue
      db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).run(JSON.stringify(next), rid)
      removed++
    }

    // 自定义条目 data_json：按行剔除无效图片字符串
    const customRows = new Set<number | string>()
    for (const ref of refs) {
      if (ref.kind === 'json' && ref.table === 'custom_module_items' && ref.rowid !== undefined) {
        customRows.add(ref.rowid)
      }
    }
    for (const rid of customRows) {
      const row = db
        .prepare(`SELECT data_json FROM custom_module_items WHERE rowid = ?`)
        .get(rid) as { data_json: string } | undefined
      if (!row) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(row.data_json)
      } catch {
        continue
      }
      let changed = false
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.replaceAll('\\', '/').includes('/images/') && !refExists(v)) {
          obj[k] = ''
          changed = true
        } else if (Array.isArray(v)) {
          const next = v.filter(
            (e) =>
              !(
                typeof e === 'string' &&
                e.replaceAll('\\', '/').includes('/images/') &&
                !refExists(e)
              )
          )
          if (next.length !== v.length) {
            obj[k] = next
            changed = true
          }
        }
      }
      if (changed) {
        db.prepare(`UPDATE custom_module_items SET data_json = ? WHERE rowid = ?`).run(
          JSON.stringify(obj),
          rid
        )
        removed++
      }
    }

    // 头像 prefs
    const avatar = prefs.get<string>('avatarPath', '')
    if (avatar && !refExists(avatar)) {
      prefs.set('avatarPath', '')
      removed++
    }
  })
  tx()

  return { removed }
}

/**
 * 清理缓存数据：Chromium 可重建的缓存目录 + 残留的应用临时文件。
 * 不触碰数据库、图片、prefs。
 */
export function clearCacheData(): { bytes: number } {
  let bytes = 0

  const cacheDirs = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'ShaderCache',
    'DawnCache'
  ]
  for (const name of cacheDirs) {
    bytes += rmDirSize(path.join(getDataRoot(), name))
  }

  // 残留临时文件：备份/恢复/下载的中间产物
  const tmp = os.tmpdir()
  for (const f of safeReaddir(tmp)) {
    if (
      f.startsWith('mooknote_backup_temp_') ||
      f.startsWith('mooknote_restore_') ||
      f.startsWith('mooknote_download_') ||
      f.startsWith('mooknote_dl_') ||
      f.startsWith('mooknote_shard_')
    ) {
      const fp = path.join(tmp, f)
      bytes += rmPathSize(fp)
      safeRm(fp)
    }
  }

  return { bytes }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function rmDirSize(dir: string): number {
  const size = rmPathSize(dir)
  // 统计完再整体删除
  safeRm(dir)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // 某些缓存目录运行期占用，重建失败也无妨
  }
  return size
}

function rmPathSize(p: string): number {
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    return 0
  }
  if (st.isFile()) return st.size
  let size = 0
  for (const name of safeReaddir(p)) size += rmPathSize(path.join(p, name))
  return size
}

function safeRm(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    // 运行期被占用的文件可能删除失败，忽略
  }
}
