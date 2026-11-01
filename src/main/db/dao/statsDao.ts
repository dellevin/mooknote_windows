import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList } from '../util'
import type {
  CalendarEntry,
  CalendarKind,
  GalleryImage,
  HeatDay,
  HomeStats,
  KindOverview,
  StatsOverview
} from '../../../shared/types'

interface CoverRow {
  id: string
  title: string
  cover: string | null
  created_at: string
}

function dayOnly(iso: string): string {
  // 存储为 UTC ISO；日历按本地日展示，与 Flutter dayOnly 对齐
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

class StatsDao {
  private db(): Database {
    return getDb()
  }

  private count(table: string, where = 'is_deleted=0'): number {
    const row = this.db()
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)
      .get() as { c: number }
    return row.c
  }

  private kindOverview(table: string): KindOverview {
    const rows = this.db()
      .prepare(
        `SELECT status,
           COUNT(*) AS count,
           COUNT(rating) AS rated,
           AVG(rating) AS avg
         FROM ${table} WHERE is_deleted=0 GROUP BY status`
      )
      .all() as { status: string; count: number; rated: number; avg: number | null }[]
    const total = rows.reduce((s, r) => s + r.count, 0)
    const rated = rows.reduce((s, r) => s + r.rated, 0)
    const avgAll = this.db()
      .prepare(`SELECT AVG(rating) AS a FROM ${table} WHERE is_deleted=0 AND rating IS NOT NULL`)
      .get() as { a: number | null }
    return {
      total,
      rated,
      avgRating: avgAll.a != null ? Math.round(avgAll.a * 10) / 10 : null,
      byStatus: rows.map((r) => ({ status: r.status, count: r.count }))
    }
  }

  overview(): StatsOverview {
    const reviews =
      this.count('movie_reviews') + this.count('book_reviews') + this.count('game_reviews')
    return {
      movies: this.kindOverview('movies'),
      books: this.kindOverview('books'),
      games: this.kindOverview('games'),
      notes: this.count('notes'),
      people: this.count('people'),
      playlists: this.count('playlists'),
      customModules: this.count('custom_modules'),
      customItems: this.count('custom_module_items'),
      reviews,
      imageCount: this.gallery().length
    }
  }

  // mode: 0 = 创建日期，1 = 消费日期（影视观看 / 书籍开始阅读 / 游戏通关记录）
  calendar(mode: 0 | 1): CalendarEntry[] {
    const db = this.db()
    const out: CalendarEntry[] = []
    // 去重键：本地日期 + 类型 + 作品 id（同一部作品同一天只占一格，
    // 作品主日期与分集/章节/关卡记录不重复显示，对齐手机版）
    const seen = new Set<string>()
    const pushEntry = (
      kind: CalendarKind,
      id: string,
      title: string,
      cover: string | null,
      status: string,
      rating: number | null,
      dateIso: string,
      note?: string | null
    ): void => {
      const e = this.entry(kind, id, title, cover, status, rating, dateIso, note)
      const key = `${e.date}|${kind}|${id}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(e)
    }

    const movieRows = db
      .prepare(
        `SELECT id,title,poster_path AS cover,status,rating,
           ${mode === 1 ? 'watch_date' : 'created_at'} AS d
         FROM movies WHERE is_deleted=0
           AND ${mode === 1 ? 'watch_date' : 'created_at'} IS NOT NULL`
      )
      .all() as (CoverRow & { status: string; rating: number | null; d: string })[]
    for (const r of movieRows) {
      if (!r.d) continue
      pushEntry('movie', r.id, r.title, r.cover, r.status, r.rating, r.d)
    }

    const bookRows = db
      .prepare(
        `SELECT id,title,cover_path AS cover,status,rating,
           ${mode === 1 ? 'start_date' : 'created_at'} AS d
         FROM books WHERE is_deleted=0
           AND ${mode === 1 ? 'start_date' : 'created_at'} IS NOT NULL`
      )
      .all() as (CoverRow & { status: string; rating: number | null; d: string })[]
    for (const r of bookRows) {
      if (!r.d) continue
      pushEntry('book', r.id, r.title, r.cover, r.status, r.rating, r.d)
    }

    // 分集/章节/关卡：仅已完成的记录入历，封面取父作品（对齐手机版）
    const subTables: { table: string; fk: string; flag: string; consumed: string; kind: CalendarKind; parent: string; parentCover: string }[] = [
      { table: 'movie_episodes', fk: 'movie_id', flag: 'watched', consumed: 'watch_date', kind: 'movie', parent: 'movies', parentCover: 'poster_path' },
      { table: 'book_chapters', fk: 'book_id', flag: 'read', consumed: 'read_date', kind: 'book', parent: 'books', parentCover: 'cover_path' },
      { table: 'game_levels', fk: 'game_id', flag: 'cleared', consumed: 'clear_date', kind: 'game', parent: 'games', parentCover: 'cover_path' }
    ]
    for (const t of subTables) {
      const dateCol = mode === 1 ? `s.${t.consumed}` : 's.created_at'
      const rows = db
        .prepare(
          `SELECT p.id AS pid,p.title,p.${t.parentCover} AS cover,p.status,p.rating,${dateCol} AS d
           FROM ${t.table} s
           INNER JOIN ${t.parent} p ON p.id = s.${t.fk}
           WHERE s.is_deleted=0 AND p.is_deleted=0 AND s.${t.flag}=1
             AND ${dateCol} IS NOT NULL`
        )
        .all() as { pid: string; title: string; cover: string | null; status: string; rating: number | null; d: string }[]
      for (const r of rows) {
        pushEntry(t.kind, r.pid, r.title, r.cover, r.status, r.rating, r.d)
      }
    }

    if (mode === 1) {
      // 游戏：通关记录（一个游戏可能多次通关）
      const compRows = db
        .prepare(
          `SELECT c.id AS cid, c.completion_date AS d, c.note AS note,
                  g.id,g.title,g.cover_path AS cover,g.status,g.rating
           FROM game_completions c
           INNER JOIN games g ON g.id = c.game_id
           WHERE c.is_deleted=0 AND g.is_deleted=0 AND c.completion_date IS NOT NULL`
        )
        .all() as {
        cid: string
        d: string
        note: string | null
        id: string
        title: string
        cover: string | null
        status: string
        rating: number | null
      }[]
      for (const r of compRows) {
        out.push(this.entry('game', r.cid, r.title, r.cover, r.status, r.rating, r.d, r.note))
      }
    } else {
      const gameRows = db
        .prepare(
          `SELECT id,title,cover_path AS cover,status,rating,created_at AS d
           FROM games WHERE is_deleted=0 AND created_at IS NOT NULL`
        )
        .all() as (CoverRow & { status: string; rating: number | null; d: string })[]
      for (const r of gameRows) {
        out.push(this.entry('game', r.id, r.title, r.cover, r.status, r.rating, r.d))
      }
    }

    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return out
  }

  private entry(
    kind: CalendarKind,
    id: string,
    title: string,
    cover: string | null,
    status: string,
    rating: number | null,
    dateIso: string,
    note?: string | null
  ): CalendarEntry {
    return {
      kind,
      id,
      title,
      date: dayOnly(dateIso),
      coverPath: cover,
      status,
      rating,
      note: note ?? undefined
    }
  }

  // 首页：最近 days 天的每日新增热力
  home(days = 371): HomeStats {
    const db = this.db()
    const tables = ['movies', 'books', 'games', 'notes', 'people']

    const countByDay = new Map<string, number>()
    let totalCount = 0

    for (const table of tables) {
      const rows = db
        .prepare(
          `SELECT created_at AS createdAt FROM ${table}
             WHERE is_deleted=0 AND created_at IS NOT NULL`
        )
        .all() as { createdAt: string }[]
      totalCount += rows.length
      for (const r of rows) {
        const day = dayOnly(r.createdAt)
        countByDay.set(day, (countByDay.get(day) ?? 0) + 1)
      }
    }

    // 补齐连续日期（含今天），无记录的天补 0
    const heat: HeatDay[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = dayOnly(d.toISOString())
      heat.push({ date: key, count: countByDay.get(key) ?? 0 })
    }

    return {
      days: heat,
      activeDays: [...countByDay.values()].filter((c) => c > 0).length,
      totalCount
    }
  }

  // 某一天（本地日期 YYYY-MM-DD）新创建的条目，供首页热力图悬停查看
  dayItems(day: string): { kind: string; id: string; title: string; cover: string | null }[] {
    const db = this.db()
    const start = new Date(`${day}T00:00:00`)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const startIso = start.toISOString()
    const endIso = end.toISOString()

    const query = (
      kind: string,
      table: string,
      titleExpr: string,
      coverExpr: string
    ): { kind: string; id: string; title: string; cover: string | null }[] => {
      const rows = db
        .prepare(
          `SELECT id, ${titleExpr} AS title, ${coverExpr} AS cover FROM ${table}
             WHERE is_deleted=0 AND created_at IS NOT NULL
               AND created_at >= ? AND created_at < ?
             ORDER BY created_at`
        )
        .all(startIso, endIso) as { id: string; title: string | null; cover: string | null }[]
      return rows
        .map((r) => ({
          kind,
          id: r.id,
          title: (r.title ?? '').trim(),
          cover: r.cover?.trim() || null
        }))
        .filter((r) => r.title)
    }

    return [
      ...query('movie', 'movies', 'title', 'poster_path'),
      ...query('book', 'books', 'title', 'cover_path'),
      ...query('game', 'games', 'title', 'cover_path'),
      ...query('person', 'people', 'name', 'photo_path'),
      ...query('note', 'notes', "COALESCE(NULLIF(title, ''), substr(replace(content, char(10), ' '), 1, 30))", "NULL")
    ]
  }

  // 聚合全部实体图片，按创建时间倒序（对齐 Flutter GalleryDao）
  gallery(): GalleryImage[] {
    const db = this.db()
    const items: GalleryImage[] = []

    const push = (
      path: string | null,
      category: string,
      entityType: string,
      entityId: string,
      entityTitle: string,
      createdAt: string
    ): void => {
      if (path && path.trim()) {
        items.push({ path, category, entityType, entityId, entityTitle, createdAt })
      }
    }

    const covers = db
      .prepare(
        `SELECT id,title,poster_path AS cover,created_at FROM movies
         WHERE is_deleted=0 AND poster_path IS NOT NULL AND poster_path != ''`
      )
      .all() as CoverRow[]
    covers.forEach((r) => push(r.cover, 'movie_poster', 'movie', r.id, r.title, r.created_at))

    const posters = db
      .prepare(
        `SELECT p.poster_path AS cover,p.created_at,p.movie_id AS id,m.title
         FROM movie_posters p INNER JOIN movies m ON m.id=p.movie_id
         WHERE p.is_deleted=0 AND m.is_deleted=0
           AND p.poster_path IS NOT NULL AND p.poster_path != ''`
      )
      .all() as CoverRow[]
    posters.forEach((r) => push(r.cover, 'movie_posters', 'movie', r.id, r.title, r.created_at))

    const books = db
      .prepare(
        `SELECT id,title,cover_path AS cover,created_at FROM books
         WHERE is_deleted=0 AND cover_path IS NOT NULL AND cover_path != ''`
      )
      .all() as CoverRow[]
    books.forEach((r) => push(r.cover, 'book_cover', 'book', r.id, r.title, r.created_at))

    const games = db
      .prepare(
        `SELECT id,title,cover_path AS cover,created_at FROM games
         WHERE is_deleted=0 AND cover_path IS NOT NULL AND cover_path != ''`
      )
      .all() as CoverRow[]
    games.forEach((r) => push(r.cover, 'game_cover', 'game', r.id, r.title, r.created_at))

    const shots = db
      .prepare(
        `SELECT s.screenshot_path AS cover,s.created_at,s.game_id AS id,g.title
         FROM game_screenshots s INNER JOIN games g ON g.id=s.game_id
         WHERE s.is_deleted=0 AND g.is_deleted=0
           AND s.screenshot_path IS NOT NULL AND s.screenshot_path != ''`
      )
      .all() as CoverRow[]
    shots.forEach((r) => push(r.cover, 'game_screenshot', 'game', r.id, r.title, r.created_at))

    const notes = db
      .prepare(`SELECT id,title,images,created_at FROM notes WHERE is_deleted=0 AND images IS NOT NULL`)
      .all() as { id: string; title: string | null; images: string | null; created_at: string }[]
    for (const n of notes) {
      for (const p of parseStringList(n.images)) {
        push(p, 'note_image', 'note', n.id, n.title ?? '', n.created_at)
      }
    }

    const people = db
      .prepare(
        `SELECT id,name,photo_path AS cover,created_at FROM people
         WHERE is_deleted=0 AND photo_path IS NOT NULL AND photo_path != ''`
      )
      .all() as (Omit<CoverRow, 'title'> & { name: string })[]
    people.forEach((r) => push(r.cover, 'person_photo', 'person', r.id, r.name, r.created_at))

    const charCover = (table: string, fk: string, kind: string): void => {
      const rows = db
        .prepare(
          `SELECT c.id,c.name,c.image_path AS cover,c.created_at,p.title AS parent
           FROM ${table} c
           INNER JOIN ${kind === 'movie' ? 'movies' : kind === 'book' ? 'books' : 'games'} p
             ON p.id = c.${fk}
           WHERE c.is_deleted=0 AND p.is_deleted=0
             AND c.image_path IS NOT NULL AND c.image_path != ''`
        )
        .all() as { id: string; cover: string | null; created_at: string; parent: string }[]
      rows.forEach((r) => push(r.cover, `${kind}_character`, kind, r.id, r.parent, r.created_at))
    }
    charCover('movie_characters', 'movie_id', 'movie')
    charCover('book_characters', 'book_id', 'book')
    charCover('game_characters', 'game_id', 'game')

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return items
  }
}

export const statsDao = new StatsDao()
