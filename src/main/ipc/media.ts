import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { bookDao, type BookQuery } from '../db/dao/bookDao'
import { gameDao, type GameQuery } from '../db/dao/gameDao'
import { playlistDao } from '../db/dao/playlistDao'
import { pickImageFiles, importImage, deleteEntityFolder } from '../services/imageService'
import type { BookInput, GameInput } from '../../shared/types'

// 书籍 / 游戏与影视结构同构，这里集中注册两者的 CRUD/回收站/封面 IPC。
export function registerMediaIpc(): void {
  // ---- 书籍 ----
  ipcMain.handle('book:list', (_e, q: BookQuery) => bookDao.list(q))
  ipcMain.handle('book:get', (_e, id: string) => bookDao.getById(id))
  ipcMain.handle('book:counts', () => bookDao.countByStatus())
  ipcMain.handle('book:metadata', () => bookDao.allMetadata())
  ipcMain.handle('book:create', (_e, input: BookInput) => bookDao.insert(input))
  ipcMain.handle('book:update', (_e, input: BookInput) => bookDao.update(input))
  ipcMain.handle('book:delete', (_e, id: string) => {
    bookDao.softDelete(id)
    return true
  })
  ipcMain.handle('book:restore', (_e, id: string) => {
    bookDao.restore(id)
    return true
  })
  ipcMain.handle('book:purge', (_e, id: string) => {
    bookDao.permanentDelete(id)
    playlistDao.onMediaPurged(id, 'book')
    deleteEntityFolder('books', id)
    return true
  })
  ipcMain.handle('book:new-id', () => randomUUID())
  ipcMain.handle('book:pick-cover', async (_e, entityId: string, sub?: string) => {
    const files = await pickImageFiles(false)
    return files.length ? importImage('books', entityId, files[0], sub) : null
  })

  // ---- 游戏 ----
  ipcMain.handle('game:list', (_e, q: GameQuery) => gameDao.list(q))
  ipcMain.handle('game:get', (_e, id: string) => gameDao.getById(id))
  ipcMain.handle('game:counts', () => gameDao.countByStatus())
  ipcMain.handle('game:metadata', () => gameDao.allMetadata())
  ipcMain.handle('game:create', (_e, input: GameInput) => gameDao.insert(input))
  ipcMain.handle('game:update', (_e, input: GameInput) => gameDao.update(input))
  ipcMain.handle('game:delete', (_e, id: string) => {
    gameDao.softDelete(id)
    return true
  })
  ipcMain.handle('game:restore', (_e, id: string) => {
    gameDao.restore(id)
    return true
  })
  ipcMain.handle('game:purge', (_e, id: string) => {
    gameDao.permanentDelete(id)
    playlistDao.onMediaPurged(id, 'game')
    deleteEntityFolder('games', id)
    return true
  })
  ipcMain.handle('game:new-id', () => randomUUID())
  ipcMain.handle('game:pick-cover', async (_e, entityId: string, sub?: string) => {
    const files = await pickImageFiles(false)
    return files.length ? importImage('games', entityId, files[0], sub) : null
  })
}
