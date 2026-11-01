import { setGlobalDispatcher, ProxyAgent, Agent } from 'undici'
import { prefs } from '../prefs'
import type {
  BgmDetail,
  BgmInfoboxItem,
  BgmSearchItem,
  TmdbCastPerson,
  TmdbCredits,
  TmdbDetail,
  TmdbPersonInfo,
  TmdbPersonSearchItem,
  TmdbSearchItem
} from '../../shared/types'

const TIMEOUT_MS = 15000
const UA =
  'dellevin/mooknote (Windows) (https://github.com/DelLevin-Home/mooknote)'

export class SearchAuthError extends Error {}
export class SearchNetworkError extends Error {}

let currentProxy = ''
function applyProxy(proxy: string): void {
  const p = proxy.trim()
  if (p === currentProxy) return
  currentProxy = p
  setGlobalDispatcher(p ? new ProxyAgent(p) : new Agent())
}

interface FetchOpts {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

async function fetchJson(url: string, opts: FetchOpts = {}): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal
    })
  } catch (e) {
    throw new SearchNetworkError(String(e))
  } finally {
    clearTimeout(timer)
  }
  if (resp.status === 401) {
    let detail = ''
    try {
      const body = (await resp.json()) as { status_message?: string }
      detail = body.status_message ?? ''
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new SearchAuthError(detail ? `401 凭证无效：${detail}` : '401 凭证无效')
  }
  if (!resp.ok) throw new SearchNetworkError(`HTTP ${resp.status}`)
  return (await resp.json()) as unknown
}

async function fetchBytes(url: string, headers?: Record<string, string>): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal })
    if (!resp.ok) throw new SearchNetworkError(`HTTP ${resp.status}`)
    const ab = await resp.arrayBuffer()
    return Buffer.from(ab)
  } catch (e) {
    throw new SearchNetworkError(String(e))
  } finally {
    clearTimeout(timer)
  }
}

// ================= TMDB =================

const TMDB = 'https://api.themoviedb.org/3'
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500'

function tmdbCfg(): { token: string; authType: string } {
  return {
    token: prefs.get('tmdbApiToken', ''),
    authType: prefs.get('tmdbAuthType', 'bearer')
  }
}

async function tmdbGet(path: string, query: Record<string, string> = {}): Promise<any> {
  const { token, authType } = tmdbCfg()
  if (!token) throw new SearchAuthError('未配置 TMDB Token')
  const params = new URLSearchParams({ language: 'zh-CN', ...query })
  if (authType === 'apikey') params.set('api_key', token)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (authType !== 'apikey') headers['Authorization'] = `Bearer ${token}`
  return fetchJson(`${TMDB}${path}?${params.toString()}`, { headers })
}

export async function tmdbTest(token: string, authType: string, proxy: string): Promise<string> {
  void authType
  const t = token.trim()
  applyProxy(proxy)
  // 与 App 端一致：无视选择，固定先 Bearer（v4 Read Access Token），401 再试 api_key（v3 Key）
  try {
    const p1 = new URLSearchParams({ language: 'zh-CN' })
    await fetchJson(`${TMDB}/authentication?${p1.toString()}`, {
      headers: { accept: 'application/json', Authorization: `Bearer ${t}` }
    })
    return 'bearer'
  } catch (e) {
    if (!(e instanceof SearchAuthError)) throw e
    const p2 = new URLSearchParams({ language: 'zh-CN', api_key: t })
    await fetchJson(`${TMDB}/authentication?${p2.toString()}`, {
      headers: { accept: 'application/json' }
    })
    return 'apikey'
  }
}

function mapTmdbItem(e: any): TmdbSearchItem {
  const isTv = (e.media_type ?? e._mediaType) === 'tv'
  return {
    id: e.id,
    mediaType: isTv ? 'tv' : 'movie',
    title: (isTv ? e.name : e.title) ?? '',
    originalTitle: (isTv ? e.original_name : e.original_title) ?? '',
    date: (isTv ? e.first_air_date : e.release_date) ?? null,
    overview: e.overview ?? '',
    posterUrl: e.poster_path ? TMDB_IMG + e.poster_path : null,
    rating: typeof e.vote_average === 'number' ? Math.round(e.vote_average * 10) / 10 : null
  }
}

