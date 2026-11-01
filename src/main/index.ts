import {
  app,
  shell,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage
} from 'electron'
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
import { registerIncSyncIpc } from './ipc/incSync'
import { registerOcrIpc } from './ipc/ocr'
import { createBallWindow, registerFloatIpc } from './floatBall'
import { downloadRemoteImage } from './services/onlineSearch'

// 本地图片：mookimg:///<绝对路径>
// 不能注册为 standard：standard 协议会按 host:port 解析，吞掉 Windows 盘符冒号
// （mookimg:///C:/... 会被解析成 host=c），导致所有绝对路径图片 404
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mookimg',
    privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  },
  {
    // 远程封面（TMDB/Bangumi）经主进程代理转发，见 protocol.handle('mookremote')
    scheme: 'mookremote',
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

// 关闭窗口行为（prefs 键 closeAction）：
// ask   每次询问「最小化到托盘 / 退出程序」（默认）
// tray  直接最小化到系统托盘
// quit  直接退出程序
type CloseAction = 'ask' | 'tray' | 'quit'

// 托盘菜单/真正退出时置 true，放行 close
let isQuitting = false
let tray: Tray | null = null
// 关窗询问：主进程发起，渲染层弹自定义对话框后回传决定
let closeResolve: ((r: { quit: boolean; remember: boolean }) => void) | null = null
let closeAsking = false

function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function createTray(win: BrowserWindow): void {
  // 开发态用源码/构建目录图标；打包后优先 resources 目录，最后回退 exe 内嵌图标
  const candidates = [
    path.join(__dirname, '../../src/assets/icon/app_icon.png'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.resourcesPath, 'icon.png')
  ]
  const iconPath = candidates.find((p) => fs.existsSync(p))
  let image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })

  tray = new Tray(image)
  tray.setToolTip('MookNote')
  const menu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => focusWindow(win)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => focusWindow(win))
}

function createWindow(): BrowserWindow {
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
    backgroundColor: '#f3f3f5',
    // 打包后窗口默认使用 exe 内嵌图标；开发环境显式指定源码内图标
    ...(fs.existsSync(path.join(__dirname, '../../src/assets/icon/app_icon.png'))
      ? { icon: path.join(__dirname, '../../src/assets/icon/app_icon.png') }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 关闭按钮：按设置最小化到托盘 / 退出 / 每次询问（询问用渲染层自定义弹窗）
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    const action = prefs.get<CloseAction>('closeAction', 'ask')
    if (action === 'tray') {
      win.hide()
      return
    }
    if (action === 'quit') {
      isQuitting = true
      app.quit()
      return
    }
    // 询问弹窗已打开或页面已销毁：忽略重复触发 / 退回最小化
    if (closeAsking) return
    if (win.webContents.isDestroyed()) {
      win.hide()
      return
    }
    closeAsking = true
    win.webContents.send('win:close-query')
    void new Promise<{ quit: boolean; remember: boolean }>((resolve) => {
      closeResolve = resolve
    }).then(({ quit, remember }) => {
      closeAsking = false
      closeResolve = null
      if (remember) prefs.set('closeAction', quit ? 'quit' : 'tray')
      if (quit) {
        isQuitting = true
        app.quit()
      } else {
        win.hide()
      }
    })
  })

  // 通知渲染层最大化状态，用于切换还原图标
  const pushMax = (): void => win.webContents.send('win:max-changed', win.isMaximized())
  win.on('maximize', pushMax)
  win.on('unmaximize', pushMax)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // naive-ui 图片预览的「下载」按钮会把顶层页面直接导航到图片地址。
  // 图片走自定义 mookimg: 协议，一旦顶层导航，整个应用外壳会被替换成
  // 一张黑底图片且无任何控件（看似卡死）。这里禁止应用窗口跳转到图片协议。
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mookimg:') || url.startsWith('mookremote:')) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// 单实例：第二次启动时不新开窗口，唤起已有窗口
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) focusWindow(win)
  })

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
  registerIncSyncIpc()
  registerOcrIpc()
  registerFloatIpc()

  // 渲染层关窗询问弹窗的决定回传
  ipcMain.on('win:close-decision', (_e, r: { quit?: unknown; remember?: unknown }) => {
    if (!closeResolve) return
    closeResolve({ quit: r?.quit === true, remember: r?.remember === true })
  })
  ipcMain.on('win:close-cancel', () => {
    if (!closeResolve) return
    closeResolve = null
    closeAsking = false
  })

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

  // 远程封面代理：mookremote://<tmdb|bgm|vip>/?u=<encodeURIComponent(远程地址)>
  // 渲染层 <img> 直连远程地址不走 undici 代理，这里由主进程按各源配置的代理取回再返回
  protocol.handle('mookremote', async (request) => {
    try {
      const u = new URL(request.url)
      const source = u.hostname as 'tmdb' | 'bgm' | 'vip'
      const remote = u.searchParams.get('u') ?? ''
      if (!['tmdb', 'bgm', 'vip'].includes(source) || !/^https?:\/\//i.test(remote)) {
        return new Response('Bad Request', { status: 400 })
      }
      const buf = await downloadRemoteImage(remote, source)
      const ext = path.extname(new URL(remote).pathname).toLowerCase()
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
      const ab = new ArrayBuffer(buf.length)
      new Uint8Array(ab).set(buf)
      return new Response(ab, { headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' } })
    } catch {
      return new Response('Bad Gateway', { status: 502 })
    }
  })

  const mainWin = createWindow()
  createTray(mainWin)
  // 桌面悬浮球：独立置顶小窗，主窗口最小化到托盘后仍可用
  createBallWindow()

  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) focusWindow(win)
    else createWindow()
  })
})

// 任何主动退出路径（托盘菜单、系统关机/注销、Cmd+Q）都放行窗口关闭
app.on('before-quit', () => {
  isQuitting = true
})

// 最小化到托盘时窗口只是 hide，不会触发 window-all-closed；
// 真正退出（托盘菜单/退出程序）时 isQuitting=true，close 放行后正常结束
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
} // 单实例锁分支
