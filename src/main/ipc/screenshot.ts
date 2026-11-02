import path from 'node:path'
import fs from 'node:fs/promises'
import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron'
import { recognizeCloud } from '../services/cloudOcrService'
import { hidePanel, setBallBusy } from '../floatBall'
import type { OcrLine } from '../../shared/types'

// 钉在桌面上的截图窗（独立于截屏会话，会话结束不销毁）
const pins = new Set<BrowserWindow>()
// 钉图窗按 id 暂存图片，渲染页挂载后通过 shot:pin-init 取回（不用 data: URL 导航，新版 Chromium 会拦截）
const pinPayloads = new Map<string, { dataUrl: string }>()

// 截屏会话：悬浮球面板发起 shot:capture 后等待会话结束（保存/钉住/取消）；
// 每块显示器一个全屏透明置顶窗口，选区窗在渲染端完成标注后把 PNG 回传保存/钉住/OCR。
interface ShotSession {
  resolve: (outcome: { canceled: boolean; lines: OcrLine[] | null }) => void
  windows: BrowserWindow[]
  backgrounds: Map<string, string>
  scales: Map<string, number>
  pixels: Map<string, { width: number; height: number }>
  ended: boolean
}

let session: ShotSession | null = null

function finishSession(canceled: boolean, lines: OcrLine[] | null = null): void {
  if (!session || session.ended) return
  const s = session
  s.ended = true
  session = null
  setBallBusy(false)
  s.resolve({ canceled, lines })
  // 延迟销毁，先让 invoke 应答回到选区窗口
  setTimeout(() => {
    for (const w of s.windows) {
      if (!w.isDestroyed()) w.destroy()
    }
  }, 150)
}

// 把选区窗边界强制撑满整块显示器并顶到 screen-saver 层级，确保盖住 Win11 真实任务栏。
function raiseShotWindow(sender: Electron.WebContents, displayId: string): void {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return
  const d = screen.getAllDisplays().find((x) => String(x.id) === displayId)
  if (d) win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height })
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.moveTop()
  win.focus()
  setTimeout(() => {
    if (win.isDestroyed() || !session || session.ended) return
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }, 120)
}

function rendererPageUrl(hash: string): { url?: string; file?: string; hash?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}#/${hash}` }
  return {
    file: path.join(__dirname, '../renderer/index.html'),
    hash: `/${hash}`
  }
}

function overlayUrl(displayId: string): { url?: string; file?: string; hash?: string } {
  return rendererPageUrl(`screenshot-capture?id=${encodeURIComponent(displayId)}`)
}

