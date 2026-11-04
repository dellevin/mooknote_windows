import path from 'node:path'
import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { hidePanel, setBallBusy } from '../floatBall'
import { hideMainWindowIfPref, waitHidden } from '../mainHide'

// 屏幕取色：悬浮球面板发起 color:capture，每块显示器一个全屏透明置顶窗口，
// 渲染端带放大镜十字准星，点击像素后把 RGB 回传，结束会话由面板弹出颜色结果。
export interface PickedColor {
  r: number
  g: number
  b: number
  hex: string
}

interface ColorSession {
  resolve: (outcome: { canceled: boolean; color: PickedColor | null }) => void
  windows: BrowserWindow[]
  backgrounds: Map<string, string>
  pixels: Map<string, { width: number; height: number }>
  restoreMain: (() => void) | null
  ended: boolean
}

let session: ColorSession | null = null

function destroyWindows(s: ColorSession, delay: number): void {
  if (delay <= 0) {
    for (const w of s.windows) {
      if (!w.isDestroyed()) w.destroy()
    }
    return
  }
  setTimeout(() => {
    for (const w of s.windows) {
      if (!w.isDestroyed()) w.destroy()
    }
  }, delay)
}

function finishSession(canceled: boolean, color: PickedColor | null = null, immediate = false): void {
  if (!session || session.ended) return
  const s = session
  s.ended = true
  session = null
  setBallBusy(false)
  s.restoreMain?.()
  s.resolve({ canceled, color })
  // 正常取色延迟销毁，先让 invoke 应答回到覆盖窗；强制清理残留会话时立即销毁，
  // 避免旧窗口后续的取消 IPC 误杀下一个会话
  destroyWindows(s, immediate ? 0 : 150)
}

// 发送方是否为当前会话的覆盖窗（防止上一会话的残留窗口 IPC 影响新会话）
function ownsWindow(sender: Electron.WebContents): boolean {
  if (!session) return false
  const w = BrowserWindow.fromWebContents(sender)
  return !!w && session.windows.includes(w)
}

function raiseColorWindow(sender: Electron.WebContents, displayId: string): void {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return
  const d = screen.getAllDisplays().find((x) => String(x.id) === displayId)
  if (d) win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height })
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.moveTop()
  win.focus()
}

function overlayUrl(displayId: string): { url?: string; file?: string; hash?: string } {
  const hash = `color-picker?id=${encodeURIComponent(displayId)}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}#/${hash}` }
  return { file: path.join(__dirname, '../renderer/index.html'), hash: `/${hash}` }
}

export function registerColorPickerIpc(): void {
  ipcMain.handle('color:capture', async () => {
    // 存在未正常收尾的残留会话时，先强制清理并开启新会话，而不是静默返回取消
    // （否则多屏覆盖窗初始化竞态后，所有取色请求都会“点了没反应”）
    if (session) finishSession(true, null, true)

    const restoreMain = hideMainWindowIfPref('hideMainOnColor')
    hidePanel()
    setBallBusy(true)
    if (restoreMain) await waitHidden()
    const displays = screen.getAllDisplays()
    const shots = new Map<
      string,
      { dataUrl: string; width: number; height: number }
    >()
    for (const d of displays) {
      const w = Math.round(d.size.width * d.scaleFactor) || 1920
      const h = Math.round(d.size.height * d.scaleFactor) || 1080
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: w, height: h }
      })
      const src = sources.find((x) => x.display_id === String(d.id))
      if (src && !src.thumbnail.isEmpty()) {
        shots.set(String(d.id), {
          dataUrl: src.thumbnail.toDataURL(),
          width: src.thumbnail.getSize().width,
          height: src.thumbnail.getSize().height
        })
      }
    }

    return await new Promise<{ canceled: boolean; color: PickedColor | null }>((resolve) => {
      const s: ColorSession = {
        resolve,
        windows: [],
        backgrounds: new Map(),
        pixels: new Map(),
        restoreMain,
        ended: false
      }
      session = s

      for (const d of displays) {
        const id = String(d.id)
        const shot = shots.get(id)
        if (!shot) continue
        s.backgrounds.set(id, shot.dataUrl)
        s.pixels.set(id, { width: shot.width, height: shot.height })

        const win = new BrowserWindow({
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
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
        win.setAlwaysOnTop(true, 'screen-saver')
        const raiseAboveTaskbar = (): void => {
          if (session !== s || s.ended || win.isDestroyed()) return
          win.setAlwaysOnTop(true, 'screen-saver', 1)
          win.moveTop()
        }
        const target = overlayUrl(id)
        win.once('ready-to-show', () => {
          if (session !== s || s.ended || win.isDestroyed()) return
          win.show()
          raiseAboveTaskbar()
        })
        setTimeout(() => {
          if (session !== s || s.ended || win.isDestroyed() || win.isVisible()) return
          win.show()
          raiseAboveTaskbar()
        }, 1200)
        if (target.url) void win.loadURL(target.url)
        else void win.loadFile(target.file as string, { hash: target.hash })
        win.on('closed', () => {
          if (session === s && !s.ended) finishSession(true)
        })
        s.windows.push(win)
      }

      if (!s.windows.length) {
        session = null
        restoreMain?.()
        resolve({ canceled: true, color: null })
      }
    })
  })

  ipcMain.handle('color:overlay-init', (e, displayId: unknown) => {
    const s = session
    if (!s || !ownsWindow(e.sender)) return null
    const id = String(displayId)
    const dataUrl = s.backgrounds.get(id)
    if (!dataUrl) return null
    raiseColorWindow(e.sender, id)
    return { dataUrl, pixels: s.pixels.get(id) ?? null }
  })

  // 点击像素取色：结束会话，由悬浮球面板弹颜色结果
  ipcMain.handle('color:overlay-pick', (e, color: unknown) => {
    if (!ownsWindow(e.sender)) return { ok: false }
    const c = color as Partial<PickedColor> | null
    if (
      c &&
      Number.isInteger(c.r) && Number.isInteger(c.g) && Number.isInteger(c.b) &&
      typeof c.hex === 'string'
    ) {
      finishSession(false, { r: c.r!, g: c.g!, b: c.b!, hex: c.hex })
    } else {
      finishSession(true)
    }
    return { ok: true }
  })

  ipcMain.handle('color:overlay-cancel', (e) => {
    // 仅归属当前会话的窗口可取消，防止旧窗口的 Esc/右键误杀新会话
    if (ownsWindow(e.sender)) finishSession(true)
    return { ok: true }
  })
}
