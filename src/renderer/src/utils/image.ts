// 远程封面 -> mookremote 协议 URL。
// 渲染层 <img> 直连不经过主进程 undici（即不使用设置中的代理），
// 统一切到该协议由主进程按各源代理配置转发；空地址返回空串。
export function remoteImg(
  url: string | null | undefined,
  source: 'tmdb' | 'bgm' | 'vip'
): string {
  if (!url) return ''
  return `mookremote://${source}/?u=${encodeURIComponent(url)}`
}

// 磁盘路径 -> mookimg 协议 URL（支持绝对路径与相对 imagesRoot 的逻辑路径）
export function toImgUrl(absPath: string | null | undefined): string {
  if (!absPath) return ''
  const normalized = absPath.replace(/\\/g, '/')
  return `mookimg:///${encodeURI(normalized)}`
}

// 把 Vue reactive/ref 解包出的 Proxy 数据深转为纯对象。
// Electron IPC 用结构化克隆传参，无法克隆 Proxy（否则抛 "An object could not be cloned"），
// 表单提交前需用它把 payload 及其数组/嵌套字段全部转成普通对象。
export function plain<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

// ISO 字符串 -> 本地日期时间戳（NDatePicker 用），无效返回 null
export function isoToTs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

// 本地日期时间戳 -> ISO UTC；空值返回 null
export function tsToIso(ts: number | null): string | null {
  if (ts == null || !Number.isFinite(ts)) return null
  return new Date(ts).toISOString()
}

export function yearOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const y = new Date(iso).getFullYear()
  return Number.isFinite(y) ? String(y) : ''
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
