import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { prefs } from '../prefs'

// 共享 WebDAV HTTP 传输层：整包备份（webdavService）与增量同步（sync/*）共用。
// 行为与 Flutter WebDAVService 对齐：
// - Basic → 401 → Digest(MD5 qop=auth) 重试；手动处理重定向
// - PUT 后 HEAD 大小校验，坚果云 0 字节重试，Range GET 兜底，代理全拦时信任 PUT
export const TIMEOUT_MS = 120000
export const SHORT_TIMEOUT_MS = 60000

export interface WebDavConfig {
  url: string
  username: string
  password: string
  path: string
}

const CONFIG_KEY = 'webdav_config'

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

export function clearConfigKeys(...keys: string[]): void {
  for (const k of keys) prefs.set(k, '')
}

export function normalizePath(p: string): string {
  let s = p.trim()
  if (!s || s === '/') return ''
  if (!s.startsWith('/')) s = '/' + s
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

export function dirUrl(cfg: WebDavConfig): string {
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

export interface RawResponse {
  status: number
  headers: Headers
  body: Buffer
}

export interface RequestOpts {
  headers?: Record<string, string>
  body?: Buffer | string | ReadableStream<Uint8Array>
  timeout?: number
  streamBody?: boolean
  authorization?: string | null
}

/**
 * 发起请求并返回“最终” Response（不读 body）：
 * Basic 首试，401 且要求 Digest 时重算重试；手动跟随 301/302/307/308（最多 5 次）。
 */
export async function fetchFinal(
  cfg: WebDavConfig,
  method: string,
  rawUrl: string,
  opts: RequestOpts,
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
      body: opts.body as never,
      // undici 要求流式请求体显式声明 half duplex
      ...(opts.streamBody ? { duplex: 'half' } : {}),
      signal: controller.signal,
      redirect: 'manual'
    } as RequestInit)
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

/** 带认证的请求：在 fetchFinal 基础上整体缓冲 body。 */
export async function sendAuthed(
  cfg: WebDavConfig,
  method: string,
  rawUrl: string,
  opts: RequestOpts = {}
): Promise<RawResponse> {
  const resp = await fetchFinal(cfg, method, rawUrl, opts, 0, opts.authorization ?? null)
  const body = Buffer.from(await resp.arrayBuffer())
  return { status: resp.status, headers: resp.headers, body }
}

/** PUT 后校验远程大小：HEAD（最多 2 次）→ Range GET 兜底 → 代理全拦时信任 PUT */
export async function verifyRemoteSize(
  cfg: WebDavConfig,
  target: string,
  expected: number
): Promise<boolean> {
  let headSupported = true
  for (let i = 0; i < 2; i++) {
    const h = await sendAuthed(cfg, 'HEAD', target)
    if (h.status !== 200) {
      headSupported = false
      break
    }
    const len = Number(h.headers.get('content-length') ?? NaN)
    if (Number.isFinite(len) && len > 0) return len === expected
    if (i < 1) await new Promise((r) => setTimeout(r, 500)) // 等待坚果云异步落盘（最后一次不再等）
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

/** PUT 字节并校验大小；增量同步的 manifest/delta/blob 上传共用 */
export async function putVerified(
  cfg: WebDavConfig,
  target: string,
  bytes: Buffer,
  contentType = 'application/octet-stream'
): Promise<boolean> {
  const r = await sendAuthed(cfg, 'PUT', target, {
    headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length) },
    body: bytes,
    timeout: Math.max(TIMEOUT_MS, 60000 + Math.floor(bytes.length / 65536))
  })
  if (![200, 201, 204].includes(r.status)) return false
  return verifyRemoteSize(cfg, target, bytes.length)
}
