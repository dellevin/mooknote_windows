import path from 'node:path'
import { BrowserWindow, clipboard, desktopCapturer, ipcMain, screen } from 'electron'
import { getCloudConfig, recognizeCloud, testCloud } from '../services/cloudOcrService'
import { hidePanel, setBallBusy } from '../floatBall'
import type { OcrLine } from '../../shared/types'

// 截屏选区会话：悬浮球面板发起 ocr:capture 后等待选区结果；
// 每块显示器一个全屏透明置顶窗口，选区窗口把裁剪后的 PNG 回传做云端 OCR。
interface CaptureSession {
  resolve: (lines: OcrLine[] | null) => void
  windows: BrowserWindow[]
  backgrounds: Map<string, string>
  scales: Map<string, number>
  pixels: Map<string, { width: number; height: number }>
  ended: boolean
}

let session: CaptureSession | null = null

function finishSession(lines: OcrLine[] | null): void {
  if (!session || session.ended) return
  const s = session
  s.ended = true
  session = null
  setBallBusy(false)
  s.resolve(lines)
  // 延迟销毁，先让 invoke 应答回到选区窗口
  setTimeout(() => {
    for (const w of s.windows) {
      if (!w.isDestroyed()) w.destroy()
    }
  }, 150)
}

// 把选区窗边界强制撑满整块显示器并顶到 screen-saver 层级，确保盖住 Win11 真实任务栏。
// 仅在选区开始时调用（挂载时 + 120ms 后各一次），不做 blur 循环抢焦。
function raiseCaptureWindow(sender: Electron.WebContents, displayId: string): void {
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

function overlayUrl(displayId: string): { url?: string; file?: string; hash?: string } {
  const hash = `ocr-capture?id=${encodeURIComponent(displayId)}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return { url: `${devUrl}#/${hash}` }
  return {
    file: path.join(__dirname, '../renderer/index.html'),
    hash: `/${hash}`
  }
}

export function registerOcrIpc(): void {
  // 悬浮球面板：进入截屏选区，返回云端识别行；用户取消返回 null
  ipcMain.handle('ocr:capture', async () => {
    if (session) return null

    const displays = screen.getAllDisplays()
    // 每个显示器按自身物理分辨率单独取帧，避免多屏比例不同导致缩略图被等比缩放、裁剪错位
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

    return await new Promise<OcrLine[] | null>((resolve) => {
      const s: CaptureSession = {
        resolve,
        windows: [],
        backgrounds: new Map(),
        scales: new Map(),
        pixels: new Map(),
        ended: false
      }
      session = s
      // 隐藏面板、球上转圈；选区期间悬浮球不挡画面
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
        // screen-saver 层级用于压过 Windows 任务栏，保证屏幕最底部一条也能框选。
        // 注意：不要在 blur 时 moveTop 抢回焦点，否则用户点任务栏/其它窗口会被反复顶回，整屏像卡死。
        win.setAlwaysOnTop(true, 'screen-saver')
        // 必须在「显示之后」再断言一次层级，否则 Win11 任务栏的置顶层级会盖在选区窗上方，
        // 表现为冻结图里一条暗任务栏 + 真实亮任务栏，且底部一条无法框选。
        const raiseAboveTaskbar = (): void => {
          if (session !== s || s.ended || win.isDestroyed()) return
          win.setAlwaysOnTop(true, 'screen-saver', 1)
          win.moveTop()
        }
        const target = overlayUrl(id)
        // 各自内容就绪（已渲染出遮罩/提示，非黑帧）后再显示，避免透明窗黑帧与任务栏闪图标
        win.once('ready-to-show', () => {
          if (session !== s || s.ended || win.isDestroyed()) return
          win.show()
          raiseAboveTaskbar()
        })
        // 兜底：极端情况下 ready-to-show 未触发，1.2s 后也展示，避免屏幕被隐藏窗"锁住"
        setTimeout(() => {
          if (session !== s || s.ended || win.isDestroyed() || win.isVisible()) return
          win.show()
          raiseAboveTaskbar()
        }, 1200)
        if (target.url) void win.loadURL(target.url)
        else void win.loadFile(target.file as string, { hash: target.hash })
        win.on('closed', () => {
          if (session === s && !s.ended) finishSession(null)
        })
        s.windows.push(win)
      }

      if (!s.windows.length) {
        session = null
        resolve(null)
      }
    })
  })

  // 选区窗口：取本显示器截屏底图与缩放比
  ipcMain.handle('ocr:overlay-init', (e, displayId: unknown) => {
    if (!session) return null
    const id = String(displayId)
    const dataUrl = session.backgrounds.get(id)
    if (!dataUrl) return null
    // 此时渲染端已挂载、窗口已完成首帧，是压制 Win11 任务栏的可靠时机
    raiseCaptureWindow(e.sender, id)
    return {
      dataUrl,
      scaleFactor: session.scales.get(id) ?? 1,
      pixels: session.pixels.get(id) ?? null
    }
  })

  // 选区窗口：提交裁剪后的 PNG，主进程调用云端 OCR；失败抛错让选区窗口提示并可重试
  ipcMain.handle('ocr:overlay-result', async (_e, png: ArrayBuffer) => {
    const buf = Buffer.from(png)
    const lines = await recognizeCloud(buf)
    finishSession(lines)
    return { ok: true }
  })

  // 悬浮球面板：云端 OCR 当前提供方与配置状态（决定菜单项是否可用）
  ipcMain.handle('ocr:cloud-config', () => getCloudConfig())

  // 设置页：测试已保存的讯飞星辰凭证是否有效
  ipcMain.handle('ocr:cloud-test', () => testCloud())

  // 选区窗口：Esc / 右键取消
  ipcMain.handle('ocr:overlay-cancel', () => {
    finishSession(null)
    return { ok: true }
  })

  // 面板：复制识别结果到剪贴板（面板窗无焦点时 navigator.clipboard 可能受限）
  ipcMain.handle('ocr:copy-text', (_e, text: unknown) => {
    clipboard.writeText(typeof text === 'string' ? text : '')
    return { ok: true }
  })
}
