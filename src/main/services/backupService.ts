import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import { getDb } from '../db'
import { imagesRoot } from '../paths'
import { prefs } from '../prefs'

// 与 Flutter BackupService v2 备份完全一致的表集合（顺序即恢复插入顺序）
const BACKUP_TABLES = [
  'movies',
  'books',
  'notes',
  'movie_reviews',
  'movie_posters',
  'book_reviews',
  'book_excerpts',
  'tags',
  'games',
  'game_reviews',
  'game_screenshots',
  'game_completions',
  'movie_episodes',
  'book_chapters',
  'game_levels',
  'people',
  'movie_people',
  'book_people',
  'game_people',
  'playlists',
  'playlist_items',
  'movie_characters',
  'book_characters',
  'game_characters',
  'custom_modules',
  'custom_module_designs',
  'custom_module_items',
  'image_assets'
] as const

// v53 新增表：Flutter 旧端恢复时会忽略未知键，Windows 端互导不丢数据
const EXTRA_TABLES = ['reader_books', 'book_annotations'] as const

// 含图片路径字段的结构：[表名, 列名][]
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
const JSON_IMAGE_COLS: Array<[string, string]> = [
  ['notes', 'images'],
  ['movie_reviews', 'images'],
  ['book_reviews', 'images'],
  ['game_reviews', 'images'],
  ['movie_episodes', 'images'],
  ['book_chapters', 'images'],
  ['game_levels', 'images']
]

export interface BackupStats {
  [label: string]: number
}

export interface RestoreResult {
  success: boolean
  error?: string
  stats?: BackupStats
  imageCount: number
  imageFailures: number
}

/** 绝对路径 → images/ 下相对路径（统一正斜杠，兼容旧路径） */
export function toRelativeImagePath(abs: string): string {
  const normalized = abs.replaceAll('\\', '/')
  const idx = normalized.indexOf('/images/')
  if (idx >= 0) return normalized.slice(idx + '/images/'.length)
  return path.basename(abs)
}

function collectImagePaths(rowsByTable: Record<string, any[]>): Set<string> {
  const out = new Set<string>()
  for (const [table, col] of SINGLE_IMAGE_COLS) {
    for (const row of rowsByTable[table] ?? []) {
      const p = row[col]
      if (typeof p === 'string' && p) out.add(p)
    }
  }
  for (const [table, col] of JSON_IMAGE_COLS) {
    for (const row of rowsByTable[table] ?? []) {
      for (const p of parseStringList(row[col])) out.add(p)
    }
  }
  // 自定义条目 data_json 中的图片值（海报字符串、多图列表）
  for (const row of rowsByTable['custom_module_items'] ?? []) {
    const dj = row['data_json']
    if (typeof dj !== 'string' || !dj) continue
    try {
      const obj = JSON.parse(dj) as Record<string, unknown>
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && v.replaceAll('\\', '/').includes('/images/')) {
          out.add(v)
        } else if (Array.isArray(v)) {
          for (const e of v) {
            if (typeof e === 'string' && e.replaceAll('\\', '/').includes('/images/')) out.add(e)
          }
        }
      }
    } catch {
      // 坏 JSON 跳过
    }
  }
  const avatar = prefs.get<string>('avatarPath', '')
  if (avatar) out.add(avatar)
  return out
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

/** 收集全部表数据 */
function collectRows(): Record<string, any[]> {
  const db = getDb()
  const rows: Record<string, any[]> = {}
  for (const t of BACKUP_TABLES) {
    if (t === 'movie_episodes' || t === 'book_chapters' || t === 'game_levels') {
      rows[t] = db.prepare(`SELECT * FROM ${t} WHERE is_deleted = 0`).all()
    } else {
      rows[t] = db.prepare(`SELECT * FROM ${t}`).all()
    }
  }
  for (const t of EXTRA_TABLES) {
    try {
      rows[t] = db.prepare(`SELECT * FROM ${t}`).all()
    } catch {
      // 旧库无此表
      rows[t] = []
    }
  }
  return rows
}

/**
 * 构建单 zip 备份到临时文件，返回 { zipPath, imageCount }。
 * zip 结构：data.json（DEFLATE）+ images/<相对路径>（STORE），与 Flutter 完全一致。
 */
export function buildBackupZip(): { zipPath: string; imageCount: number } {
  const rows = collectRows()
  const imagePaths = [...collectImagePaths(rows)]

  const data = {
    version: 2,
    exportTime: new Date().toISOString(),
    appName: 'MookNote',
    hasImages: true,
    userInfo: {
      nickname: prefs.get('nickname', ''),
      motto: prefs.get('motto', ''),
      avatarPath: prefs.get('avatarPath', '')
    },
    sharedPrefs: {},
    data: rows
  }

  const zip = new AdmZip()
  zip.addFile('data.json', Buffer.from(JSON.stringify(data, null, 2), 'utf-8'))

  let imageCount = 0
  for (const abs of imagePaths) {
    try {
      if (!fs.existsSync(abs)) continue
      const rel = toRelativeImagePath(abs)
      const buf = fs.readFileSync(abs)
      const entry = zip.addFile(`images/${rel}`, buf)
      entry.header.method = 0 // STORE：图片已压缩，DEFLATE 无收益
      imageCount++
    } catch {
      // 单张失败不阻断备份
    }
  }

  const zipPath = path.join(
    os.tmpdir(),
    `mooknote_backup_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.zip`
  )
  zip.writeZip(zipPath)
  return { zipPath, imageCount }
}

