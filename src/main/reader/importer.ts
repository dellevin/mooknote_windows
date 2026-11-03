import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readerLibraryDir, readerCoversDir } from '../paths'

// 封面文件名转 mookimg 可显示 URL（mookimg 协议对存在的绝对路径直接放行）
function coverUrl(coverFile: string | null): string | null {
  if (!coverFile) return null
  const abs = path.join(readerCoversDir(), coverFile).replace(/\\/g, '/')
  return `mookimg:///${abs}`
}
import { getReaderDb } from './db'
import { registerBookFile, startReaderServer } from './server'
import { readerWindowIcon } from './appIcon'
import { convertTxtToEpub } from './txtEpub'
import type { ReaderBook } from '../../shared/types'

// foliate-js 不支持 RAR，故不提供 cbr
const SUPPORTED_EXT = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'fbz', 'cbz', 'txt']

interface FoliateMetadata {
  title?: unknown
  creator?: unknown
  author?: unknown
  publisher?: unknown
  cover?: string | null
}

// foliate-js 的元数据字段可能是字符串、{ value } 对象或它们的数组
function flattenField(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v)) {
    const parts = v.map(flattenField).filter((x): x is string => !!x)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return flattenField(o.value ?? o.name ?? o.title)
  }
  return null
}

let importWin: BrowserWindow | null = null
// 串行导入：当前等待 onMetadata 的一回 Promise
let pending: {
  resolve: (meta: FoliateMetadata | null) => void
  timer: ReturnType<typeof setTimeout>
} | null = null

// 监听 foliate-js 在 importing 模式提取后回传的 onMetadata（模块级只注册一次）
ipcMain.on('reader:event', (e, name: string, data: unknown) => {
  if (!pending || !importWin || e.sender !== importWin.webContents) return
  if (name !== 'onMetadata') return
  const meta = (data ?? {}) as FoliateMetadata
  clearTimeout(pending.timer)
  const resolve = pending.resolve
  pending = null
  resolve(meta)
})

function buildImportUrl(port: number, bookUrl: string): string {
  const params = new URLSearchParams({
    importing: JSON.stringify(true),
    url: JSON.stringify(bookUrl),
    initialCfi: JSON.stringify(''),
    style: JSON.stringify({}),
    readingRules: JSON.stringify({})
  })
  return `http://127.0.0.1:${port}/reader.html?${params.toString()}`
}

async function ensureImportWindow(): Promise<BrowserWindow> {
  if (importWin && !importWin.isDestroyed()) return importWin
  importWin = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    ...readerWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  importWin.on('closed', () => {
    importWin = null
    if (pending) {
      clearTimeout(pending.timer)
      const resolve = pending.resolve
      pending = null
      resolve(null)
    }
  })
  return importWin
}

// 用 foliate-js importing 模式提取元数据与封面；超时/失败返回 null（调用方兜底）
async function extractMetadata(bookFilePath: string): Promise<FoliateMetadata | null> {
  const port = await startReaderServer()
  const win = await ensureImportWindow()
  const bookUrl = registerBookFile(bookFilePath)

  return new Promise<FoliateMetadata | null>((resolve) => {
    pending = {
      resolve,
      timer: setTimeout(() => {
        if (!pending) return
        pending = null
        resolve(null)
      }, 20000)
    }
    void win.loadURL(buildImportUrl(port, bookUrl))
  })
}

function categoryIdsOf(bookId: string): string[] {
  const rows = getReaderDb()
    .prepare('SELECT category_id FROM reader_book_categories WHERE book_id = ?')
    .all(bookId) as Array<{ category_id: string }>
  return rows.map((r) => r.category_id)
}

function rowToBook(
  row: Record<string, unknown>,
  categoryIds?: string[]
): ReaderBook {
  let ids: string[]
  if (categoryIds) {
    ids = categoryIds
  } else if (typeof row.category_ids === 'string') {
    ids = row.category_ids ? row.category_ids.split(',') : []
  } else {
    ids = categoryIdsOf(String(row.id))
  }
  return {
    id: String(row.id),
    title: String(row.title),
    author: (row.author as string | null) ?? null,
    format: String(row.format),
    fileName: String(row.file_name),
    originalName: (row.original_name as string | null) ?? null,
    coverPath: coverUrl((row.cover_path as string | null) ?? null),
    coverCustom: !!row.cover_custom,
    importedAt: Number(row.imported_at),
    lastReadAt: (row.last_read_at as number | null) ?? null,
    percentage: Number(row.percentage ?? 0),
    chapterTitle: (row.chapter_title as string | null) ?? null,
    categoryIds: ids
  }
}

const SELECT_BOOK = `
  SELECT b.*, COALESCE(s.percentage, 0) AS percentage, s.chapter_title
  FROM reader_books b
  LEFT JOIN reader_state s ON s.book_id = b.id`

export function listReaderBooks(): ReaderBook[] {
  // 一次查出每本书的分类 id，避免逐本子查询
  const catRows = getReaderDb()
    .prepare('SELECT book_id, category_id FROM reader_book_categories')
    .all() as Array<{ book_id: string; category_id: string }>
  const catMap = new Map<string, string[]>()
  for (const r of catRows) {
    const arr = catMap.get(r.book_id)
    if (arr) arr.push(r.category_id)
    else catMap.set(r.book_id, [r.category_id])
  }
  return getReaderDb()
    .prepare(`${SELECT_BOOK} ORDER BY COALESCE(b.last_read_at, b.imported_at) DESC`)
    .all()
    .map((r) => {
      const row = r as Record<string, unknown>
      return rowToBook(row, catMap.get(String(row.id)) ?? [])
    })
}

