import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { buildBackupZip, restoreFromZip } from '../services/backupService'
import {
  clearConfig,
  downloadBackup,
  getConfig,
  getLastSync,
  saveConfig,
  testConnection,
  uploadBackup,
  type WebDavConfig
} from '../services/webdavService'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function timestampName(): string {
  const d = new Date()
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export function registerBackupIpc(): void {
  // 本地备份：弹保存框 → 生成单 zip → 复制到目标位置
  ipcMain.handle('backup:export', async (): Promise<{ path: string; imageCount: number } | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      title: '保存备份文件',
      defaultPath: `mooknote_backup_${timestampName()}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return null
    const { zipPath, imageCount } = buildBackupZip()
    try {
      let dest = res.filePath
      if (!dest.toLowerCase().endsWith('.zip')) dest += '.zip'
      fs.copyFileSync(zipPath, dest)
      return { path: dest, imageCount }
    } finally {
      fs.rmSync(zipPath, { force: true })
    }
  })

  // 本地恢复：弹选择框 → 解压恢复 → 返回统计（needReload 恒为 true）
  ipcMain.handle('backup:import', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [{ name: '备份文件', extensions: ['zip', 'json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const result = restoreFromZip(res.filePaths[0])
    return result.success ? { ...result, needReload: true } : result
  })

  // ── WebDAV ──
  ipcMain.handle('webdav:get-config', () => getConfig())

  ipcMain.handle('webdav:save-config', (_e, cfg: WebDavConfig) => {
    saveConfig(cfg)
    return true
  })

  ipcMain.handle('webdav:clear-config', () => {
    clearConfig()
    return true
  })

  ipcMain.handle('webdav:test', (_e, cfg: WebDavConfig) => testConnection(cfg))
  ipcMain.handle('webdav:upload', (event) =>
    uploadBackup((sent, total, stage) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('webdav:upload-progress', {
          received: sent,
          total,
          stage: stage ?? 'transfer',
          percent: total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0
        })
      }
    })
  )
  ipcMain.handle('webdav:download', (event) =>
    downloadBackup((received, total) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('webdav:download-progress', {
          received,
          total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
        })
      }
    })
  )
  ipcMain.handle('webdav:last-sync', () => getLastSync())
}
