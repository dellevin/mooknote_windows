import { BrowserWindow } from 'electron'
import { prefs } from './prefs'

// 截屏 / OCR / 取色时是否先隐藏主窗口：从工具栏发起时默认隐藏，避免把应用自身拍进冻结画面。
// 全屏的选区/悬浮窗不算主窗口。
export type HidePrefKey = 'hideMainOnOcr' | 'hideMainOnShot' | 'hideMainOnColor'

function findMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows().filter((w) => {
    if (w.isDestroyed()) return false
    const b = w.getBounds()
    // 选区/取色覆盖窗与屏幕等大；主窗口有最小尺寸且不会铺满整块屏
    return !(b.width >= 880 && b.height >= 580 && w.isAlwaysOnTop())
  })
  // 取其中面积最大的可见/已建窗口
  return (
    wins.sort((a, z) => {
      const ba = a.getBounds()
      const bz = z.getBounds()
      return bz.width * bz.height - ba.width * ba.height
    })[0] ?? null
  )
}

// 按设置隐藏主窗口，返回恢复函数（无需恢复时返回 null）。必须在抓取屏幕帧之前调用。
export function hideMainWindowIfPref(key: HidePrefKey): (() => void) | null {
  if (prefs.get(key, true) === false) return null
  const win = findMainWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return null
  win.hide()
  return () => {
    if (!win.isDestroyed()) win.show()
  }
}

// 隐藏后给合成器一帧时间，确保接下来 desktopCapturer 抓到的画面里已没有主窗口
export function waitHidden(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
