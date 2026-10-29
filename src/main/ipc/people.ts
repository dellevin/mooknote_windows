import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { personDao, personLinkDao } from '../db/dao/personDao'
import { characterDao } from '../db/dao/characterDao'
import { playlistDao } from '../db/dao/playlistDao'
import {
  pickImageFiles,
  importImage,
  deleteEntityFolder
} from '../services/imageService'
import type {
  PersonInput,
  MediaKind,
  PersonLink,
  CharacterKind,
  CharacterInput,
  PlaylistInput
} from '../../shared/types'

export function registerPeopleIpc(): void {
  // ---- 人物档案 ----
  ipcMain.handle('person:list', (_e, keyword?: string, includeDeleted?: boolean) =>
    personDao.list(keyword ?? '', includeDeleted ?? false)
  )
  ipcMain.handle('person:get', (_e, id: string) => personDao.getById(id))
  ipcMain.handle('person:names', () => personDao.allNames())
  ipcMain.handle('person:create', (_e, input: PersonInput) => personDao.insert(input))
  ipcMain.handle('person:update', (_e, input: PersonInput) => personDao.update(input))
  ipcMain.handle('person:delete', (_e, id: string) => {
    personDao.softDelete(id)
    return true
  })
  ipcMain.handle('person:restore', (_e, id: string) => {
    personDao.restore(id)
    return true
  })
  ipcMain.handle('person:purge', (_e, id: string) => {
    personDao.permanentDelete(id)
    deleteEntityFolder('people', id)
    return true
  })
  ipcMain.handle('person:new-id', () => randomUUID())
  ipcMain.handle('person:pick-photo', async (_e, personId: string): Promise<string | null> => {
    const files = await pickImageFiles(false)
    return files.length ? importImage('people', personId, files[0]) : null
  })

  // ---- 作品 ↔ 人物关联 ----
  ipcMain.handle('person-link:by-work', (_e, kind: MediaKind, workId: string) =>
    personLinkDao.listByWork(kind, workId)
  )
  ipcMain.handle('person-link:works', (_e, personId: string) =>
    personLinkDao.worksByPerson(personId)
  )
  ipcMain.handle(
    'person-link:replace',
    (_e, kind: MediaKind, workId: string, links: PersonLink[]) => {
      personLinkDao.replaceForWork(kind, workId, links)
      return true
    }
  )

  // ---- 角色 ----
  ipcMain.handle('character:list', (_e, kind: CharacterKind, parentId: string) =>
    characterDao.list(kind, parentId)
  )
  ipcMain.handle(
    'character:save',
    (_e, kind: CharacterKind, input: CharacterInput, isNew: boolean) => {
      if (isNew) characterDao.insert(kind, input)
      else characterDao.update(kind, input)
      return true
    }
  )
  ipcMain.handle('character:delete', (_e, kind: CharacterKind, id: string) => {
    characterDao.remove(kind, id)
    deleteEntityFolder('characters', id)
    return true
  })
  ipcMain.handle('character:new-id', () => randomUUID())
  // 角色图片统一放 images/characters/<characterId>/
  ipcMain.handle(
    'character:pick-image',
    async (_e, characterId: string): Promise<string | null> => {
      const files = await pickImageFiles(false)
      return files.length ? importImage('characters', characterId, files[0]) : null
    }
  )

  // ---- 片单 ----
  ipcMain.handle('playlist:list', (_e, includeDeleted?: boolean) =>
    playlistDao.list(includeDeleted ?? false)
  )
  ipcMain.handle('playlist:get', (_e, id: string) => playlistDao.getById(id))
  ipcMain.handle('playlist:create', (_e, input: PlaylistInput) => playlistDao.insert(input))
  ipcMain.handle('playlist:update', (_e, input: PlaylistInput) => playlistDao.update(input))
  ipcMain.handle('playlist:delete', (_e, id: string) => {
    playlistDao.softDelete(id)
    return true
  })
  ipcMain.handle('playlist:restore', (_e, id: string) => {
    playlistDao.restore(id)
    return true
  })
  ipcMain.handle('playlist:purge', (_e, id: string) => {
    playlistDao.permanentDelete(id)
    return true
  })
  ipcMain.handle('playlist:new-id', () => randomUUID())
  ipcMain.handle('playlist:items', (_e, id: string) => playlistDao.items(id))
  ipcMain.handle('playlist:add-item', (_e, playlistId: string, itemId: string) => {
    playlistDao.addItem(playlistId, itemId)
    return true
  })
  ipcMain.handle('playlist:remove-item', (_e, playlistId: string, itemRowId: string) => {
    playlistDao.removeItem(itemRowId, playlistId)
    return true
  })
}
