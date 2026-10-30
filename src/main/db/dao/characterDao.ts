import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { parseStringList, encodeList, strOrNull } from '../util'
import type { Character, CharacterInput, CharacterKind } from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

const CHAR_CFG: Record<
  CharacterKind,
  { table: string; fk: string }
> = {
  movie: { table: 'movie_characters', fk: 'movie_id' },
  book: { table: 'book_characters', fk: 'book_id' },
  game: { table: 'game_characters', fk: 'game_id' }
}

interface CharacterRow {
  id: string
  parent: string
  name: string
  role: string | null
  aliases: string | null
  tags: string | null
  description: string | null
  image_path: string | null
  sort_order: number
  is_deleted: number
  created_at: string
  updated_at: string
}

class CharacterDao {
  private db(): Database {
    return getDb()
  }

  list(kind: CharacterKind, parentId: string): Character[] {
    const { table, fk } = CHAR_CFG[kind]
    const rows = this.db()
      .prepare(
        `SELECT id, ${fk} AS parent, name, role, aliases, tags, description,
                image_path, sort_order, is_deleted, created_at, updated_at
         FROM ${table} WHERE ${fk}=? AND is_deleted=0 ORDER BY sort_order ASC, created_at ASC`
      )
      .all(parentId) as CharacterRow[]
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent,
      name: r.name,
      role: r.role,
      aliases: parseStringList(r.aliases),
      tags: parseStringList(r.tags),
      description: r.description,
      imagePath: r.image_path,
      sortOrder: r.sort_order ?? 0,
      isDeleted: r.is_deleted === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }

  private write(kind: CharacterKind, c: CharacterInput, isNew: boolean): void {
    const { table, fk } = CHAR_CFG[kind]
    const now = new Date().toISOString()
    if (isNew) {
      this.db()
        .prepare(
          `INSERT INTO ${table} (id,${fk},name,role,aliases,tags,description,image_path,
            sort_order,is_deleted,created_at,updated_at)
           VALUES (@id,@parent,@name,@role,@aliases,@tags,@description,@image_path,
            @sort_order,0,@created_at,@updated_at)`
        )
        .run({
          id: c.id,
          parent: c.parentId,
          name: c.name,
          role: strOrNull(c.role),
          aliases: encodeList(c.aliases),
          tags: encodeList(c.tags),
          description: strOrNull(c.description),
          image_path: strOrNull(c.imagePath),
          sort_order: c.sortOrder ?? 0,
          created_at: now,
          updated_at: now
        })
    } else {
      this.db()
        .prepare(
          `UPDATE ${table} SET name=@name,role=@role,aliases=@aliases,tags=@tags,
            description=@description,image_path=@image_path,sort_order=@sort_order,
            updated_at=@updated_at WHERE id=@id`
        )
        .run({
          id: c.id,
          name: c.name,
          role: strOrNull(c.role),
          aliases: encodeList(c.aliases),
          tags: encodeList(c.tags),
          description: strOrNull(c.description),
          image_path: strOrNull(c.imagePath),
          sort_order: c.sortOrder ?? 0,
          updated_at: now
        })
    }
  }

  insert(kind: CharacterKind, c: CharacterInput): void {
    this.write(kind, c, true)
  }
  update(kind: CharacterKind, c: CharacterInput): void {
    this.write(kind, c, false)
  }
  remove(kind: CharacterKind, id: string): void {
    const { table } = CHAR_CFG[kind]
    recordTombstone(table, id)
    this.db().prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
  }
}

export const characterDao = new CharacterDao()
