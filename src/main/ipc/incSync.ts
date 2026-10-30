import { ipcMain } from 'electron'
import {
  incUpload,
  incDownload,
  incRestoreDownload,
  incForcePush,
  getIncInfo
} from '../services/sync/incSyncService'

export function registerIncSyncIpc(): void {
  const forwardProgress = (event: Electron.IpcMainInvokeEvent) => (p: {
    stage: string
    message: string
    upRecords: number
    downRecords: number
    upImages: number
    downImages: number
    dedupImages: number
  }) => {
    if (!event.sender.isDestroyed()) event.sender.send('inc-sync:progress', p)
  }

  ipcMain.handle('inc-sync:upload', (event) => incUpload(forwardProgress(event)))
  ipcMain.handle('inc-sync:download', (event) => incDownload(forwardProgress(event)))
  ipcMain.handle('inc-sync:restore', (event) => incRestoreDownload(forwardProgress(event)))
  ipcMain.handle('inc-sync:force-push', (event) => incForcePush(forwardProgress(event)))
  ipcMain.handle('inc-sync:info', (_e, fetchRemoteVersion?: boolean) =>
    getIncInfo(fetchRemoteVersion ?? true)
  )
}
