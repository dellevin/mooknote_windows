import { ipcMain } from 'electron'
import { tagDao } from '../db/dao/tagDao'
import type { TagDeleteMode, TagType } from '../../shared/types'

export function registerTagIpc(): void {
  ipcMain.handle('tag:list', (_e, type?: TagType) => tagDao.list(type))
  ipcMain.handle('tag:add', (_e, type: TagType, name: string) => tagDao.add(type, name))
  ipcMain.handle('tag:rename', (_e, id: string, name: string) => {
    tagDao.rename(id, name)
    return true
  })
  ipcMain.handle('tag:toggle-hidden', (_e, id: string) => tagDao.toggleHidden(id))
  ipcMain.handle(
    'tag:move',
    (_e, id: string, parentId: string, beforeId: string | null) => {
      tagDao.move(id, parentId, beforeId)
      return true
    }
  )
  ipcMain.handle(
    'tag:remove',
    (_e, id: string, mode: TagDeleteMode, replacementName?: string) => {
      tagDao.remove(id, mode, replacementName)
      return true
    }
  )
  ipcMain.handle('tag:sync', () => tagDao.syncFromData())
  ipcMain.handle('tag:usage', (_e, type: TagType) => tagDao.usage(type))
}
