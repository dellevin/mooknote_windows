import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { prefs } from '../prefs'
import { buildBackupZip, restoreFromShardDir, restoreFromZip, type RestoreResult } from './backupService'

// 与 Flutter WebDAVService 行为对齐：
// - 单 zip 上传，文件名 mooknote_backup_<毫秒时间戳>.zip，保留最新 5 个
// - Basic → 401 → Digest(MD5 qop=auth) 重试；手动处理重定向
// - PUT 后 HEAD 大小校验，坚果云 0 字节重试，Range GET 兜底，代理全拦时信任 PUT
const CONFIG_KEY = 'webdav_config'
const LAST_SYNC_KEY = 'webdav_last_sync'
const BACKUP_PREFIX = 'mooknote_backup_'
const MAX_BACKUPS = 5
const TIMEOUT_MS = 120000
const SHORT_TIMEOUT_MS = 60000

export interface WebDavConfig {
  url: string
  username: string
  password: string
  path: string
}

export function getConfig(): WebDavConfig | null {
  const raw = prefs.get<string>(CONFIG_KEY, '')
  if (!raw) return null
  try {
    return JSON.parse(raw) as WebDavConfig
  } catch {
    return null
  }
}

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

function normalizePath(p: string): string {
  let s = p.trim()
  if (!s || s === '/') return ''
  if (!s.startsWith('/')) s = '/' + s
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

function dirUrl(cfg: WebDavConfig): string {
  const base = cfg.url.endsWith('/') ? cfg.url.slice(0, -1) : cfg.url
  return base + normalizePath(cfg.path)
}

function basicAuth(cfg: WebDavConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`, 'utf-8').toString('base64')
}

function md5(s: string): string {
  return crypto.createHash('md5').update(s, 'utf-8').digest('hex')
}

/** 解析 WWW-Authenticate Digest 挑战并生成 Authorization（RFC 7616, MD5/MD5-sess, qop=auth） */
function buildDigestHeader(challenge: string, method: string, url: URL, cfg: WebDavConfig): string | null {
  const params: Record<string, string> = {}
  const re = /(\w+)=(?:"([^"]*)"|([^,\s"]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(challenge))) {
    params[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  }
  const realm = params['realm']
  const nonce = params['nonce']
  if (!realm || !nonce) return null
  const algorithm = (params['algorithm'] ?? 'MD5').toUpperCase()
  if (algorithm !== 'MD5' && algorithm !== 'MD5-SESS') return null

  let qop: string | null = null
  if (params['qop']) {
    const qops = params['qop'].split(',').map((x) => x.trim().toLowerCase())
    if (qops.includes('auth')) qop = 'auth'
  }

  const cnonce = crypto.randomBytes(16).toString('hex')
  let ha1 = md5(`${cfg.username}:${realm}:${cfg.password}`)
  if (algorithm === 'MD5-SESS') ha1 = md5(`${ha1}:${nonce}:${cnonce}`)
  const digestUri = url.search ? `${url.pathname}?${url.searchParams.toString()}` : url.pathname || '/'
  const ha2 = md5(`${method}:${digestUri}`)

  let header =
    `Digest username="${cfg.username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${digestUri}", algorithm=${algorithm}`
  if (qop) {
    const nc = '00000001'
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    header += `, response="${response}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"`
  } else {
    header += `, response="${md5(`${ha1}:${nonce}:${ha2}`)}"`
  }
  if (params['opaque']) header += `, opaque="${params['opaque']}"`
  return header
}

interface RawResponse {
  status: number
  headers: Headers
  body: Buffer
}

/**
 * 发起请求并返回“最终” Response（不读 body）：
 * Basic 首试，401 且要求 Digest 时重算重试；手动跟随 301/302/307/308（最多 5 次）。
 * 调用方负责读取/取消 resp.body。
 */
async function fetchFinal(
  cfg: WebDavConfig,
  method: string,
  rawUrl: string,
  opts: {
    headers?: Record<string, string>
    body?: Buffer | string
    timeout?: number
  },
  redirects = 0,
  authorization?: string | null
): Promise<Response> {
  const url = new URL(rawUrl)
  const timeout = opts.timeout ?? SHORT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  headers['Authorization'] = authorization ?? basicAuth(cfg)

  let resp: Response
  try {
    resp = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body as any,
      signal: controller.signal,
      redirect: 'manual'
    })
  } finally {
    clearTimeout(timer)
  }

  if (resp.status === 401) {
    const challenge = resp.headers.get('www-authenticate')
    if (challenge && challenge.toLowerCase().startsWith('digest')) {
      const digest = buildDigestHeader(challenge, method, url, cfg)
      if (digest) return fetchFinal(cfg, method, rawUrl, opts, redirects, digest)
    }
  }

  if ([301, 302, 307, 308].includes(resp.status)) {
    const location = resp.headers.get('location')
    if (location && redirects < 5) {
      const next = new URL(location, url).toString()
      return fetchFinal(cfg, method, next, opts, redirects + 1, authorization)
    }
  }

  return resp
}

/**
 * 带认证的请求：在 fetchFinal 基础上整体缓冲 body。
 */
async function sendAuthed(
  cfg: WebDavConfig,
  method: string,
  rawUrl: string,
  opts: {
    headers?: Record<string, string>
    body?: Buffer | string
    timeout?: number
    authorization?: string | null
  } = {}
): Promise<RawResponse> {
  const resp = await fetchFinal(cfg, method, rawUrl, opts, 0, opts.authorization ?? null)
  const body = Buffer.from(await resp.arrayBuffer())
  return { status: resp.status, headers: resp.headers, body }
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

/** PUT 后校验远程大小：HEAD（坚果云 0 重试 3 次）→ Range GET 兜底 → 代理全拦时信任 PUT */
async function verifyRemoteSize(cfg: WebDavConfig, target: string, expected: number): Promise<boolean> {
  let headSupported = true
  for (let i = 0; i < 3; i++) {
    const h = await sendAuthed(cfg, 'HEAD', target)
    if (h.status !== 200) {
      headSupported = false
      break
    }
    const len = Number(h.headers.get('content-length') ?? NaN)
    if (Number.isFinite(len) && len > 0) return len === expected
    await new Promise((r) => setTimeout(r, 1500)) // 等待坚果云异步落盘
  }
  try {
    const g = await sendAuthed(cfg, 'GET', target, { headers: { Range: 'bytes=0-0' } })
    if (g.status === 206) {
      const cr = g.headers.get('content-range') ?? ''
      const total = Number(cr.split('/').pop() ?? NaN)
      if (Number.isFinite(total)) return total === expected
    } else if (g.status === 200) {
      const len = Number(g.headers.get('content-length') ?? NaN)
      if (Number.isFinite(len)) return len === expected
    } else if (!headSupported) {
      return true // HEAD/Range 均被代理改写，信任 PUT 成功码
    }
  } catch {
    if (!headSupported) return true
  }
  return false
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

export async function uploadBackup(): Promise<SyncOutcome> {
  const cfg = getConfig()
  if (!cfg) return { success: false, message: '未配置 WebDAV' }
  if (syncing) return { success: false, message: '同步正在进行中，请稍后再试' }
  syncing = true

  let zipPath = ''
  try {
    const built = buildBackupZip()
    zipPath = built.zipPath
    const buf = fs.readFileSync(zipPath)
    const name = `${BACKUP_PREFIX}${Date.now()}.zip`
    const target = `${dirUrl(cfg)}/${name}`

    const r = await sendAuthed(cfg, 'PUT', target, {
      headers: { 'Content-Type': 'application/zip' },
      body: buf,
      timeout: Math.max(TIMEOUT_MS, 60000 + Math.floor(buf.length / 65536))
    })
    if (![200, 201, 204].includes(r.status)) {
      return { success: false, message: `上传备份文件失败：HTTP ${r.status}` }
    }
    const ok = await verifyRemoteSize(cfg, target, buf.length)
    if (!ok) return { success: false, message: '上传校验失败：远程文件大小不一致（可能是空间不足或代理假成功）' }

    await cleanupOldBackups(cfg)
    prefs.set(LAST_SYNC_KEY, new Date().toISOString())
    return { success: true, message: '同步完成', imageCount: built.imageCount }
  } catch (e) {
    return { success: false, message: `上传失败：${String(e)}` }
  } finally {
    if (zipPath) fs.rmSync(zipPath, { force: true })
    syncing = false
  }
}

/** (已下载字节, 总字节[未知时为 0]) */
export type ProgressCb = (received: number, total: number) => void

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
