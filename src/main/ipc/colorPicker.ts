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

function finishSession(canceled: boolean, color: PickedColor | null = null): void {
  if (!session || session.ended) return
  const s = session
  s.ended = true
  session = null
  setBallBusy(false)
  s.restoreMain?.()
  s.resolve({ canceled, color })
  setTimeout(() => {
    for (const w of s.windows) {
      if (!w.isDestroyed()) w.destroy()
    }
  }, 150)
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
    if (session) return { canceled: true, color: null }

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
    if (!session) return null
    const id = String(displayId)
    const dataUrl = session.backgrounds.get(id)
    if (!dataUrl) return null
    raiseColorWindow(e.sender, id)
    return { dataUrl, pixels: session.pixels.get(id) ?? null }
  })

  // 点击像素取色：结束会话，由悬浮球面板弹颜色结果
  ipcMain.handle('color:overlay-pick', (_e, color: unknown) => {
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

  ipcMain.handle('color:overlay-cancel', () => {
    finishSession(true)
    return { ok: true }
  })
}