function tableColumns(table: string): Set<string> {
  return new Set(getDb().prepare(`PRAGMA table_info(${table})`).all().map((c: any) => c.name))
}

function remapSingle(row: Record<string, any>, col: string, map: Map<string, string>): void {
  const old = row[col]
  if (typeof old === 'string' && old) {
    const rel = toRelativeImagePath(old)
    const next = map.get(rel)
    if (next) row[col] = next
  }
}

function remapJsonList(row: Record<string, any>, col: string, map: Map<string, string>): void {
  const raw = row[col]
  if (typeof raw !== 'string' || !raw) return
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return
    const next = list.map((p: unknown) =>
      typeof p === 'string' && p ? map.get(toRelativeImagePath(p)) ?? p : p
    )
    row[col] = JSON.stringify(next)
  } catch {
    // 保留原值
  }
}

function remapDataJson(row: Record<string, any>, map: Map<string, string>): void {
  const dj = row['data_json']
  if (typeof dj !== 'string' || !dj) return
  try {
    const obj = JSON.parse(dj) as Record<string, unknown>
    let changed = false
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.replaceAll('\\', '/').includes('/images/')) {
        obj[k] = map.get(toRelativeImagePath(v)) ?? v
        changed = true
      } else if (Array.isArray(v)) {
        obj[k] = v.map((e) =>
          typeof e === 'string' && e.replaceAll('\\', '/').includes('/images/')
            ? map.get(toRelativeImagePath(e)) ?? e
            : e
        )
        changed = true
      }
    }
    if (changed) row['data_json'] = JSON.stringify(obj)
  } catch {
    // 保留原值
  }
}

/**
 * 从备份 zip 恢复。图片先解压到暂存目录，DB 事务成功后才搬入正式目录。
 */
