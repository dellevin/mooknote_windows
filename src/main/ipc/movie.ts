import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { movieDao, type MovieQuery } from '../db/dao/movieDao'
import { playlistDao } from '../db/dao/playlistDao'
import {
  pickImageFiles,
  importImage,
  deleteEntityFolder
} from '../services/imageService'
import type { MovieInput } from '../../shared/types'

export function registerMovieIpc(): void {
  ipcMain.handle('movie:list', (_e, q: MovieQuery) => movieDao.list(q))
  ipcMain.handle('movie:get', (_e, id: string) => movieDao.getById(id))
  ipcMain.handle('movie:counts', () => movieDao.countByStatus())
  ipcMain.handle('movie:metadata', () => movieDao.allMetadata())

  ipcMain.handle('movie:create', (_e, input: MovieInput) => movieDao.insert(input))
  ipcMain.handle('movie:update', (_e, input: MovieInput) => movieDao.update(input))
  ipcMain.handle('movie:delete', (_e, id: string) => {
    movieDao.softDelete(id)
    return true
  })
  ipcMain.handle('movie:restore', (_e, id: string) => {
    movieDao.restore(id)
    return true
  })
  ipcMain.handle('movie:purge', (_e, id: string) => {
    movieDao.permanentDelete(id)
    playlistDao.onMediaPurged(id, 'movie')
    deleteEntityFolder('movies', id)
    return true
  })

  ipcMain.handle('movie:new-id', () => randomUUID())

  // 选海报：弹框选图 -> 复制进 movies/<id>/，返回应用内绝对路径
  ipcMain.handle(
    'movie:pick-poster',
    async (_e, entityId: string, sub?: string): Promise<string | null> => {
      const files = await pickImageFiles(false)
      if (!files.length) return null
      return importImage('movies', entityId, files[0], sub)
    }
  )
}