export function registerScreenshotIpc(): void {
  // 悬浮球面板：进入微信式截屏标注；保存/钉住/取消后返回
  ipcMain.handle('shot:capture', async () => {
    if (session) return { canceled: true, lines: null }

    const displays = screen.getAllDisplays()
    // 每个显示器按自身物理分辨率单独取帧，避免多屏比例不同导致裁剪错位
    const shots = new Map<
      string,
      { dataUrl: string; width: number; height: number; scaleFactor: number }
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
          height: src.thumbnail.getSize().height,
          scaleFactor: d.scaleFactor
        })
      }
    }

    return await new Promise<{ canceled: boolean; lines: OcrLine[] | null }>((resolve) => {
      const s: ShotSession = {
        resolve,
        windows: [],
        backgrounds: new Map(),
        scales: new Map(),
        pixels: new Map(),
        ended: false
      }
      session = s
      // 隐藏面板、球上转圈；截屏期间悬浮球不挡画面
      hidePanel()
      setBallBusy(true)

      for (const d of displays) {
        const id = String(d.id)
        const shot = shots.get(id)
        if (!shot) continue
        s.backgrounds.set(id, shot.dataUrl)
        s.scales.set(id, d.scaleFactor)
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
        // screen-saver 层级用于压过 Windows 任务栏；不要在 blur 时抢焦，否则整屏像卡死
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
        // 兜底：ready-to-show 未触发时也展示，避免屏幕被隐藏窗"锁住"
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
        resolve({ canceled: true, lines: null })
      }
    })
  })

  // 选区窗口：取本显示器截屏底图与缩放比
  ipcMain.handle('shot:overlay-init', (e, displayId: unknown) => {
    if (!session) return null
    const id = String(displayId)
    const dataUrl = session.backgrounds.get(id)
    if (!dataUrl) return null
    // 此时渲染端已挂载、窗口已完成首帧，是压制 Win11 任务栏的可靠时机
    raiseShotWindow(e.sender, id)
    return {
      dataUrl,
      scaleFactor: session.scales.get(id) ?? 1,
      pixels: session.pixels.get(id) ?? null
    }
  })

  // 选区窗口：对裁剪后的原图做云端 OCR，识别完成后结束选区会话，由悬浮球面板弹出结果
  ipcMain.handle('shot:overlay-ocr', async (_e, png: ArrayBuffer): Promise<{ ok: boolean }> => {
    const lines = await recognizeCloud(Buffer.from(png))
    finishSession(false, lines)
    return { ok: true }
  })

  // Esc / 右键 / 关闭按钮
  ipcMain.handle('shot:overlay-cancel', () => {
    finishSession(true)
    return { ok: true }
  })

  // 保存标注后的截图：弹系统另存为，写入 PNG，随后结束会话
  ipcMain.handle('shot:overlay-save', async (e, png: ArrayBuffer) => {
    const buf = Buffer.from(png)
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14)
    // 选区窗处于 screen-saver 置顶层级，会把系统另存为压在下面；
    // 弹框前先取消置顶，并以触发窗为父窗口弹出模态对话框
    const parent = BrowserWindow.fromWebContents(e.sender)
    const overlays = session?.windows ?? []
    for (const w of overlays) {
      if (!w.isDestroyed()) w.setAlwaysOnTop(false)
    }
    const r = await dialog.showSaveDialog(parent ?? undefined, {
      title: '保存截图',
      defaultPath: `mooknote-${stamp}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (r.canceled || !r.filePath) {
      // 用户取消：恢复选区窗置顶层级，继续截屏会话
      for (const w of overlays) {
        if (!w.isDestroyed()) w.setAlwaysOnTop(true, 'screen-saver', 1)
      }
      parent?.moveTop?.()
      return { ok: false, canceled: true }
    }
    await fs.writeFile(r.filePath, buf)
    finishSession(false)
    return { ok: true, path: r.filePath }
  })

  // 钉图：把标注截图放进一个独立、置顶、可拖动的小窗，留在选区原来的屏幕位置；随后结束选区会话
  ipcMain.handle(
    'shot:overlay-pin',
    (e, payload: { dataUrl?: string; width?: number; height?: number; x?: number; y?: number }) => {
      const dataUrl = String(payload?.dataUrl ?? '')
      const width = Math.max(40, Math.round(Number(payload?.width) || 200))
      const height = Math.max(40, Math.round(Number(payload?.height) || 120))
      if (!dataUrl.startsWith('data:image')) return { ok: false }

      // 选区坐标是相对当前覆盖窗（= 该显示器）的 CSS 坐标，加上覆盖窗屏幕偏移得到全局坐标
      const overlay = BrowserWindow.fromWebContents(e.sender)
      const ob = overlay?.getBounds()
      let px = Number(payload?.x)
      let py = Number(payload?.y)
      if (ob && Number.isFinite(px) && Number.isFinite(py)) {
        px += ob.x
        py += ob.y
      }

      const id = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      pinPayloads.set(id, { dataUrl })

      const hasPos = Number.isFinite(px) && Number.isFinite(py)
      const win = new BrowserWindow({
        ...(hasPos ? { x: Math.round(px), y: Math.round(py) } : {}),
        width,
        height,
        frame: false,
        transparent: true,
        resizable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: path.join(__dirname, '../preload/index.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      // 用 screen-saver 层级并顶到最前，保证钉图压在其它窗口之上
      const bringToFront = (): void => {
        if (win.isDestroyed()) return
        win.setAlwaysOnTop(true, 'screen-saver', 1)
        win.moveTop()
      }
      win.once('ready-to-show', () => {
        bringToFront()
        win.showInactive()
      })
      const target = rendererPageUrl(`shot-pin?id=${encodeURIComponent(id)}`)
      if (target.url) void win.loadURL(target.url)
      else void win.loadFile(target.file as string, { hash: target.hash })
      // 加载完成后再断言一次层级，避免被普通置顶窗口盖住
      win.webContents.once('did-finish-load', bringToFront)
      win.on('closed', () => {
        pins.delete(win)
        pinPayloads.delete(id)
      })
      pins.add(win)
      finishSession(false)
      return { ok: true }
    }
  )

  // 钉图窗：取回本窗要显示的截图
  ipcMain.handle('shot:pin-init', (_e, id: unknown) => {
    return pinPayloads.get(String(id))?.dataUrl ?? null
  })

  // 钉图窗：关闭（透明无边框窗里 app-region drag 会吞掉按钮点击，改由主进程关闭）
  ipcMain.on('shot:pin-close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}
