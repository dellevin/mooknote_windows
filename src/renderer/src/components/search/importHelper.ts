import type {
  MovieInput,
  BookInput,
  GameInput,
  TmdbDetail,
  BgmDetail
} from '@shared/types'

function iso(date: string | null): string | null {
  if (!date) return null
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function splitList(s: string): string[] {
  return s
    .split(/[、,，/]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
function infobox(d: BgmDetail, key: string): string {
  return d.infobox.find((e) => e.key === key)?.value ?? ''
}

// 本地去重比对：去空白 + 小写
export function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

// ── 增强搜索 VIP（CMS vod / mk_book）-> Movie / Book ──
function vipStr(o: Record<string, unknown>, k: string): string {
  return typeof o[k] === 'string' ? (o[k] as string) : ''
}

export function vipToMovie(o: Record<string, unknown>, id: string, status: MovieInput['status']): MovieInput {
  const year = vipStr(o, 'vod_year').slice(0, 4)
  const summary = vipStr(o, 'vod_content')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim()
  const genres = splitList(vipStr(o, 'vod_class'))
  const typeName = vipStr(o, 'type_name')
  return {
    id,
    title: vipStr(o, 'vod_name'),
    posterPath: null, // 由调用方下载后回填
    releaseDate: year ? `${year}-01-01T00:00:00.000Z` : null,
    directors: splitList(vipStr(o, 'vod_director')),
    writers: splitList(vipStr(o, 'vod_writer')),
    actors: splitList(vipStr(o, 'vod_actor')),
    genres: genres.length ? genres : typeName ? [typeName] : [],
    alternateTitles: [],
    summary: summary || null,
    rating: null,
    status,
    category: 'movie',
    watchDate: null,
    watchCount: 0,
    duration: 0,
    coverOffset: 0
  }
}

export function vipToBook(o: Record<string, unknown>, id: string, status: BookInput['status']): BookInput {
  return {
    id,
    title: vipStr(o, 'title'),
    coverPath: null,
    authors: splitList(vipStr(o, 'author')),
    translators: [],
    alternateTitles: [],
    publisher: vipStr(o, 'press') || null,
    genres: [],
    summary: null,
    rating: null,
    status,
    category: 'book',
    isbn: vipStr(o, 'isbn') || null,
    publishDate: iso(vipStr(o, 'publishedDate')),
    startDate: null,
    finishDate: null,
    readCount: 0,
    readDuration: 0,
    coverOffset: 0
  }
}

// ── TMDB -> Movie ──
export function tmdbToMovie(d: TmdbDetail, id: string, status: MovieInput['status']): MovieInput {
  return {
    id,
    title: d.title,
    posterPath: null, // 由调用方下载后回填
    releaseDate: iso(d.date),
    directors: d.directors,
    writers: [],
    actors: d.actors,
    genres: d.genres,
    alternateTitles: d.originalTitle && d.originalTitle !== d.title ? [d.originalTitle] : [],
    summary: d.overview,
    rating: d.rating,
    status,
    category: d.mediaType === 'movie' ? 'movie' : 'tv',
    watchDate: null,
    watchCount: 0,
    duration: d.runtime,
    coverOffset: 0
  }
}

// ── Bangumi -> Book / Game / Movie（按 type） ──
export function bgmToBook(d: BgmDetail, id: string, status: BookInput['status']): BookInput {
  const isbn13 = infobox(d, 'ISBN-13')
  const isbn = isbn13 || infobox(d, 'ISBN')
  return {
    id,
    title: d.title,
    coverPath: null,
    authors: splitList(infobox(d, '作者')),
    translators: splitList(infobox(d, '译者')),
    alternateTitles: d.name && d.name !== d.title ? [d.name] : [],
    publisher: infobox(d, '出版社') || null,
    genres: d.tags,
    summary: d.summary || null,
    rating: d.rating,
    status,
    category: 'book',
    isbn: isbn || null,
    publishDate: iso(d.date),
    startDate: null,
    finishDate: null,
    readCount: 0,
    readDuration: 0,
    coverOffset: 0
  }
}

export function bgmToGame(d: BgmDetail, id: string, status: GameInput['status']): GameInput {
  return {
    id,
    title: d.title,
    coverPath: null,
    rating: d.rating,
    status,
    category: 'digital',
    platforms: splitList(infobox(d, '平台')),
    versions: [],
    genres: d.tags,
    playTimeHours: 0,
    playTimeMinutes: 0,
    playCount: 0,
    developer: splitList(infobox(d, '开发')),
    releaseDate: iso(d.date),
    purchasePlatforms: [],
    purchaseDate: null,
    purchasePrice: null,
    summary: d.summary || null,
    coverOffset: 0
  }
}

export function bgmToMovie(d: BgmDetail, id: string, status: MovieInput['status']): MovieInput {
  return {
    id,
    title: d.title,
    posterPath: null,
    releaseDate: iso(d.date),
    directors: splitList(infobox(d, '导演')),
    writers: [],
    actors: [],
    genres: d.tags,
    alternateTitles: d.name && d.name !== d.title ? [d.name] : [],
    summary: d.summary || null,
    rating: d.rating,
    status,
    category: d.type === 2 ? 'anime' : 'tv',
    watchDate: null,
    watchCount: 0,
    duration: 0,
    coverOffset: 0
  }
}
