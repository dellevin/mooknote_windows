import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { prefs } from './prefs'

// 真正退出时允许球窗关闭，否则会拦住 app.quit()
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

// 桌面悬浮球：独立于主窗口的无边框透明置顶小窗，可在桌面任意位置拖动；
// 点击在球上方弹出功能面板（菜单 / OCR 结果），面板是另一个独立小窗。
const BALL_SIZE = 56
const PANEL_MENU = { w: 176, h: 108 }
const PANEL_RESULT = { w: 620, h: 540 }
const GAP = 10
const MENU_GAP = 4

let ballWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let panelMode: 'menu' | 'result' | null = null

// 拖动起点：全局光标位置 + 球窗起点
let dragCursor = { x: 0, y: 0 }
let dragOrigin = { x: 0, y: 0 }
// 拖动期间用定时器直接轮询全局光标，避免快速移动时指针离开小球窗口收不到 move 事件
let dragTimer: NodeJS.Timeout | null = null
// 失焦后延迟关闭：若焦点其实落在球窗（用户点球），则不关，交给 toggle-menu 决定
let pendingHide: NodeJS.Timeout | null = null
function clearPendingHide(): void {
  if (pendingHide) {
    clearTimeout(pendingHide)
    pendingHide = null
  }
}
function scheduleMenuHide(): void {
  clearPendingHide()
  pendingHide = setTimeout(() => {
    pendingHide = null
    if (panelMode !== 'menu') return
    const focused = BrowserWindow.getFocusedWindow()
    // 焦点在球或面板自身上：是点球/面板内操作，不自动关
    if ((focused && (focused === ballWin || focused === panelWin)) ) return
    hidePanel()
  }, 140)
}

function stopDragTracking(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
}
function applyDrag(): void {
  if (!ballWin) return
  const cur = screen.getCursorScreenPoint()
  const pos = clampToWorkArea(
    dragOrigin.x + (cur.x - dragCursor.x),
    dragOrigin.y + (cur.y - dragCursor.y),
    BALL_SIZE
  )
  ballWin.setPosition(pos.x, pos.y)
  if (panelMode && panelWin && !panelWin.isDestroyed()) {
    panelWin.setBounds(panelBounds(panelMode))
  }
}

function rendererTarget(hash: string): { url?: string; file: string; hash?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}#/${hash}`, file: '' }
  return {
    file: path.join(__dirname, '../renderer/index.html'),
    hash: `/${hash}`
  }
}

function defaultBallPos(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - BALL_SIZE - 32, y: wa.y + wa.height - BALL_SIZE - 32 }
}

function clampToWorkArea(x: number, y: number, size: number): { x: number; y: number } {
  const disp = screen.getDisplayNearestPoint({ x: x + size / 2, y: y + size / 2 })
  const wa = disp.workArea
  return {
    x: Math.min(Math.max(x, wa.x), wa.x + wa.width - size),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - size)
  }
}

function savePos(x: number, y: number): void {
  void prefs.set('floatBallX', x)
  void prefs.set('floatBallY', y)
}

export function createBallWindow(): void {
  const savedX = Number(prefs.get('floatBallX'))
  const savedY = Number(prefs.get('floatBallY'))
  const def = defaultBallPos()
  const pos = clampToWorkArea(
    Number.isFinite(savedX) ? savedX : def.x,
    Number.isFinite(savedY) ? savedY : def.y,
    BALL_SIZE
  )

  ballWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: BALL_SIZE,
    height: BALL_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  ballWin.setAlwaysOnTop(true, 'floating')

  const t = rendererTarget('float-ball')
  const showWhenReady = (): void => {
    if (isBallEnabled() && ballWin && !ballWin.isDestroyed()) ballWin.show()
  }
  ballWin.once('ready-to-show', showWhenReady)
  if (t.url) void ballWin.loadURL(t.url)
  else void ballWin.loadFile(t.file, { hash: t.hash })

  // 悬浮球关不掉（没有关闭控件）；应用退出时随进程销毁
  ballWin.on('close', (e) => {
    if (!quitting) e.preventDefault()
  })
}

function isBallEnabled(): boolean {
  return prefs.get('floatBallEnabled', true) !== false
}

// 设置页开关：隐藏时连面板一起收起；显示时重新置顶
export function setFloatBallEnabled(enabled: boolean): void {
  void prefs.set('floatBallEnabled', enabled)
  if (!enabled) {
    hidePanel()
    if (ballWin && !ballWin.isDestroyed()) ballWin.hide()
  } else if (ballWin && !ballWin.isDestroyed()) {
    ballWin.show()
    ballWin.setAlwaysOnTop(true, 'floating')
  }
}

