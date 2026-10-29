import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { moduleDao, designDao, itemDao } from '../db/dao/customModuleDao'
import { pickImageFiles, importImage } from '../services/imageService'
import { imagesRoot } from '../paths'
import type {
  CustomModuleInput,
  CustomModuleDesignInput,
  CustomModuleItemInput
} from '../../shared/types'

export function registerCustomModuleIpc(): void {
  // ---------- 模块 ----------
  ipcMain.handle('cm:list', (_e, includeDeleted?: boolean) => moduleDao.list(!!includeDeleted))
  ipcMain.handle('cm:get', (_e, id: string) => moduleDao.getById(id))
  ipcMain.handle('cm:create', (_e, input: CustomModuleInput) => moduleDao.insert(input))
  ipcMain.handle('cm:update', (_e, input: CustomModuleInput) => moduleDao.update(input))
  ipcMain.handle('cm:set-enabled', (_e, id: string, enabled: boolean) => {
    moduleDao.setEnabled(id, enabled)
    return true
  })
  ipcMain.handle('cm:delete', (_e, id: string) => {
    moduleDao.softDelete(id)
    return true
  })
  ipcMain.handle('cm:new-id', () => randomUUID())
  ipcMain.handle('cm:next-sort', () => moduleDao.nextSortOrder())

  // ---------- 设计 ----------
  ipcMain.handle('cm-design:list', (_e, moduleId: string) => designDao.listByModule(moduleId))
  ipcMain.handle('cm-design:get', (_e, id: string) => designDao.getById(id))
  ipcMain.handle('cm-design:active', (_e, moduleId: string) => designDao.getActive(moduleId))
  ipcMain.handle('cm-design:save', (_e, input: CustomModuleDesignInput, isNew: boolean) => {
    const d = isNew ? designDao.insert(input) : designDao.update(input)
    // 模块尚无启用设计时，新设计自动启用（与 Flutter 一致）
    if (isNew && !designDao.listByModule(input.moduleId).some((x) => x.isActive)) {
      designDao.setActive(input.moduleId, d.id)
    }
    return designDao.getById(d.id)
  })
  ipcMain.handle('cm-design:set-active', (_e, moduleId: string, designId: string) => {
    designDao.setActive(moduleId, designId)
    return true
  })
  ipcMain.handle('cm-design:delete', (_e, moduleId: string, designId: string) => {
    designDao.softDelete(moduleId, designId)
    return true
  })
  ipcMain.handle('cm-design:new-id', () => randomUUID())

  // ---------- 条目 ----------
  ipcMain.handle('cm-item:list', (_e, moduleId: string) => itemDao.listByModule(moduleId))
  ipcMain.handle('cm-item:deleted', () => itemDao.listDeleted())
  ipcMain.handle('cm-item:get', (_e, id: string) => itemDao.getById(id))
  ipcMain.handle('cm-item:count', (_e, moduleId: string) => itemDao.countForModule(moduleId))
  ipcMain.handle('cm-item:search', (_e, moduleId: string, keyword: string) =>
    itemDao.search(moduleId, keyword)
  )
  ipcMain.handle('cm-item:create', (_e, input: CustomModuleItemInput) => itemDao.insert(input))
  ipcMain.handle('cm-item:update', (_e, input: CustomModuleItemInput) => itemDao.update(input))
  ipcMain.handle('cm-item:delete', (_e, id: string) => {
    itemDao.softDelete(id)
    return true
  })
  ipcMain.handle('cm-item:restore', (_e, id: string) => {
    itemDao.restore(id)
    return true
  })
  ipcMain.handle('cm-item:purge', (_e, id: string) => {
    const raw = itemDao.getById(id, true)
    itemDao.permanentDelete(id)
    if (raw) {
      // images/custom/<moduleId>/<itemId>
      fs.rmSync(path.join(imagesRoot(), 'custom', raw.moduleId, id), {
        recursive: true,
        force: true
      })
    }
    return true
  })
  ipcMain.handle('cm-item:new-id', () => randomUUID())

  // 封面（单张）：images/custom/<moduleId>/<itemId>/
  ipcMain.handle(
    'cm-item:pick-poster',
    async (_e, moduleId: string, itemId: string): Promise<string | null> => {
      const files = await pickImageFiles(false)
      if (!files.length) return null
      return importImage('custom', moduleId, files[0], itemId)
    }
  )
  // 多图
  ipcMain.handle(
    'cm-item:pick-images',
    async (_e, moduleId: string, itemId: string): Promise<string[]> => {
      const files = await pickImageFiles(true)
      return files.map((f) => importImage('custom', moduleId, f, itemId))
    }
  )
}
