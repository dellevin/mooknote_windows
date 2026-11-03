import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import {
  readerDbPath,
  readerLibraryDir,
  readerCoversDir,
  getDataRoot
} from '../paths'
import { getReaderDb, openReaderDatabase, closeReaderDatabase } from './db'

// 备份包结构：
//   manifest.json  —— 版本/导出时间，恢复时校验
//   reader.db      —— 元数据/进度/批注/分类
//   library/       —— 电子书文件（<id>.epub ...）
//   covers/        —— 封面图片
export const BACKUP_EXT = 'mookreader'
const BACKUP_VERSION = 1

interface BackupManifest {
  app: string
  version: number
  exportedAt: number
}

function addFolderToZip(zip: AdmZip, absDir: string, zipDir: string): void {
  if (!fs.existsSync(absDir)) return
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name)
    if (fs.statSync(abs).isFile()) zip.addLocalFile(abs, zipDir)
  }
}

// 导出：先把 WAL 合并进主库，再连同书库文件/封面打包
export function exportReaderBackup(targetPath: string): void {
  getReaderDb().pragma('wal_checkpoint(TRUNCATE)')

  const zip = new AdmZip()
  const manifest: BackupManifest = {
    app: 'mooknote-reader',
    version: BACKUP_VERSION,
    exportedAt: Date.now()
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  const dbFile = readerDbPath()
  if (fs.existsSync(dbFile)) zip.addLocalFile(dbFile)
  addFolderToZip(zip, readerLibraryDir(), 'library')
  addFolderToZip(zip, readerCoversDir(), 'covers')

  zip.writeZip(targetPath)
}

// 恢复：校验包 → 关闭数据库 → 覆盖 db 与目录 → 下次访问自动重开
export function importReaderBackup(srcPath: string): { books: number } {
  const zip = new AdmZip(srcPath)

  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) throw new Error('不是有效的书库备份：缺少 manifest.json')
  let manifest: Partial<BackupManifest>
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf-8'))
  } catch {
    throw new Error('备份清单已损坏')
  }
  if (manifest.app !== 'mooknote-reader') throw new Error('不是 MookNote 书库备份')
  if (!zip.getEntry('reader.db')) throw new Error('备份缺少数据库文件')

  const dataRoot = getDataRoot()
  const dbFile = readerDbPath()

  closeReaderDatabase()

  // 清理旧的 db 及 WAL/SHM，避免残留页干扰
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbFile + suffix, { force: true })
  }
  fs.rmSync(readerLibraryDir(), { recursive: true, force: true })
  fs.rmSync(readerCoversDir(), { recursive: true, force: true })
  fs.mkdirSync(readerLibraryDir(), { recursive: true })
  fs.mkdirSync(readerCoversDir(), { recursive: true })

  zip.extractEntryTo('reader.db', dataRoot, false, true)

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (entry.entryName.startsWith('library/')) {
      const name = path.basename(entry.entryName)
      if (name) fs.writeFileSync(path.join(readerLibraryDir(), name), entry.getData())
    } else if (entry.entryName.startsWith('covers/')) {
      const name = path.basename(entry.entryName)
      if (name) fs.writeFileSync(path.join(readerCoversDir(), name), entry.getData())
    }
  }

  // 重新打开连接（close 后 getReaderDb 不会自动重开，必须用 open）并统计书籍数
  const row = openReaderDatabase()
    .prepare('SELECT COUNT(*) AS n FROM reader_books')
    .get() as { n: number }
  return { books: row.n }
}
