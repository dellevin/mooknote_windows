import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { prefs } from '../prefs'
import { buildBackupZip, restoreFromShardDir, restoreFromZip, type RestoreResult } from './backupService'
import {
  TIMEOUT_MS,
  getConfig,
  dirUrl,
  fetchFinal,
  sendAuthed,
  verifyRemoteSize,
  type WebDavConfig
} from './webdavHttp'

// 与 Flutter WebDAVService 行为对齐：
// - 单 zip 上传，文件名 mooknote_backup_<毫秒时间戳>.zip，保留最新 5 个
// - Basic → 401 → Digest(MD5 qop=auth) 重试；手动处理重定向
// - PUT 后 HEAD 大小校验，坚果云 0 字节重试，Range GET 兜底，代理全拦时信任 PUT
const LAST_SYNC_KEY = 'webdav_last_sync'
const CONFIG_KEY = 'webdav_config'
const BACKUP_PREFIX = 'mooknote_backup_'
const MAX_BACKUPS = 5

export type { WebDavConfig }
export { getConfig }

export function saveConfig(cfg: WebDavConfig): void {
  prefs.set(CONFIG_KEY, JSON.stringify(cfg))
}

export function clearConfig(): void {
  prefs.set(CONFIG_KEY, '')
  prefs.set(LAST_SYNC_KEY, '')
}

export function getLastSync(): string {
  return prefs.get<string>(LAST_SYNC_KEY, '')
}

// ── 连接测试 ────────────────────────────────────────────

export async function testConnection(cfg: WebDavConfig): Promise<{ success: boolean; message: string }> {
  const base = dirUrl(cfg)
  try {
    const pf = await sendAuthed(cfg, 'PROPFIND', base, {
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>'
    })
    if (pf.status === 207) return { success: true, message: '连接成功' }
    if (pf.status === 401) return { success: false, message: '认证失败，请检查用户名和密码' }

    // PROPFIND 被 WAF 拦截时，退化为 MKCOL 探测
    const mk = await sendAuthed(cfg, 'MKCOL', base)
    if ([201].includes(mk.status)) return { success: true, message: '连接成功，已创建目录' }
    if ([200, 204, 405].includes(mk.status)) return { success: true, message: '连接成功，目录已存在' }
    if (mk.status === 403) return { success: true, message: '连接成功（服务器拒绝 MKCOL，目录应已存在）' }
    if (mk.status === 401) return { success: false, message: '认证失败，请检查用户名和密码' }
    if (mk.status === 409) return { success: false, message: '父目录不存在，请检查路径' }
    return { success: false, message: `创建目录失败：HTTP ${mk.status}` }
  } catch (e) {
    return { success: false, message: `连接失败：${String(e)}` }
  }
}

// ── 远程备份枚举 ────────────────────────────────────────

interface RemoteEntry {
  name: string
  isDir: boolean
}

async function listBackups(cfg: WebDavConfig): Promise<RemoteEntry[]> {
  const r = await sendAuthed(cfg, 'PROPFIND', dirUrl(cfg), {
    headers: { Depth: '1', 'Cache-Control': 'no-cache' }
  })
  if (r.status !== 207) return []
  const xml = r.body.toString('utf-8')
  const re = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/gi
  const out: RemoteEntry[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    let href = decodeURIComponent(m[1])
    const isDir = href.endsWith('/')
    const segs = href.split('/').filter(Boolean)
    const name = segs[segs.length - 1]
    if (!name || !name.startsWith(BACKUP_PREFIX)) continue
    if (isDir) out.push({ name, isDir: true })
    else if (name.endsWith('.zip')) out.push({ name, isDir: false })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

async function deleteRemote(cfg: WebDavConfig, target: string): Promise<boolean> {
  const r = await sendAuthed(cfg, 'DELETE', target)
  return [200, 204, 404].includes(r.status)
}

async function cleanupOldBackups(cfg: WebDavConfig): Promise<void> {
  const backups = await listBackups(cfg)
  if (backups.length <= MAX_BACKUPS) return
  const base = dirUrl(cfg)
  for (const e of backups.slice(0, backups.length - MAX_BACKUPS)) {
    await deleteRemote(cfg, `${base}/${e.name}`)
  }
}

// ── 上传 / 下载 ─────────────────────────────────────────

export interface SyncOutcome {
  success: boolean
  message: string
  imageCount?: number
  needReload?: boolean
  stats?: Record<string, number>
  imageFailures?: number
}

let syncing = false

export async function uploadBackup(onProgress?: ProgressCb): Promise<SyncOutcome> {
  const cfg = getConfig()
  if (!cfg) return { success: false, message: '未配置 WebDAV' }
  if (syncing) return { success: false, message: '同步正在进行中，请稍后再试' }
  syncing = true

  let zipPath = ''
  try {
    const built = buildBackupZip()
    zipPath = built.zipPath
    const total = fs.statSync(zipPath).size
    const name = `${BACKUP_PREFIX}${Date.now()}.zip`
    const target = `${dirUrl(cfg)}/${name}`

    // 流式 PUT：边读边发并上报已发送字节，大备份也能显示上传进度
    const nodeStream = fs.createReadStream(zipPath, { highWaterMark: 256 * 1024 })
    let sent = 0
    nodeStream.on('data', (chunk) => {
      sent += chunk.length
      onProgress?.(sent, total)
    })
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>

    const r = await sendAuthed(cfg, 'PUT', target, {
      headers: { 'Content-Type': 'application/zip', 'Content-Length': String(total) },
      body,
      streamBody: true,
      timeout: Math.max(TIMEOUT_MS, 60000 + Math.floor(total / 65536))
    })
    if (![200, 201, 204].includes(r.status)) {
      return { success: false, message: `上传备份文件失败：HTTP ${r.status}` }
    }
    onProgress?.(total, total, 'transfer')
    onProgress?.(total, total, 'verify')
    const ok = await verifyRemoteSize(cfg, target, total)
    if (!ok) return { success: false, message: '上传校验失败：远程文件大小不一致（可能是空间不足或代理假成功）' }

    // 旧备份清理是锦上添花（枚举 + 多次 DELETE，坚果云很慢），放到后台执行，
    // 不再阻塞“上传成功”返回；失败也不影响本次备份。
    void cleanupOldBackups(cfg).catch(() => undefined)
    prefs.set(LAST_SYNC_KEY, new Date().toISOString())
    return { success: true, message: '同步完成', imageCount: built.imageCount }
  } catch (e) {
    return { success: false, message: `上传失败：${String(e)}` }
  } finally {
    if (zipPath) fs.rmSync(zipPath, { force: true })
    syncing = false
  }
}

/** 同步阶段：传输字节 / 上传后服务器校验 / 清理旧备份 */
export type SyncStage = 'transfer' | 'verify' | 'cleanup'

/** (已传输字节, 总字节[未知时为 0], 当前阶段) */
export type ProgressCb = (received: number, total: number, stage?: SyncStage) => void

async function downloadToFile(
  cfg: WebDavConfig,
  target: string,
  dest: string,
  onProgress?: ProgressCb,
  byteOffset = 0
): Promise<boolean> {
  const resp = await fetchFinal(cfg, 'GET', target, { timeout: TIMEOUT_MS })
  if (resp.status !== 200) return false
  const expected = Number(resp.headers.get('content-length') ?? NaN)
  const total = Number.isFinite(expected) && expected >= 0 ? expected : 0
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  const stream = resp.body as unknown as ReadableStream<Uint8Array> | null
  if (!stream || typeof stream.getReader !== 'function') {
    // 兜底：环境未提供 web 流时整体缓冲
    const buf = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(dest, buf)
    if (total && buf.length < total) {
      fs.rmSync(dest, { force: true })
      return false
    }
    onProgress?.(byteOffset + buf.length, total)
    return true
  }

  const ws = fs.createWriteStream(dest)
  const reader = stream.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || !value.length) continue
      received += value.length
      await new Promise<void>((resolve, reject) => {
        ws.write(value, (err) => (err ? reject(err) : resolve()))
      })
      onProgress?.(byteOffset + received, total ? byteOffset + total : 0)
    }
    await new Promise<void>((resolve, reject) => {
      ws.once('error', reject)
      ws.end(() => resolve())
    })
  } catch {
    ws.destroy()
    fs.rmSync(dest, { force: true })
    return false
  }
  if (total && received < total) {
    fs.rmSync(dest, { force: true })
    return false
  }
  return true
}

