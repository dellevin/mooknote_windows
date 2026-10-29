import { app, shell, BrowserWindow, protocol, net, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { initPaths, imagesRoot } from './paths'
import { openDatabase } from './db'
import { prefs } from './prefs'
import { registerIpc } from './ipc'
import { registerMovieIpc } from './ipc/movie'
import { registerMediaIpc } from './ipc/media'
import { registerSupportingIpc } from './ipc/supporting'
import { registerPeopleIpc } from './ipc/people'
import { registerNoteIpc } from './ipc/note'
import { registerCustomModuleIpc } from './ipc/customModule'
import { registerStatsIpc } from './ipc/stats'
import { registerSearchIpc } from './ipc/search'
import { registerBackupIpc } from './ipc/backup'
import { registerTagIpc } from './ipc/tag'

// 本地图片：mookimg:///<绝对路径>
// 不能注册为 standard：standard 协议会按 host:port 解析，吞掉 Windows 盘符冒号
// （mookimg:///C:/... 会被解析成 host=c），导致所有绝对路径图片 404
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mookimg',
    privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

// 将 mookimg 请求里的路径归一化到真实磁盘文件；不存在返回 null
function resolveImagePath(raw: string): string | null {
  let p = decodeURIComponent(raw.replace(/^\/+/, ''))

  // Windows 绝对路径（C:\... 或 C:/...）
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    return fs.existsSync(p) ? p : null
  }

  // 安卓遗留绝对路径：/data/.../images/<相对路径>
  if (p.startsWith('/data/') || p.startsWith('data/')) {
    const idx = p.indexOf('/images/')
    if (idx >= 0) p = p.slice(idx + '/images/'.length)
  }

  // 其余按相对 imagesRoot 的逻辑路径处理
  if (!path.isAbsolute(p)) p = path.join(imagesRoot(), p)
  return fs.existsSync(p) ? p : null
}

function createWindow(): void {
  // 窗口始终不透明浅色。Win11 Mica 依赖 DWM 合成，无边框窗口最大化/还原时会
  // 间歇性回退成纯黑且无法可靠恢复，故不启用任何透明材质。
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    // 原生标题按钮覆盖层：自带 Snap Layouts、关闭悬停变红、系统暗色/对齐。
    titleBarOverlay: {
      color: '#f3f3f5',
      symbolColor: '#1b1b1b',
      height: 32
    },
    backgroundColor: '#f3f3f5',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // naive-ui 图片预览的「下载」按钮会把顶层页面直接导航到图片地址。
  // 图片走自定义 mookimg: 协议，一旦顶层导航，整个应用外壳会被替换成
  // 一张黑底图片且无任何控件（看似卡死）。这里禁止应用窗口跳转到图片协议。
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mookimg:')) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initPaths()
  prefs.load()
  openDatabase()
  registerIpc()
  registerMovieIpc()
  registerMediaIpc()
  registerSupportingIpc()
  registerPeopleIpc()
  registerNoteIpc()
  registerCustomModuleIpc()
  registerStatsIpc()
  registerSearchIpc()
  registerBackupIpc()
  registerTagIpc()

  // 图片预览「另存为」：把 mookimg 对应的本地文件复制到用户选择的目录
  ipcMain.handle('image:save-as', async (_e, src: string, suggested?: string) => {
    if (typeof src !== 'string' || !src.startsWith('mookimg:')) return false
    const filePath = resolveImagePath(src.slice('mookimg://'.length))
    if (!filePath) return false
    const fallback = path.basename(filePath)
    const safeName =
      suggested && /^[^\\/:*?"<>|]+\.[a-z0-9]+$/i.test(suggested) ? suggested : fallback
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, { defaultPath: safeName })
    if (result.canceled || !result.filePath) return false
    try {
      await fs.promises.copyFile(filePath, result.filePath)
      return true
    } catch {
      return false
    }
  })

  // 本地图片协议：mookimg:///<encodeURI(路径)>
  // 路径可能是：Windows 绝对路径、相对 imagesRoot 的逻辑路径、或安卓遗留绝对路径
  protocol.handle('mookimg', (request) => {
    const raw = request.url.slice('mookimg://'.length)
    const filePath = resolveImagePath(raw)
    if (!filePath) return new Response('Not Found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
