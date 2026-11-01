import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, numOrNull, strOrNull } from '../util'
import type {
  MediaKind,
  Person,
  PersonInput,
  PersonLink,
  PersonLinkWithPerson,
  PersonWork
} from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface PersonRow {
  id: string
  name: string
  gender: string | null
  birth_date: string | null
  birth_place: string | null
  alternate_names: string | null
  occupation: string | null
  summary: string | null
  photo_path: string | null
  cover_offset: number
  is_deleted: number
  created_at: string
  updated_at: string
}

function rowToPerson(r: PersonRow): Person {
  return {
    id: r.id,
    name: r.name,
    gender: r.gender,
    birthDate: r.birth_date,
    birthPlace: r.birth_place,
    alternateNames: parseStringList(r.alternate_names),
    occupation: parseStringList(r.occupation),
    summary: r.summary,
    photoPath: r.photo_path,
    coverOffset: r.cover_offset ?? 0,
    isDeleted: r.is_deleted === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

class PersonDao {
  private db(): Database {
    return getDb()
  }

  list(
    keyword = '',
    includeDeleted = false,
    sort: 'updated' | 'created' | 'name' | 'birth' = 'updated'
  ): Person[] {
    const where: string[] = []
    const params: unknown[] = []
    if (!includeDeleted) where.push('is_deleted=0')
    if (keyword.trim()) {
      where.push('(name LIKE ? OR alternate_names LIKE ?)')
      const like = `%${keyword.trim()}%`
      params.push(like, like)
    }
    const orderBy =
      sort === 'created'
        ? 'created_at DESC'
        : sort === 'birth'
          ? `CASE WHEN birth_date IS NULL OR birth_date='' THEN 1 ELSE 0 END, birth_date ASC`
          : 'updated_at DESC'
    const sql = `SELECT * FROM people ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${orderBy}`
    const list = (this.db().prepare(sql).all(...params) as PersonRow[]).map(rowToPerson)
    if (sort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
    return list
  }

  getById(id: string, includeDeleted = true): Person | null {
    const row = this.db()
      .prepare(`SELECT * FROM people WHERE id=?${includeDeleted ? '' : ' AND is_deleted=0'}`)
      .get(id) as PersonRow | undefined
    return row ? rowToPerson(row) : null
  }

  allNames(): string[] {
    const set = new Set<string>()
    for (const p of this.list()) {
      set.add(p.name)
      p.alternateNames.forEach((n) => set.add(n))
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }

  insert(input: PersonInput): Person {
    const now = new Date().toISOString()
    this.db()
      .prepare(
        `INSERT INTO people (id,name,gender,birth_date,birth_place,alternate_names,occupation,
          summary,photo_path,cover_offset,is_deleted,created_at,updated_at)
         VALUES (@id,@name,@gender,@birth_date,@birth_place,@alternate_names,@occupation,
          @summary,@photo_path,@cover_offset,0,@created_at,@updated_at)`
      )
      .run({
        id: input.id,
        name: input.name,
        gender: strOrNull(input.gender),
        birth_date: strOrNull(input.birthDate),
        birth_place: strOrNull(input.birthPlace),
        alternate_names: encodeList(input.alternateNames),
        occupation: encodeList(input.occupation),
        summary: strOrNull(input.summary),
        photo_path: strOrNull(input.photoPath),
        cover_offset: input.coverOffset ?? 0,
        created_at: now,
        updated_at: now
      })
    return this.getById(input.id)!
  }

  update(input: PersonInput): Person {
    this.db()
      .prepare(
        `UPDATE people SET name=@name,gender=@gender,birth_date=@birth_date,birth_place=@birth_place,
          alternate_names=@alternate_names,occupation=@occupation,summary=@summary,
          photo_path=@photo_path,cover_offset=@cover_offset,updated_at=@updated_at WHERE id=@id`
      )
      .run({
        id: input.id,
        name: input.name,
        gender: strOrNull(input.gender),
        birth_date: strOrNull(input.birthDate),
        birth_place: strOrNull(input.birthPlace),
        alternate_names: encodeList(input.alternateNames),
        occupation: encodeList(input.occupation),
        summary: strOrNull(input.summary),
        photo_path: strOrNull(input.photoPath),
        cover_offset: input.coverOffset ?? 0,
        updated_at: new Date().toISOString()
      })
    return this.getById(input.id)!
  }

  softDelete(id: string): void {
    this.db()
      .prepare(`UPDATE people SET is_deleted=1,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare(`UPDATE people SET is_deleted=0,updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), id)
  }

  permanentDelete(id: string): void {
    const db = this.db()
    db.transaction(() => {
      db.prepare(`DELETE FROM movie_people WHERE person_id=?`).run(id)
      db.prepare(`DELETE FROM book_people WHERE person_id=?`).run(id)
      db.prepare(`DELETE FROM game_people WHERE person_id=?`).run(id)
      recordTombstone('people', id)
      db.prepare(`DELETE FROM people WHERE id=?`).run(id)
    })()
  }
}

export const personDao = new PersonDao()

// ========== 作品 ↔ 人物关联 ==========
const LINK_CFG: Record<
  MediaKind,
  { table: string; workCol: string }
> = {
  movie: { table: 'movie_people', workCol: 'movie_id' },
  book: { table: 'book_people', workCol: 'book_id' },
  game: { table: 'game_people', workCol: 'game_id' }
}

interface LinkRow {
  id: string
  work_id: string
  person_id: string
  role_type: string
  character_name: string | null
  sort_order: number
  name: string
  photo_path: string | null
  occupation: string | null
}

class PersonLinkDao {
  private db(): Database {
    return getDb()
  }

  listByWork(kind: MediaKind, workId: string): PersonLinkWithPerson[] {
    const { table, workCol } = LINK_CFG[kind]
    const charCol = kind === 'movie' ? 'l.character_name' : 'NULL'
    const rows = this.db()
      .prepare(
        `SELECT l.id, l.${workCol} AS work_id, l.person_id, l.role_type,
                ${charCol} AS character_name, l.sort_order,
                p.name, p.photo_path, p.occupation
         FROM ${table} l JOIN people p ON p.id = l.person_id
         WHERE l.${workCol}=? AND p.is_deleted=0
         ORDER BY l.role_type ASC, l.sort_order ASC`
      )
      .all(workId) as LinkRow[]
    return rows.map((r) => ({
      id: r.id,
      workId: r.work_id,
      personId: r.person_id,
      roleType: r.role_type,
      characterName: r.character_name,
      sortOrder: r.sort_order,
      name: r.name,
      photoPath: r.photo_path,
      occupation: parseStringList(r.occupation)
    }))
  }

  // 整部作品的关联整体替换（与 Flutter replaceForWork 一致，事务内先删后插）
  replaceForWork(kind: MediaKind, workId: string, links: PersonLink[]): void {
    const { table, workCol } = LINK_CFG[kind]
    const hasCharacter = kind === 'movie' // 仅 movie_people 有 character_name 列
    const db = this.db()
    db.transaction(() => {
      db.prepare(`DELETE FROM ${table} WHERE ${workCol}=?`).run(workId)
      const stmt = hasCharacter
        ? db.prepare(
            `INSERT INTO ${table} (id,${workCol},person_id,role_type,character_name,sort_order)
             VALUES (?,?,?,?,?,?)`
          )
        : db.prepare(
            `INSERT INTO ${table} (id,${workCol},person_id,role_type,sort_order)
             VALUES (?,?,?,?,?)`
          )
      links.forEach((l, i) => {
        if (hasCharacter)
          stmt.run(l.id, workId, l.personId, l.roleType, strOrNull(l.characterName), l.sortOrder ?? i)
        else stmt.run(l.id, workId, l.personId, l.roleType, l.sortOrder ?? i)
      })
    })()
  }

  // 人物参与的全部作品（跨三表，带媒体快照）
  worksByPerson(personId: string): PersonWork[] {
    const out: PersonWork[] = []
    const q = (
      kind: MediaKind,
      table: string,
      workCol: string,
      mediaTable: string,
      coverCol: string,
      hasCharacter: boolean
    ): void => {
      const charCol = hasCharacter ? 'l.character_name' : 'NULL'
      const rows = this.db()
        .prepare(
          `SELECT l.id AS link_id, l.${workCol} AS work_id, l.role_type,
                  ${charCol} AS character_name, l.sort_order,
                  m.title, m.${coverCol} AS cover_path, m.status, m.rating, m.is_deleted
           FROM ${table} l
           JOIN ${mediaTable} m ON m.id = l.${workCol}
           WHERE l.person_id=?
           ORDER BY l.sort_order ASC`
        )
        .all(personId) as {
        link_id: string
        work_id: string
        role_type: string
        character_name: string | null
        sort_order: number
        title: string
        cover_path: string | null
        status: string
        rating: number | null
        is_deleted: number
      }[]
      for (const r of rows) {
        out.push({
          kind,
          linkId: r.link_id,
          workId: r.work_id,
          roleType: r.role_type,
          characterName: r.character_name,
          sortOrder: r.sort_order,
          title: r.title,
          coverPath: r.cover_path,
          status: r.status,
          rating: numOrNull(r.rating),
          isDeleted: r.is_deleted === 1
        })
      }
    }
    q('movie', 'movie_people', 'movie_id', 'movies', 'poster_path', true)
    q('book', 'book_people', 'book_id', 'books', 'cover_path', false)
    q('game', 'game_people', 'game_id', 'games', 'cover_path', false)
    return out
  }
}

export const personLinkDao = new PersonLinkDao()
