import { ipcMain, dialog, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  openReaderWindow,
  focusReaderWindow,
  openBookInWindow,
  backToShelf
} from './readerWindow'
import {
  listReaderBooks,
  importBook,
  deleteReaderBook,
  setBookCover
} from './importer'
import {
  saveProgress,
  listAnnotations,
  addAnnotation,
  removeAnnotationByValue,
  type ReaderAnnotation
} from './library'
import type { ReaderBook } from '../../shared/types'

export function registerReaderIpc(): void {
  // 打开书架窗口（工具栏入口）
  ipcMain.handle('reader:open', () => {
    openReaderWindow()
    return true
  })

  ipcMain.handle('reader:focus', () => focusReaderWindow())

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

  // 书架打开某本书 → 窗口切换到 foliate-js 阅读页
  ipcMain.handle('reader:open-book', (_e, id: string): Promise<boolean> =>
    openBookInWindow(id)
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

  // foliate-js 运行时事件：转发给同窗口主 frame（阅读页 app.js 监听）
  ipcMain.on('reader:event', (e, name: string, data: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.webContents.send('reader:host-event', name, data)
  })
}
