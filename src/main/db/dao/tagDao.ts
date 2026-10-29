import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDb } from '../index'
import { parseStringList, encodeList } from '../util'
import type { Tag, TagDeleteMode, TagType } from '../../../shared/types'

interface TagRow {
  id: string
  name: string
  type: string
  created_at: string
  is_hidden: number
  parent_id: string
  sort_order: number
}

// 每类标签挂在哪张表的哪个 JSON 列（与 Flutter tag_dao 对齐）
const TARGET: Record<TagType, { table: string; column: string }> = {
  movie_genre: { table: 'movies', column: 'genres' },
  book_genre: { table: 'books', column: 'genres' },
  game_genre: { table: 'games', column: 'genres' },
  note_tag: { table: 'notes', column: 'tags' }
}

function rowToTag(r: TagRow): Tag {
  return {
    id: r.id,
    name: r.name,
    type: r.type as TagType,
    isHidden: r.is_hidden === 1,
    parentId: r.parent_id ?? '',
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at
  }
}

class TagDao {
  private db(): Database {
    return getDb()
  }

  list(type?: TagType): Tag[] {
    const rows = type
      ? (this.db()
          .prepare('SELECT * FROM tags WHERE type = ? ORDER BY sort_order, name')
          .all(type) as TagRow[])
      : (this.db().prepare('SELECT * FROM tags ORDER BY sort_order, name').all() as TagRow[])
    return rows.map(rowToTag)
  }

  private findByName(name: string, type: TagType): TagRow | undefined {
    return this.db()
      .prepare('SELECT * FROM tags WHERE name = ? AND type = ?')
      .get(name, type) as TagRow | undefined
  }

  // 同名标签已存在则直接返回，避免 UNIQUE(name,type) 冲突
  add(type: TagType, name: string): Tag {
    const trimmed = name.trim()
    const existing = this.findByName(trimmed, type)
    if (existing) return rowToTag(existing)
    const row: TagRow = {
      id: randomUUID(),
      name: trimmed,
      type,
      created_at: new Date().toISOString(),
      is_hidden: 0,
      parent_id: '',
      sort_order: 0
    }
    this.db()
      .prepare(
        `INSERT INTO tags (id,name,type,created_at,is_hidden,parent_id,sort_order)
         VALUES (@id,@name,@type,@created_at,@is_hidden,@parent_id,@sort_order)`
      )
      .run(row)
    return rowToTag(row)
  }

  // 移动标签：改挂 parentId，并插到 beforeId 之前（beforeId 为空则排到末尾）。
  // 重排新旧父级下兄弟的 sort_order；禁止移入自身或自己的子孙（防环）。
  move(id: string, rawParentId: string, beforeId: string | null): void {
    const db = this.db()
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
    if (!tag) return
    const parentId = rawParentId || ''
    if (parentId === id) throw new Error('不能把标签放到自己下面')

    // 沿目标父级向上追溯，祖先链里出现 id 即说明要移入自己的子孙
    if (parentId) {
      let cursor: TagRow | undefined = db
        .prepare('SELECT * FROM tags WHERE id = ?')
        .get(parentId) as TagRow | undefined
      const guard = new Set<string>()
      while (cursor && !guard.has(cursor.id)) {
        guard.add(cursor.id)
        if (cursor.id === id) throw new Error('不能移动到自己的子标签下')
        cursor = cursor.parent_id
          ? (db.prepare('SELECT * FROM tags WHERE id = ?').get(cursor.parent_id) as
              | TagRow
              | undefined)
          : undefined
      }
    }

    const oldParentId = tag.parent_id ?? ''
    const renormalize = (pid: string): void => {
      const siblings = db
        .prepare('SELECT id FROM tags WHERE type = ? AND parent_id = ? ORDER BY sort_order, name')
        .all(tag.type, pid) as { id: string }[]
      const stmt = db.prepare('UPDATE tags SET sort_order = ? WHERE id = ?')
      siblings.forEach((s, i) => stmt.run(i, s.id))
    }

    const txn = db.transaction(() => {
      db.prepare('UPDATE tags SET parent_id = ? WHERE id = ?').run(parentId, id)
      // 新父级：先拿到不含 id 的兄弟顺序，按锚点插入，再统一编号
      const rows = db
        .prepare('SELECT id FROM tags WHERE type = ? AND parent_id = ? ORDER BY sort_order, name')
        .all(tag.type, parentId) as { id: string }[]
      const ids = rows.map((r) => r.id).filter((sid) => sid !== id)
      const index = beforeId ? ids.indexOf(beforeId) : -1
      if (index >= 0) ids.splice(index, 0, id)
      else ids.push(id)
      const stmt = db.prepare('UPDATE tags SET sort_order = ? WHERE id = ?')
      ids.forEach((sid, i) => stmt.run(i, sid))
      // 换了父级：旧父级的 sort_order 压紧
      if (oldParentId !== parentId) renormalize(oldParentId)
    })
    txn()
  }

