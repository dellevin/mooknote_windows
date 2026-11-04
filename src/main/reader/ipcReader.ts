import { ipcMain, dialog, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  openReaderWindow,
  focusReaderWindow,
  openBookInWindow,
  buildBookUrl,
  backToShelf,
  isReaderOpen,
  closeReaderWindow
} from './readerWindow'
import {
  listReaderBooks,
  importBook,
  deleteReaderBook,
  setBookCover,
  renameReaderBook
} from './importer'
import {
  saveProgress,
  listAnnotations,
  addAnnotation,
  removeAnnotationByValue,
  type ReaderAnnotation
} from './library'
import {
  listCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  setCategoryHidden,
  reorderCategories,
  setBookCategories
} from './categories'
import { exportReaderBackup, importReaderBackup, BACKUP_EXT } from './backup'
import type { ReaderBook, ReaderCategory } from '../../shared/types'

export function registerReaderIpc(): void {
  // 打开书架窗口（工具栏入口）
  ipcMain.handle('reader:open', () => {
    openReaderWindow()
    return true
  })

  ipcMain.handle('reader:focus', () => focusReaderWindow())

  // 主界面侧栏：查询/关闭正在运行的阅读器窗口
  ipcMain.handle('reader:is-open', () => isReaderOpen())
  ipcMain.handle('reader:close-window', () => closeReaderWindow())

  ipcMain.handle('reader:list', (): ReaderBook[] => listReaderBooks())

  // 选文件并导入书架（支持多选，串行处理）
  ipcMain.handle(
    'reader:import',
    async (e): Promise<{ imported: number; failed: string[] }> => {
      const parent = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(parent!, {
        title: '导入电子书',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '电子书',
            extensions: [
              'epub',
              'pdf',
              'mobi',
              'azw3',
              'azw',
              'fb2',
              'fbz',
              'cbz',
              'txt'
            ]
          },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      const failed: string[] = []
      let imported = 0
      for (const filePath of result.canceled ? [] : result.filePaths) {
        try {
          await importBook(filePath)
          imported++
        } catch (err) {
          failed.push(`${filePath}：${String(err)}`)
        }
      }
      return { imported, failed }
    }
  )

  ipcMain.handle('reader:delete', (_e, id: string): boolean => deleteReaderBook(id))

  // 修改书名 / 作者（作者留空存 null）
  ipcMain.handle(
    'reader:rename',
    (
      _e,
      id: string,
      payload: { title: string; author: string }
    ): ReaderBook | null => {
      const title = String(payload?.title ?? '').trim()
      if (!id || !title) return null
      const author = String(payload?.author ?? '').trim()
      return renameReaderBook(id, title, author || null)
    }
  )

  // 书架打开某本书 → 窗口切换到 foliate-js 阅读页
  ipcMain.handle('reader:open-book', (_e, id: string): Promise<boolean> =>
    openBookInWindow(id)
  )

  // 主窗口内嵌模式：仅取阅读页 URL，由渲染层在 iframe 中承载（不弹窗）
  ipcMain.handle('reader:book-url', (_e, id: string): Promise<string | null> =>
    buildBookUrl(String(id))
  )

  // foliate 阅读页返回书架
  ipcMain.handle('reader:back-shelf', () => {
    backToShelf()
    return true
  })

  ipcMain.handle('reader:pick-cover', async (e, id: string): Promise<ReaderBook | null> => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showOpenDialog(parent!, {
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return setBookCover(id, result.filePaths[0])
  })

  // ---- 阅读过程：进度、书签 ----
  ipcMain.handle(
    'reader:save-progress',
    (
      _e,
      payload: {
        bookId: string
        cfi: string
        percentage: number
        chapterTitle: string | null
      }
    ) => {
      if (!payload?.bookId || typeof payload.cfi !== 'string') return false
      saveProgress(payload)
      return true
    }
  )

  ipcMain.handle(
    'reader:annotations',
    (_e, bookId: string): ReaderAnnotation[] => listAnnotations(bookId)
  )

  // foliate-js 点书签按钮 → 落库（添加或移除当前页书签）
  ipcMain.handle(
    'reader:bookmark-toggle',
    (
      _e,
      payload: {
        bookId: string
        remove: boolean
        detail: { cfi: string; content: string; percentage: number }
        chapterTitle: string | null
      }
    ): { id: string; action: 'added' | 'removed' } => {
      if (payload.remove) {
        removeAnnotationByValue(payload.bookId, payload.detail.cfi)
        return { id: '', action: 'removed' }
      }
      const id = randomUUID()
      addAnnotation({
        bookId: payload.bookId,
        id,
        type: 'bookmark',
        value: payload.detail.cfi,
        color: '#e8a33d',
        note: payload.detail.content,
        chapter: payload.chapterTitle
      })
      return { id, action: 'added' }
    }
  )

  ipcMain.handle('reader:bookmark-remove', (_e, bookId: string, cfi: string): boolean =>
    removeAnnotationByValue(bookId, cfi)
  )

  // ---- 分类 ----
  ipcMain.handle('reader:cat-list', (): ReaderCategory[] => listCategories())

  ipcMain.handle(
    'reader:cat-add',
    (_e, name: string): { ok: boolean; category?: ReaderCategory; error?: string } => {
      try {
        return { ok: true, category: addCategory(name) }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'reader:cat-rename',
    (_e, id: string, name: string): boolean => renameCategory(id, name)
  )

  ipcMain.handle('reader:cat-delete', (_e, id: string): boolean => deleteCategory(id))

  ipcMain.handle(
    'reader:cat-set-hidden',
    (_e, id: string, hidden: boolean): boolean => setCategoryHidden(id, !!hidden)
  )

  ipcMain.handle('reader:cat-reorder', (_e, orderedIds: string[]): boolean => {
    if (!Array.isArray(orderedIds)) return false
    reorderCategories(orderedIds.map(String))
    return true
  })

  ipcMain.handle(
    'reader:cat-set-book',
    (_e, bookId: string, categoryIds: string[]): boolean => {
      if (!bookId || !Array.isArray(categoryIds)) return false
      setBookCategories(bookId, categoryIds)
      return true
    }
  )

  // ---- 书库备份 / 恢复（迁移） ----
  ipcMain.handle('reader:backup-export', async (e): Promise<{ ok: boolean; path?: string; error?: string }> => {
    try {
      const parent = BrowserWindow.fromWebContents(e.sender)
      const stamp = new Date()
      const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
        stamp.getDate()
      ).padStart(2, '0')}`
      const result = await dialog.showSaveDialog(parent!, {
        title: '导出书库备份',
        defaultPath: `mooknote-reader-${ymd}.${BACKUP_EXT}`,
        filters: [{ name: 'MookNote 书库备份', extensions: [BACKUP_EXT] }]
      })
      if (result.canceled || !result.filePath) return { ok: false }
      exportReaderBackup(result.filePath)
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('reader:backup-import', async (e): Promise<{ ok: boolean; books?: number; error?: string }> => {
    try {
      const parent = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(parent!, {
        title: '导入书库备份',
        properties: ['openFile'],
        filters: [{ name: 'MookNote 书库备份', extensions: [BACKUP_EXT] }]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false }
      const { books } = importReaderBackup(result.filePaths[0])
      return { ok: true, books }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // foliate-js 运行时事件：定向回发给消息来源的 frame（独立窗是主 frame，
  // 主窗口内嵌时是 reader iframe 子 frame；用 webContents.send 只会到主 frame，
  // 子 frame 收不到，故必须用 senderFrame.send）。
  ipcMain.on('reader:event', (e, name: string, data: unknown) => {
    e.senderFrame?.send('reader:host-event', name, data)
  })
}