export async function tmdbSearch(query: string, page: number): Promise<{
  results: TmdbSearchItem[]
  page: number
  totalPages: number
}> {
  applyProxy(prefs.get('tmdbProxy', ''))
  const data = await tmdbGet('/search/multi', {
    query,
    page: String(page),
    include_adult: 'false'
  })
  const results = (data.results ?? [])
    .filter((e: any) => e.media_type === 'movie' || e.media_type === 'tv')
    .map((e: any) => mapTmdbItem(e))
  return { results, page: data.page ?? page, totalPages: data.total_pages ?? 1 }
}

export async function tmdbDetail(id: number, mediaType: 'movie' | 'tv'): Promise<TmdbDetail> {
  applyProxy(prefs.get('tmdbProxy', ''))
  const data = await tmdbGet(`/${mediaType}/${id}`, {
    append_to_response: 'credits'
  })
  data._mediaType = mediaType
  const base = mapTmdbItem({ ...data, media_type: mediaType })
  const credits = data.credits ?? {}
  const directors =
    mediaType === 'movie'
      ? (credits.crew ?? [])
          .filter((c: any) => c.job === 'Director')
          .map((c: any) => c.name as string)
      : (data.created_by ?? []).map((c: any) => c.name as string)
  const actors = (credits.cast ?? []).slice(0, 10).map((c: any) => c.name as string)
  const genres = (data.genres ?? []).map((g: any) => g.name as string)
  const runtime =
    mediaType === 'movie'
      ? (data.runtime ?? 0)
      : Array.isArray(data.episode_run_time) && data.episode_run_time.length
        ? data.episode_run_time[0]
        : 0
  return {
    ...base,
    genres,
    directors,
    actors,
    runtime,
    tagline: data.tagline ?? '',
    status: data.status ?? ''
  }
}

// 拉取演职人员：cast=演员（含角色名），crew=主创（导演/编剧等）
export async function tmdbCredits(
  id: number,
  mediaType: 'movie' | 'tv'
): Promise<TmdbCredits> {
  applyProxy(prefs.get('tmdbProxy', ''))
  const data = await tmdbGet(`/${mediaType}/${id}/credits`)
  const cast: TmdbCastPerson[] = (data.cast ?? []).map((c: any) => ({
    tmdbId: c.id,
    name: c.name ?? '',
    character: c.character ? String(c.character) : null,
    job: null,
    profileUrl: c.profile_path ? TMDB_IMG + c.profile_path : null,
    order: typeof c.order === 'number' ? c.order : 9999
  }))
  const crew: TmdbCastPerson[] = (data.crew ?? [])
    .filter((c: any) => c.job === 'Director' || c.job === 'Screenplay' || c.job === 'Writer')
    .map((c: any) => ({
      tmdbId: c.id,
      name: c.name ?? '',
      character: null,
      job: c.job ?? null,
      profileUrl: c.profile_path ? TMDB_IMG + c.profile_path : null,
      order: typeof c.order === 'number' ? c.order : 9999
    }))
  return { cast, crew }
}

// 搜索人物（/search/person）
export async function tmdbPersonSearch(query: string): Promise<TmdbPersonSearchItem[]> {
  applyProxy(prefs.get('tmdbProxy', ''))
  const data = await tmdbGet('/search/person', { query, include_adult: 'false' })
  return (data.results ?? []).map((p: any) => {
    const knownFor = Array.isArray(p.known_for)
      ? p.known_for
          .map((w: any) => (w.media_type === 'tv' ? w.name : w.title) ?? '')
          .filter(Boolean)
          .slice(0, 3)
          .join('、')
      : ''
    return {
      id: p.id,
      name: p.name ?? '',
      profileUrl: p.profile_path ? TMDB_IMG + p.profile_path : null,
      knownFor
    }
  })
}