export function restoreFromZip(zipPath: string): RestoreResult {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch (e) {
    return { success: false, error: `无法打开备份文件：${String(e)}`, imageCount: 0, imageFailures: 0 }
  }

  const dataEntry = zip.getEntry('data.json')
  if (!dataEntry) {
    return { success: false, error: '备份文件中没有找到数据文件', imageCount: 0, imageFailures: 0 }
  }

  let backup: any
  try {
    backup = JSON.parse(dataEntry.getData().toString('utf-8'))
  } catch (e) {
    return { success: false, error: `数据文件解析失败：${String(e)}`, imageCount: 0, imageFailures: 0 }
  }
  const data: Record<string, any[]> = backup?.data
  if (!data || typeof data !== 'object') {
    return { success: false, error: '无效的备份文件格式', imageCount: 0, imageFailures: 0 }
  }

  // 图片解压到暂存目录，登记 相对路径 → 正式绝对路径
  const stagingDir = path.join(os.tmpdir(), `mooknote_restore_${Date.now()}`)
  const imgRoot = imagesRoot()
  const pathMap = new Map<string, string>()
  let imageCount = 0
  try {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('images/')) continue
      let rel = entry.entryName.slice('images/'.length).replace(/^[/\\]+/, '')
      if (!rel) continue
      // zip slip 防护
      const segs = rel.split(/[/\\]/)
      if (segs.includes('..') || rel.includes(':')) continue
      rel = rel.split('\\').join('/')
      const staged = path.join(stagingDir, 'images', ...segs)
      fs.mkdirSync(path.dirname(staged), { recursive: true })
      fs.writeFileSync(staged, entry.getData())
      pathMap.set(rel, path.join(imgRoot, ...segs))
      imageCount++
    }
  } catch (e) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    return { success: false, error: `图片解压失败：${String(e)}`, imageCount, imageFailures: 0 }
  }

  const db = getDb()
  // 恢复前关闭 WAL 检查点无所谓；事务内关闭外键以保证任意删除顺序
  db.pragma('foreign_keys = OFF')
  try {
    const tx = db.transaction(() => {
      // 先清空全部已知备份表（含额外表），顺序无所谓（FK 已关）
      for (const t of [...BACKUP_TABLES, ...EXTRA_TABLES]) {
        if (tableExists(db, t)) db.prepare(`DELETE FROM ${t}`).run()
      }

      for (const [table, rows] of Object.entries(data)) {
        if (!tableExists(db, table) || !Array.isArray(rows)) continue
        const cols = tableColumns(table)
        const singleCol = SINGLE_IMAGE_COLS.find(([t]) => t === table)?.[1]
        const jsonCol =
          table === 'custom_module_items' ? null : JSON_IMAGE_COLS.find(([t]) => t === table)?.[1]
        const isCustomItems = table === 'custom_module_items'

        for (const raw of rows) {
          const row: Record<string, any> = {}
          for (const [k, v] of Object.entries(raw)) {
            if (cols.has(k)) row[k] = v === true ? 1 : v === false ? 0 : v
          }
          if (singleCol) remapSingle(row, singleCol, pathMap)
          if (jsonCol) remapJsonList(row, jsonCol, pathMap)
          if (isCustomItems) {
            remapSingle(row, 'cover_path', pathMap)
            remapDataJson(row, pathMap)
          }
          const keys = Object.keys(row)
          if (!keys.length) continue
          const placeholders = keys.map(() => '?').join(', ')
          // 标签表冲突忽略（与 Flutter 一致）
          const orIgnore = table === 'tags' ? ' OR IGNORE' : ''
          db.prepare(
            `INSERT${orIgnore} INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
          ).run(...keys.map((k) => row[k]))
        }
      }
    })
    tx()
  } catch (e) {
    db.pragma('foreign_keys = ON')
    fs.rmSync(stagingDir, { recursive: true, force: true })
    return { success: false, error: `数据库恢复失败：${String(e)}`, imageCount, imageFailures: 0 }
  }
  db.pragma('foreign_keys = ON')

  // DB 已成功：暂存图片搬入正式目录
  let imageFailures = 0
  for (const [rel, target] of pathMap) {
    const staged = path.join(stagingDir, 'images', ...rel.split('/'))
    if (!fs.existsSync(staged)) continue
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(staged, target)
    } catch {
      imageFailures++
    }
  }
  fs.rmSync(stagingDir, { recursive: true, force: true })

  // 用户信息（仅 Windows 端使用的键；sharedPrefs 为平台专属，不整体恢复）
  const userInfo = backup.userInfo
  if (userInfo && typeof userInfo === 'object') {
    if (typeof userInfo.nickname === 'string') prefs.set('nickname', userInfo.nickname)
    if (typeof userInfo.motto === 'string') prefs.set('motto', userInfo.motto)
    if (typeof userInfo.avatarPath === 'string' && userInfo.avatarPath) {
      const rel = toRelativeImagePath(userInfo.avatarPath)
      const target = pathMap.get(rel)
      if (target) prefs.set('avatarPath', target)
    }
  }

  return {
    success: true,
    stats: buildStats(data),
    imageCount,
    imageFailures
  }
}

function tableExists(db: ReturnType<typeof getDb>, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table)
  return !!row
}

function buildStats(data: Record<string, any[]>): BackupStats {
  const labels: Record<string, string> = {
    movies: '影视',
    books: '书籍',
    notes: '笔记',
    movie_reviews: '影评',
    movie_posters: '海报',
    book_reviews: '书评',
    book_excerpts: '书摘',
    tags: '标签',
    games: '游戏',
    game_reviews: '游戏评价',
    game_screenshots: '游戏截图',
    game_completions: '通关记录',
    movie_episodes: '分集',
    book_chapters: '章节',
    game_levels: '关卡',
    people: '人物',
    playlists: '片单',
    custom_modules: '自定义模块',
    custom_module_items: '自定义条目'
  }
  const stats: BackupStats = {}
  for (const [k, label] of Object.entries(labels)) {
    if (Array.isArray(data[k]) && data[k].length) stats[label] = data[k].length
  }
  const chars =
    (data['movie_characters']?.length ?? 0) +
    (data['book_characters']?.length ?? 0) +
    (data['game_characters']?.length ?? 0)
  if (chars) stats['角色'] = chars
  return stats
}

/** 从分片目录恢复（data.zip + images_NNN.zip，Flutter 增量上传的旧格式兼容） */
export function restoreFromShardDir(dirPath: string): RestoreResult {
  const dataZip = path.join(dirPath, 'data.zip')
  if (!fs.existsSync(dataZip)) {
    return { success: false, error: '备份目录中缺少 data.zip', imageCount: 0, imageFailures: 0 }
  }
  const tmpZip = path.join(os.tmpdir(), `mooknote_shard_${Date.now()}.zip`)
  try {
    const merged = new AdmZip()
    merged.addFile('data.json', new AdmZip(dataZip).getEntry('data.json')!.getData())
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.startsWith('images_') || !name.endsWith('.zip')) continue
      const shard = new AdmZip(path.join(dirPath, name))
      for (const e of shard.getEntries()) {
        if (!e.isDirectory) merged.addFile(e.entryName, e.getData())
      }
    }
    merged.writeZip(tmpZip)
    return restoreFromZip(tmpZip)
  } catch (e) {
    return { success: false, error: `分片备份合并失败：${String(e)}`, imageCount: 0, imageFailures: 0 }
  } finally {
    try {
      fs.rmSync(tmpZip, { force: true })
    } catch {
      // ignore
    }
  }
}
