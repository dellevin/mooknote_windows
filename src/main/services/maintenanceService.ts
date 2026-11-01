import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDb } from '../db'
import { getDataRoot, imagesRoot } from '../paths'
import { prefs } from '../prefs'
import { recordTombstone } from './sync/syncTombstones'
import { touchParent } from './sync/touchParent'

// 软删子组行物理清除后需 touch 仍存活的父行，使整组重推（与单条删除口径一致）
const SOFT_GROUP_PARENTS: Record<string, { col: string; parent: string }> = {
  movie_episodes: { col: 'movie_id', parent: 'movies' },
  movie_posters: { col: 'movie_id', parent: 'movies' },
  book_chapters: { col: 'book_id', parent: 'books' },
  game_levels: { col: 'game_id', parent: 'games' },
  game_screenshots: { col: 'game_id', parent: 'games' }
}

// 有外键子表的父实体：物理清除软删父行时，必须与各 DAO 的 permanentDelete
// 同口径先删子行，否则直接 DELETE 父行会触发 FOREIGN KEY constraint failed。
const PURGE_CASCADES: Array<{
  parent: string
  children: Array<[string, string]>
  /** 媒体父表：同时清掉 playlist_items 中对该媒体的引用 */
  playlistMedia?: boolean
}> = [
  {
    parent: 'movies',
    children: [
      ['movie_reviews', 'movie_id'],
      ['movie_posters', 'movie_id'],
      ['movie_episodes', 'movie_id'],
      ['movie_people', 'movie_id'],
      ['movie_characters', 'movie_id']
    ],
    playlistMedia: true
  },
  {
    parent: 'books',
    children: [
      ['book_reviews', 'book_id'],
      ['book_excerpts', 'book_id'],
      ['book_chapters', 'book_id'],
      ['book_people', 'book_id'],
      ['book_characters', 'book_id']
    ],
    playlistMedia: true
  },
  {
    parent: 'games',
    children: [
      ['game_reviews', 'game_id'],
      ['game_screenshots', 'game_id'],
      ['game_completions', 'game_id'],
      ['game_levels', 'game_id'],
      ['game_people', 'game_id'],
      ['game_characters', 'game_id']
    ],
    playlistMedia: true
  },
  {
    parent: 'people',
    children: [
      ['movie_people', 'person_id'],
      ['book_people', 'person_id'],
      ['game_people', 'person_id']
    ]
  },
  {
    parent: 'playlists',
    children: [['playlist_items', 'playlist_id']]
  }
]

// 物理清除需落墓碑的行级同步实体（与各 DAO permanentDelete 口径一致），
// 否则其他设备增量同步时这些行会被复活。
const TOMBSTONE_TABLES = new Set([
  'movies',
  'books',
  'games',
  'people',
  'notes',
  'playlists',
  'movie_reviews',
  'book_reviews',
  'game_reviews',
  'book_excerpts',
  'movie_characters',
  'book_characters',
  'game_characters',
  'custom_module_items'
])

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
  ['custom_module_items', 'cover_path'],
  ['image_assets', 'path']
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
 * 清理缓存数据：Chromium 可重建的缓存目录 + 残留的应用临时文件，
 * 并删除数据库已不引用的孤立图片文件（对齐手机 CacheCleaner），
 * 顺带清掉 image_assets 中对应的孤儿改名记录。
 */
export function clearCacheData(): { bytes: number; orphanImages: number; emptyDirs: number } {
  let bytes = 0

  // 孤立图片：磁盘有、但数据库/prefs 已不引用（删除笔记/影评等后的残留）
  const referenced = collectReferenced()
  const orphans = cleanOrphanImageFiles(referenced.abs)
  bytes += orphans.bytes
  deleteOrphanImageAssets(referenced.logical)
  // 删完孤立图片后顺带清掉残留空目录
  const emptyDirs = cleanEmptyImageDirs().removed

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

  return { bytes, orphanImages: orphans.count, emptyDirs }
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

function safeRm(p: string): boolean {
  try {
    fs.rmSync(p, { recursive: true, force: true })
    return true
  } catch {
    // 运行期被占用的文件可能删除失败，忽略
    return false
  }
}

/** 任意设备绝对/相对路径 → images/ 下逻辑路径（对齐手机 ImageAssetDao.toLogicalPath） */
function toLogical(raw: string): string {
  const n = String(raw).replaceAll('\\', '/')
  const idx = n.indexOf('/images/')
  return idx >= 0 ? n.slice(idx + '/images/'.length) : n
}

function normAbs(p: string): string {
  return path.resolve(p).replaceAll('\\', '/').toLowerCase()
}

/**
 * 收集当前被数据库/prefs 实际引用的图片：归一化绝对路径集合（用于孤立文件判定）
 * 与逻辑路径集合（用于清理 image_assets 派生索引）。
 * image_assets 本身是派生索引，不计入引用来源（与手机 getAllDbImagePaths 口径一致）。
 */
function collectReferenced(): { abs: Set<string>; logical: Set<string> } {
  const abs = new Set<string>()
  const logical = new Set<string>()
  for (const ref of collectRefs()) {
    if (ref.table === 'image_assets') continue
    logical.add(toLogical(ref.value))
    const a = storedToAbs(ref.value)
    if (a) abs.add(normAbs(a))
  }
  return { abs, logical }
}

/** 删除 images/ 下数据库已不引用的孤立图片文件（不删 avatar*），返回文件数与字节数 */
function cleanOrphanImageFiles(referencedAbs: Set<string>): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  const walk = (dir: string): void => {
    for (const name of safeReaddir(dir)) {
      const fp = path.join(dir, name)
      let st: fs.Stats
      try {
        st = fs.statSync(fp)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(fp)
      } else if (st.isFile()) {
        if (name.startsWith('avatar')) continue
        if (referencedAbs.has(normAbs(fp))) continue
        if (safeRm(fp)) {
          count++
          bytes += st.size
        }
      }
    }
  }
  walk(imagesRoot())
  return { count, bytes }
}

