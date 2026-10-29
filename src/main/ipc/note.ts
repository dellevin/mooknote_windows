import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { noteDao, type NoteQuery } from '../db/dao/noteDao'
import { pickImageFiles, importImage, deleteEntityFolder } from '../services/imageService'
import type { NoteInput } from '../../shared/types'

export function registerNoteIpc(): void {
  ipcMain.handle('note:list', (_e, q: NoteQuery) => noteDao.list(q ?? {}))
  ipcMain.handle('note:get', (_e, id: string) => noteDao.getById(id))
  ipcMain.handle('note:tags', () => noteDao.allTags())
  ipcMain.handle('note:create', (_e, input: NoteInput) => noteDao.insert(input))
  ipcMain.handle('note:update', (_e, input: NoteInput) => noteDao.update(input))
  ipcMain.handle('note:delete', (_e, id: string) => {
    noteDao.softDelete(id)
    return true
  })
  ipcMain.handle('note:restore', (_e, id: string) => {
    noteDao.restore(id)
    return true
  })
  ipcMain.handle('note:purge', (_e, id: string) => {
    noteDao.permanentDelete(id)
    deleteEntityFolder('notes', id)
    return true
  })
  ipcMain.handle('note:toggle-pin', (_e, id: string, pinned: boolean) => {
    noteDao.togglePin(id, pinned)
    return true
  })
  ipcMain.handle('note:new-id', () => randomUUID())
  // 笔记图片：images/notes/<noteId>/
  ipcMain.handle('note:pick-images', async (_e, noteId: string): Promise<string[]> => {
    const files = await pickImageFiles(true)
    return files.map((f) => importImage('notes', noteId, f))
  })
}