// 人物详情（/person/{id}），仅拉取并映射字段，头像由调用方下载
export async function tmdbPersonDetail(tmdbId: number): Promise<TmdbPersonInfo> {
  applyProxy(prefs.get('tmdbProxy', ''))
  const data = await tmdbGet(`/person/${tmdbId}`)
  const DEP: Record<string, string> = {
    Acting: '演员',
    Directing: '导演',
    Writing: '编剧',
    Production: '制片'
  }
  return {
    name: data.name ?? '',
    gender: data.gender === 1 ? 'female' : data.gender === 2 ? 'male' : data.gender === 3 ? 'other' : null,
    birthDate: data.birthday ?? null,
    birthPlace: data.place_of_birth ?? null,
    alternateNames: Array.isArray(data.also_known_as)
      ? data.also_known_as.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [],
    occupation: data.known_for_department && DEP[data.known_for_department]
      ? [DEP[data.known_for_department]]
      : [],
    summary: data.biography ? String(data.biography) : null,
    photoPath: data.profile_path ? TMDB_IMG + data.profile_path : null
  }
}

// ================= Bangumi =================

const BGM = 'https://api.bgm.tv'

function bgmHeaders(): Record<string, string> {
  const token = prefs.get('bangumiAccessToken', '')
  return {
    accept: 'application/json',
    'User-Agent': UA,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

function flattenInfoboxValue(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? String((x as any).v ?? (x as any).k ?? '') : String(x)))
      .filter((t) => t.trim())
      .join('、')
  }
  return v == null ? '' : String(v)
}

function mapBgmItem(e: any): BgmSearchItem {
  return {
    id: e.id,
    type: e.type,
    title: e.name_cn || e.name || '',
    name: e.name ?? '',
    date: e.date ?? null,
    image: e.images?.common ?? e.images?.large ?? null,
    rating: e.rating?.score ? Number(e.rating.score) : null,
    summary: e.summary ?? '',
    tags: (e.tags ?? []).slice(0, 8).map((t: any) => t.name).filter(Boolean)
  }
}

export async function bgmTest(token: string, proxy: string): Promise<boolean> {
  applyProxy(proxy)
  await fetchJson(`${BGM}/v0/me`, {
    headers: { accept: 'application/json', 'User-Agent': UA, Authorization: `Bearer ${token}` }
  })
  return true
}

export async function bgmSearch(
  query: string,
  offset: number
): Promise<{ results: BgmSearchItem[]; total: number }> {
  applyProxy(prefs.get('bangumiProxy', ''))
  const params = new URLSearchParams({ limit: '30', offset: String(offset) })
  const data: any = await fetchJson(`${BGM}/v0/search/subjects?${params.toString()}`, {
    method: 'POST',
    headers: { ...bgmHeaders(), 'Content-Type': 'application/json' },
    body: { keyword: query, filter: { type: [1, 2, 4, 6] } }
  })
  return {
    results: (data.data ?? []).map(mapBgmItem),
    total: data.total ?? 0
  }
}

export async function bgmDetail(id: number): Promise<BgmDetail> {
  applyProxy(prefs.get('bangumiProxy', ''))
  const data: any = await fetchJson(`${BGM}/v0/subjects/${id}`, { headers: bgmHeaders() })
  const base = mapBgmItem(data)
  const infobox: BgmInfoboxItem[] = (data.infobox ?? []).map((e: any) => ({
    key: String(e.key ?? ''),
    value: flattenInfoboxValue(e.value)
  }))
  return {
    ...base,
    infobox,
    totalEps: data.total_episodes ?? data.eps ?? 0
  }
}

// ================= 远程图片下载 =================

export async function downloadRemoteImage(
  url: string,
  kind: 'tmdb' | 'bgm' | 'vip'
): Promise<Buffer> {
  const proxy =
    kind === 'tmdb'
      ? prefs.get('tmdbProxy', '')
      : kind === 'bgm'
        ? prefs.get('bangumiProxy', '')
        : ''
  applyProxy(proxy)
  const buf = await fetchBytes(url, {
    'User-Agent': kind === 'bgm' ? UA : 'Mozilla/5.0'
  })
  if (buf.length > 10 * 1024 * 1024) throw new SearchNetworkError('图片过大')
  return buf
}

// ================= 增强搜索 Token（VIP 服务，与 Flutter ServerConfig 对齐） =================
const VIP_BASE_URL = 'http://vipapi.mooknote.iletter.top'
const APP_BASE_URL = 'http://api.mooknote.iletter.top'