/** 删除 image_assets 中逻辑路径已不属于任何实体的改名记录（缓存清理时调用） */
function deleteOrphanImageAssets(validLogical: Set<string>): number {
  if (!tableExists('image_assets')) return 0
  const db = getDb()
  const rows = db.prepare('SELECT rowid AS rid, path FROM image_assets').all() as {
    rid: number
    path: string
  }[]
  const del = db.prepare('DELETE FROM image_assets WHERE rowid = ?')
  let removed = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (!validLogical.has(toLogical(r.path))) {
        del.run(r.rid)
        removed++
      }
    }
  })
  tx()
  return removed
}

/**
 * 物理清除所有表中 is_deleted=1 的软删除行（不可恢复）。
 * 其图片文件会成为孤立文件，可随后用「清理缓存数据」回收磁盘空间。
 * 返回删除行数与涉及表数。
 */
export function purgeSoftDeleted(): { rows: number; tables: number } {
  const db = getDb()
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[]
  ).map((r) => r.name)
  let rows = 0
  const tablesHit = new Set<string>()
  const tx = db.transaction(() => {
    // 1) 有外键子表的父实体：按单条永久删除的同口径级联清除
    for (const cfg of PURGE_CASCADES) {
      if (!tableExists(cfg.parent) || !columnExists(cfg.parent, 'is_deleted')) continue
      const ids = (
        db.prepare(`SELECT id FROM ${cfg.parent} WHERE is_deleted = 1`).all() as { id: string }[]
      ).map((r) => r.id)
      if (!ids.length) continue
      for (const id of ids) {
        for (const [child, col] of cfg.children) {
          if (!tableExists(child)) continue
          const info = db.prepare(`DELETE FROM ${child} WHERE ${col} = ?`).run(id)
          if (info.changes > 0) tablesHit.add(child)
          rows += info.changes
        }
        if (cfg.playlistMedia && tableExists('playlist_items')) {
          const info = db.prepare(`DELETE FROM playlist_items WHERE item_id = ?`).run(id)
          if (info.changes > 0) tablesHit.add('playlist_items')
          rows += info.changes
        }
        recordTombstone(cfg.parent, id)
        db.prepare(`DELETE FROM ${cfg.parent} WHERE id = ?`).run(id)
        tablesHit.add(cfg.parent)
        rows++
      }
    }

    // 2) 其余含 is_deleted 的表直接清扫（独立实体与已无父行的子表残留）
    for (const table of tables) {
      if (!columnExists(table, 'is_deleted')) continue
      if (TOMBSTONE_TABLES.has(table)) {
        const ids = (
          db.prepare(`SELECT id FROM ${table} WHERE is_deleted = 1`).all() as { id: string }[]
        ).map((r) => r.id)
        for (const id of ids) recordTombstone(table, id)
      }
      // 子组行：记下仍存活的父行，清除后 touch 触发整组重推
      const groupSpec = SOFT_GROUP_PARENTS[table]
      let liveParents: string[] = []
      if (groupSpec) {
        liveParents = (
          db
            .prepare(
              `SELECT DISTINCT g.${groupSpec.col} AS pid FROM ${table} g
               JOIN ${groupSpec.parent} p ON p.id = g.${groupSpec.col}
               WHERE g.is_deleted = 1 AND p.is_deleted = 0`
            )
            .all() as { pid: string }[]
        ).map((r) => r.pid)
      }
      const info = db.prepare(`DELETE FROM ${table} WHERE is_deleted = 1`).run()
      if (info.changes > 0) tablesHit.add(table)
      rows += info.changes
      for (const pid of liveParents) touchParent(groupSpec.parent, pid)
    }
  })
  tx()
  return { rows, tables: tablesHit.size }
}

/**
 * 清理 images/ 下的空文件夹（自底向上；保留 images 根目录本身）。
 * 删除孤立图片后常残留空的实体目录。返回删除的空文件夹数。
 */
export function cleanEmptyImageDirs(): { removed: number } {
  let removed = 0
  const root = imagesRoot()
  const prune = (dir: string): void => {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const fp = path.join(dir, name)
      let st: fs.Stats
      try {
        st = fs.statSync(fp)
      } catch {
        continue
      }
      if (st.isDirectory()) prune(fp)
    }
    if (dir !== root) {
      try {
        const left = fs.readdirSync(dir)
        if (left.length === 0 && safeRm(dir)) removed++
      } catch {
        // 删除失败（占用/权限）忽略
      }
    }
  }
  prune(root)
  return { removed }
}