/** 下载分片目录备份：manifest.json 校验 + 顺序下载 data.zip / images_NNN.zip */
async function downloadShardDir(
  cfg: WebDavConfig,
  name: string,
  onProgress?: ProgressCb
): Promise<string | null> {
  const base = `${dirUrl(cfg)}/${name}`
  const local = path.join(os.tmpdir(), `mooknote_dl_${Date.now()}`)
  fs.mkdirSync(local, { recursive: true })
  const fail = (): null => {
    fs.rmSync(local, { recursive: true, force: true })
    return null
  }

  const manifestPath = path.join(local, 'manifest.json')
  if (!(await downloadToFile(cfg, `${base}/manifest.json`, manifestPath))) return fail()

  let shards: string[]
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    shards = (manifest.shards as unknown[]).map(String)
  } catch {
    return fail()
  }
  if (
    shards.some((s) => s.includes('/') || s.includes('\\') || s === '..' || !s)
  ) {
    return fail()
  }
  let offset = 0
  for (const s of shards) {
    const dest = path.join(local, s)
    if (!(await downloadToFile(cfg, `${base}/${s}`, dest, onProgress, offset))) return fail()
    offset += fs.statSync(dest).size
  }
  return local
}

export async function downloadBackup(onProgress?: ProgressCb): Promise<SyncOutcome> {
  const cfg = getConfig()
  if (!cfg) return { success: false, message: '未配置 WebDAV' }
  if (syncing) return { success: false, message: '同步正在进行中，请稍后再试' }
  syncing = true

  let localDir = ''
  let zipPath = ''
  try {
    const backups = await listBackups(cfg)
    if (!backups.length) return { success: false, message: '服务器上没有备份文件，请先从其他设备上传' }
    const latest = backups[backups.length - 1]

    let result: RestoreResult
    if (latest.isDir) {
      const dir = await downloadShardDir(cfg, latest.name, onProgress)
      if (!dir) return { success: false, message: '下载备份文件失败' }
      localDir = dir
      result = restoreFromShardDir(dir)
    } else {
      zipPath = path.join(os.tmpdir(), `mooknote_download_${Date.now()}.zip`)
      const ok = await downloadToFile(
        cfg,
        `${dirUrl(cfg)}/${latest.name}`,
        zipPath,
        onProgress
      )
      if (!ok) return { success: false, message: '下载备份文件失败' }
      result = restoreFromZip(zipPath)
    }

    if (!result.success) return { success: false, message: result.error ?? '恢复备份失败' }
    prefs.set(LAST_SYNC_KEY, new Date().toISOString())
    return {
      success: true,
      message: '同步完成',
      imageCount: result.imageCount,
      needReload: true,
      stats: result.stats,
      imageFailures: result.imageFailures
    }
  } catch (e) {
    return { success: false, message: `下载失败：${String(e)}` }
  } finally {
    if (localDir) fs.rmSync(localDir, { recursive: true, force: true })
    if (zipPath) fs.rmSync(zipPath, { force: true })
    syncing = false
  }
}