  toggleHidden(id: string): boolean {
    const row = this.db().prepare('SELECT is_hidden FROM tags WHERE id = ?').get(id) as
      | { is_hidden: number }
      | undefined
    if (!row) return false
    this.db().prepare('UPDATE tags SET is_hidden = ? WHERE id = ?').run(
      row.is_hidden ? 0 : 1,
      id
    )
    return row.is_hidden !== 1
  }

  // 重写所有条目里的 JSON 标签数组：替换（带去重）或移除
  // LIKE 仅做候选过滤，解析后用精确相等匹配，避免子串误伤
  private cascade(
    type: TagType,
    oldName: string,
    mode: TagDeleteMode,
    newName?: string
  ): number {
    const { table, column } = TARGET[type]
    const rows = this.db()
      .prepare(`SELECT id, ${column} AS json, updated_at FROM ${table} WHERE ${column} LIKE ?`)
      .all(`%${oldName}%`) as { id: string; json: string | null; updated_at: string }[]
    const update = this.db().prepare(
      `UPDATE ${table} SET ${column} = @json, updated_at = @updated_at WHERE id = @id`
    )
    let affected = 0
    const apply = this.db().transaction((candidates: typeof rows) => {
      for (const r of candidates) {
        const list = parseStringList(r.json)
        if (!list.includes(oldName)) continue
        let next: string[]
        if (mode === 'purge') {
          next = list.filter((t) => t !== oldName)
        } else {
          const target = newName as string
          // 旧名→新名，同时去重：["A","B"] 合并 A→B 得 ["B"]
          next = [...new Set(list.map((t) => (t === oldName ? target : t)))]
        }
        update.run({
          id: r.id,
          json: encodeList(next),
          updated_at: new Date().toISOString()
        })
        affected++
      }
    })
    apply(rows)
    return affected
  }

  rename(id: string, rawName: string): void {
    const name = rawName.trim()
    const tag = this.db().prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
    if (!tag || !name || name === tag.name) return
    if (this.findByName(name, tag.type as TagType)) {
      throw new Error('已存在同名标签，改用「合并」')
    }
    const txn = this.db().transaction(() => {
      this.db().prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
      this.cascade(tag.type as TagType, tag.name, 'merge', name)
    })
    txn()
  }

  // detach: 只删标签行，条目里的名称保留
  // purge:  同时从所有条目的数组移除
  // merge:  名称并入 replacementName，条目同步替换，再删本行
  remove(id: string, mode: TagDeleteMode, replacementName?: string): void {
    const tag = this.db().prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
    if (!tag) return
    const type = tag.type as TagType
    let target = replacementName?.trim() || ''
    const txn = this.db().transaction(() => {
      if (mode === 'merge') {
        if (!target) throw new Error('请选择合并目标')
        if (target === tag.name) throw new Error('不能合并到自己')
        const existing = this.findByName(target, type)
        if (!existing) this.add(type, target)
        this.cascade(type, tag.name, 'merge', target)
      } else if (mode === 'purge') {
        this.cascade(type, tag.name, 'purge')
      }
      this.db().prepare('DELETE FROM tags WHERE id = ?').run(id)
    })
    txn()
  }

  // 从现有条目数据回填标签表（同步按钮），只增不删，忽略已删除条目
  syncFromData(): number {
    let added = 0
    const txn = this.db().transaction(() => {
      for (const [type, { table, column }] of Object.entries(TARGET) as [
        TagType,
        { table: string; column: string }
      ][]) {
        const rows = this.db()
          .prepare(
            `SELECT ${column} AS json FROM ${table} WHERE is_deleted = 0 AND ${column} IS NOT NULL`
          )
          .all() as { json: string | null }[]
        for (const r of rows) {
          for (const name of parseStringList(r.json)) {
            if (!this.findByName(name, type)) {
              this.add(type, name)
              added++
            }
          }
        }
      }
    })
    txn()
    return added
  }

  // 用量：内存里统计未删除条目的数组出现次数
  usage(type: TagType): Record<string, number> {
    const { table, column } = TARGET[type]
    const rows = this.db()
      .prepare(`SELECT ${column} AS json FROM ${table} WHERE is_deleted = 0`)
      .all() as { json: string | null }[]
    const counts: Record<string, number> = {}
    for (const r of rows) {
      for (const name of parseStringList(r.json)) counts[name] = (counts[name] ?? 0) + 1
    }
    return counts
  }
}

export const tagDao = new TagDao()
