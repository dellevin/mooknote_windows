import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { statsDao } from '../db/dao/statsDao'
import { exportMovies, exportBooks, exportGames } from '../services/excelExport'

type ExportKind = 'movie' | 'book' | 'game'

const EXPORTERS: Record<ExportKind, (dest: string) => Promise<void>> = {
  movie: exportMovies,
  book: exportBooks,
  game: exportGames
}
const DEFAULT_NAME: Record<ExportKind, string> = {
  movie: '影视导出.xlsx',
  book: '书籍导出.xlsx',
  game: '游戏导出.xlsx'
}

export function registerStatsIpc(): void {
  ipcMain.handle('stats:overview', () => statsDao.overview())
  ipcMain.handle('stats:calendar', (_e, mode: 0 | 1) => statsDao.calendar(mode ?? 0))
  ipcMain.handle('stats:gallery', () => statsDao.gallery())
  ipcMain.handle('stats:home', () => statsDao.home())
  ipcMain.handle('stats:day-items', (_e, day: string) => statsDao.dayItems(day))

  // 弹保存框 -> 导出 xlsx -> 返回文件路径（取消返回 null）
  ipcMain.handle('export:excel', async (_e, kind: ExportKind): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      title: '导出 Excel',
      defaultPath: DEFAULT_NAME[kind],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (res.canceled || !res.filePath) return null
    let dest = res.filePath
    if (!dest.toLowerCase().endsWith('.xlsx')) dest += '.xlsx'
    await EXPORTERS[kind](dest)
    return dest
  })

  // 在系统资源管理器中打开数据目录
  ipcMain.handle('shell:open-path', (_e, p: string) => {
    void shell.openPath(p)
    return true
  })
}