// 获取 Token 说明文档（Markdown），与 Flutter LegalPage(slug: token_doc) 对齐
export async function fetchTokenDoc(): Promise<string> {
  applyProxy('')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const resp = await fetch(`${APP_BASE_URL}/api/pages/token_doc`, {
      signal: ctrl.signal
    })
    if (!resp.ok) throw new Error(`服务返回 ${resp.status}`)
    const data = (await resp.json()) as { content?: string }
    return data.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export interface VipTokenResult {
  valid: boolean
  message: string
}

export interface VipSearchItem {
  id: string
  title: string
  cover: string
  subtitle: string
  extra: string
  raw: Record<string, unknown>
}

export interface VipSearchResult {
  results: VipSearchItem[]
  page: number
  totalPages: number
}

function normalizeVipCover(p: unknown): string {
  const s = typeof p === 'string' ? p.trim() : ''
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  // 书籍封面可能是相对路径，拼接 mk_book 前缀（与 Flutter 一致）
  return `${VIP_BASE_URL}/mk_book/${s.replace(/^\/+/, '')}`
}

// 增强搜索：kind=movie 影视 / book 书籍，直连（与 token 校验一致，不走代理）
export async function vipSearch(
  kind: 'movie' | 'book',
  keyword: string,
  page: number
): Promise<VipSearchResult> {
  applyProxy('')
  const token = prefs.get(kind === 'movie' ? 'movieSearchToken' : 'bookSearchToken', '')
  if (!token) throw new SearchAuthError('未配置增强搜索 Token')
  const q = encodeURIComponent(keyword)
  const url =
    kind === 'movie'
      ? `${VIP_BASE_URL}/api/movie/list?movieName=${q}&token=${encodeURIComponent(
          token
        )}&page=${page}`
      : `${VIP_BASE_URL}/api/book/list?title=${q}&token=${encodeURIComponent(token)}&page=${page}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  let payload: { code?: number; msg?: string; data?: any }
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    payload = (await resp.json()) as typeof payload
  } catch (e) {
    throw new SearchNetworkError(String(e))
  } finally {
    clearTimeout(timer)
  }

  if (payload.code !== 0) {
    const msg = payload.msg || `服务返回 code=${payload.code ?? '?'}`
    if (/token|过期|401|403/i.test(msg)) throw new SearchAuthError(msg)
    throw new SearchNetworkError(msg)
  }

  const data = payload.data ?? {}
  const list: unknown[] = Array.isArray(data.list) ? data.list : []
  const results: VipSearchItem[] = list.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>
    if (kind === 'movie') {
      const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
      return {
        id: String(o['vod_id'] ?? ''),
        title: str('vod_name'),
        cover: normalizeVipCover(o['vod_pic']),
        subtitle: [str('vod_year'), str('vod_area'), str('type_name')].filter(Boolean).join(' · '),
        extra: str('vod_director') || str('vod_class'),
        raw: o
      }
    }
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    return {
      id: String(o['id'] ?? ''),
      title: str('title'),
      cover: normalizeVipCover(o['cover']),
      subtitle: [str('author'), str('press')].filter(Boolean).join(' · '),
      extra: str('publishedDate') || str('isbn'),
      raw: o
    }
  })

  const totalPages = Math.max(1, Number(data.pagecount) || 1)
  return { results, page: Number(data.page) || page, totalPages }
}

// 校验增强搜索 Token；type 为影视 movie / 书籍 book。网络失败或 code 非 0 均视为无效
export async function vipTokenCheck(token: string, type: 'movie' | 'book'): Promise<VipTokenResult> {
  applyProxy('')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const resp = await fetch(
      `${VIP_BASE_URL}/api/token/check?token=${encodeURIComponent(token)}&type=${type}`,
      { signal: ctrl.signal }
    )
    if (!resp.ok) return { valid: false, message: `服务返回 ${resp.status}` }
    const data = (await resp.json()) as {
      code?: number
      data?: { valid?: boolean; messageString?: string }
    }
    if (data.code === 0 && data.data?.valid === true) {
      return { valid: true, message: data.data.messageString ?? 'Token 有效' }
    }
    return { valid: false, message: data.data?.messageString ?? 'Token 无效' }
  } catch {
    return { valid: false, message: '验证失败（网络错误）' }
  } finally {
    clearTimeout(timer)
  }
}
