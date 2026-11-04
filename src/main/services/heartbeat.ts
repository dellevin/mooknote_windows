import { app, BrowserWindow } from 'electron'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { prefs } from '../prefs'

// 与 Flutter 端 ServerConfig 对齐：开发走局域网，生产走线上
const BASE_URL = import.meta.env.DEV
  ? 'http://192.168.31.48:27047'
  : 'http://api.mooknote.iletter.top'

// 与 Flutter 端 usage_stats_service 对齐的匿名心跳统计。
// 前台每 60s POST 一次 /api/heartbeat，服务端按心跳条数折算当日使用分钟数。
const HEARTBEAT_URL = `${BASE_URL}/api/heartbeat`
const HEARTBEAT_INTERVAL_MS = 60 * 1000
const REQUEST_TIMEOUT_MS = 5000
const DEVICE_ID_KEY = 'deviceId'

let started = false
let sending = false

// 设备标识：首次启动生成并持久化一个随机 UUID（Flutter 桌面端同样回退到 uuid v4）。
// 服务端会再做一次 SHA-256，客户端只需保证每次发送同一个稳定字符串即可。
function ensureDeviceId(): string {
  let id = prefs.get<string>(DEVICE_ID_KEY, '')
  if (!id) {
    id = randomUUID()
    prefs.set(DEVICE_ID_KEY, id)
  }
  return id
}

async function sendHeartbeat(): Promise<void> {
  // 并发保护：上一次未返回时跳过本轮
  if (sending) return
  sending = true
  try {
    const deviceHash = ensureDeviceId()
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_hash: deviceHash,
        device_type: 'windows',
        device_name: `windows ${os.release()}`,
        app_version: app.getVersion()
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch {
    // 静默失败，不影响主流程
  } finally {
    sending = false
  }
}

// 应用在前台 = 主窗口可见且未最小化（最小化到托盘视为后台，暂停心跳）
function isForeground(win: BrowserWindow): boolean {
  return win.isVisible() && !win.isMinimized()
}

export function startHeartbeat(mainWin: BrowserWindow): void {
  if (started) return
  started = true

  // 启动后立即发一次（此时主窗口已创建）
  if (isForeground(mainWin)) void sendHeartbeat()

  // 周期心跳：仅在前台时发送
  const timer = setInterval(() => {
    if (isForeground(mainWin)) void sendHeartbeat()
  }, HEARTBEAT_INTERVAL_MS)
  // 定时器不阻止进程退出
  timer.unref?.()

  // 从托盘/最小化回到前台：立即补一次心跳
  const onActivated = (): void => {
    if (isForeground(mainWin)) void sendHeartbeat()
  }
  mainWin.on('show', onActivated)
  mainWin.on('restore', onActivated)
}