export async function importBook(sourcePath: string): Promise<ReaderBook> {
  const ext = path.extname(sourcePath).slice(1).toLowerCase()
  if (!SUPPORTED_EXT.includes(ext)) throw new Error(`不支持的格式：${ext}`)
  if (!fs.existsSync(sourcePath)) throw new Error('文件不存在')

  const id = randomUUID()
  fs.mkdirSync(readerLibraryDir(), { recursive: true })
  fs.mkdirSync(readerCoversDir(), { recursive: true })

  // TXT 不被 foliate-js 直接支持：导入时编码探测 + 按章节转成 EPUB 入库
  let format = ext
  let storedName = `${id}.${ext}`
  let storedPath = path.join(readerLibraryDir(), storedName)
  let txtInfo: { title: string; author: string | null } | null = null
  if (ext === 'txt') {
    storedName = `${id}.epub`
    storedPath = path.join(readerLibraryDir(), storedName)
    txtInfo = convertTxtToEpub(sourcePath, storedPath)
    format = 'epub'
  } else {
    fs.copyFileSync(sourcePath, storedPath)
  }

  let title = path.basename(sourcePath, path.extname(sourcePath))
  let author: string | null = null
  let coverPath: string | null = null

  try {
    if (txtInfo) {
      title = txtInfo.title
      author = txtInfo.author
    } else {
      const meta = await extractMetadata(storedPath)
      const metaTitle = flattenField(meta?.title)
      // CBZ 无内置元数据，foliate 用文件 URL 当标题；这种情况下退回文件名
      title = metaTitle && !/[/\\]/.test(metaTitle) ? metaTitle : title
      author = flattenField(meta?.creator) ?? flattenField(meta?.author)
      if (meta?.cover && meta.cover.startsWith('data:')) {
        const match = /^data:image\/([\w+.-]+);base64,(.+)$/s.exec(meta.cover)
        if (match) {
          const imgExt = match[1] === 'jpeg' ? 'jpg' : match[1]
          coverPath = `${id}.${imgExt}`
          fs.writeFileSync(path.join(readerCoversDir(), coverPath), Buffer.from(match[2], 'base64'))
        }
      }
    }
  } catch {
    // 元数据提取失败不阻断导入，使用文件名兜底
  }

  getReaderDb()
    .prepare(
      `INSERT INTO reader_books (id, title, author, format, file_name, original_name, cover_path, cover_custom, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(id, title, author, format, storedName, path.basename(sourcePath), coverPath, Date.now())

  const row = getReaderDb().prepare(`${SELECT_BOOK} WHERE b.id = ?`).get(id) as Record<string, unknown>
  return rowToBook(row)
}

// 修改书名 / 作者（仅改书库元数据，不动书文件内部元信息）
export function renameReaderBook(
  id: string,
  title: string,
  author: string | null
): ReaderBook | null {
  getReaderDb()
    .prepare('UPDATE reader_books SET title = ?, author = ? WHERE id = ?')
    .run(title, author, id)
  const row = getReaderDb()
    .prepare(`${SELECT_BOOK} WHERE b.id = ?`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToBook(row) : null
}

// 删除书：记录、书库文件、封面文件一并删除（批注/进度由外键级联）
export function deleteReaderBook(id: string): boolean {
  const row = getReaderDb()
    .prepare('SELECT file_name, cover_path FROM reader_books WHERE id = ?')
    .get(id) as { file_name: string; cover_path: string | null } | undefined
  if (!row) return false
  getReaderDb().prepare('DELETE FROM reader_books WHERE id = ?').run(id)
  fs.rmSync(path.join(readerLibraryDir(), row.file_name), { force: true })
  if (row.cover_path) fs.rmSync(path.join(readerCoversDir(), row.cover_path), { force: true })
  return true
}

export function getBookFilePath(id: string): string | null {
  const row = getReaderDb()
    .prepare('SELECT file_name FROM reader_books WHERE id = ?')
    .get(id) as { file_name: string } | undefined
  if (!row) return null
  return path.join(readerLibraryDir(), row.file_name)
}

// 自定义封面：把用户选择的图片复制进封面目录
export function setBookCover(id: string, imagePath: string): ReaderBook | null {
  const ext = path.extname(imagePath).slice(1).toLowerCase().replace('jpeg', 'jpg')
  if (!['png', 'jpg', 'gif', 'webp', 'bmp'].includes(ext)) throw new Error('仅支持图片格式')
  const coverPath = `${id}.${ext}`
  fs.copyFileSync(imagePath, path.join(readerCoversDir(), coverPath))
  getReaderDb()
    .prepare('UPDATE reader_books SET cover_path = ?, cover_custom = 1 WHERE id = ?')
    .run(coverPath, id)
  const row = getReaderDb().prepare(`${SELECT_BOOK} WHERE b.id = ?`).get(id) as Record<string, unknown>
  return row ? rowToBook(row) : null
}