function panelBounds(mode: 'menu' | 'result'): {
  x: number
  y: number
  width: number
  height: number
} {
  const size = mode === 'menu' ? PANEL_MENU : PANEL_RESULT
  const ball = ballWin?.getBounds() ?? defaultBallPos()
  const disp = screen.getDisplayNearestPoint({ x: ball.x + BALL_SIZE / 2, y: ball.y })
  const wa = disp.workArea
  // 菜单默认在球正下方、水平居中于球（方便鼠标直接下滑进入）；下方放不下才放到上方。
  // 结果面板较大，仍优先上方、右缘与球对齐
  const gap = mode === 'menu' ? MENU_GAP : GAP
  let x = mode === 'menu' ? ball.x + BALL_SIZE / 2 - size.w / 2 : ball.x + BALL_SIZE - size.w
  let y =
    mode === 'menu'
      ? ball.y + BALL_SIZE + gap
      : ball.y - size.h - gap
  if (mode === 'menu') {
    if (y + size.h > wa.y + wa.height - 4) y = ball.y - size.h - gap
  } else if (y < wa.y + 4) {
    y = ball.y + BALL_SIZE + gap
  }
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - size.w - 4)
  y = Math.min(y, wa.y + wa.height - size.h - 4)
  return { x, y, width: size.w, height: size.h }
}

function ensurePanel(): BrowserWindow {
  if (panelWin && !panelWin.isDestroyed()) return panelWin
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  const t = rendererTarget('float-panel')
  if (t.url) void win.loadURL(t.url)
  else void win.loadFile(t.file, { hash: t.hash })
  win.on('blur', () => {
    // 点到面板以外（任务栏/其它窗/桌面）关闭菜单；点球自身时焦点会在球窗，延迟检查后不关。
    // OCR 结果常驻，由按钮关闭
    if (panelMode === 'menu') scheduleMenuHide()
  })
  win.on('focus', clearPendingHide)
  panelWin = win
  return win
}

function showPanel(mode: 'menu' | 'result'): void {
  clearPendingHide()
  panelMode = mode
  const win = ensurePanel()
  let shown = false
  // 渲染端收到 mode 并渲染好正确画面后回调，再真正显示，杜绝旧内容先闪一帧
  const present = (): void => {
    if (shown || panelMode !== mode || win.isDestroyed()) return
    shown = true
    win.setBounds(panelBounds(mode))
    win.show()
    win.focus()
  }
  const fallback = setTimeout(present, 220)
  presentQueue.set(win, () => {
    clearTimeout(fallback)
    present()
  })
  const push = (): void => win.webContents.send('float:mode', mode)
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', push)
  } else {
    push()
  }
}

// 每个面板窗等待一次"画面就绪"回调
const presentQueue = new Map<BrowserWindow, () => void>()

export function hidePanel(): void {
  clearPendingHide()
  panelMode = null
  presentQueue.clear()
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('float:hidden')
    panelWin.hide()
  }
}

// 截屏识别期间：面板隐藏、球上转圈；结束后恢复
export function setBallBusy(busy: boolean): void {
  if (ballWin && !ballWin.isDestroyed()) ballWin.webContents.send('float:busy', busy)
}

export function registerFloatIpc(): void {
  ipcMain.on('float:drag-start', () => {
    if (!ballWin) return
    stopDragTracking()
    dragCursor = screen.getCursorScreenPoint()
    const b = ballWin.getBounds()
    dragOrigin = { x: b.x, y: b.y }
    dragTimer = setInterval(applyDrag, 16)
  })
  // 保留 move 通道：渲染端发来时也立刻应用一次，比 16ms 轮询更跟手
  ipcMain.on('float:drag-move', () => applyDrag())
  ipcMain.on('float:drag-end', () => {
    stopDragTracking()
    if (!ballWin) return
    const [x, y] = ballWin.getPosition()
    savePos(x, y)
  })
  // 渲染端已渲染好目标模式画面，可以显示面板
  ipcMain.on('float:panel-presented', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    const cb = w && presentQueue.get(w)
    if (cb) {
      presentQueue.delete(w)
      cb()
    }
  })
  ipcMain.handle('float:toggle-menu', () => {
    if (panelMode) hidePanel()
    else showPanel('menu')
  })
  ipcMain.handle('float:set-mode', (_e, mode: unknown) => {
    if (mode === 'menu' || mode === 'result') showPanel(mode)
  })
  ipcMain.on('float:hide', () => hidePanel())
  ipcMain.handle('float:get-enabled', () => isBallEnabled())
  ipcMain.handle('float:set-enabled', (_e, enabled: unknown) => {
    setFloatBallEnabled(enabled === true)
    return { ok: true }
  })
}
