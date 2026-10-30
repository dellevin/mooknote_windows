import type { Database } from 'better-sqlite3'
import { getDb } from '../index'
import { numOrNull, strOrNull } from '../util'
import type {
  CustomModule,
  CustomModuleDesign,
  CustomModuleDesignInput,
  CustomModuleItem,
  CustomModuleItemInput,
  CustomModuleInput,
  CustomFieldDef,
  CustomFieldValue
} from '../../../shared/types'
import { recordTombstone } from '../../services/sync/syncTombstones'

interface ModuleRow {
  id: string
  name: string
  icon: string | null
  sort_order: number
  active_design_id: string | null
  is_enabled: number
  created_at: string
  updated_at: string
  is_deleted: number
}
interface DesignRow {
  id: string
  module_id: string
  name: string
  fields_json: string | null
  is_active: number
  created_at: string
  updated_at: string
  is_deleted: number
}
interface ItemRow {
  id: string
  module_id: string
  title: string | null
  cover_path: string | null
  rating: number | null
  status: string | null
  data_json: string | null
  created_at: string
  updated_at: string
  is_deleted: number
}

function now(): string {
  return new Date().toISOString()
}

function rowToModule(r: ModuleRow): CustomModule {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon ?? '',
    sortOrder: r.sort_order,
    activeDesignId: r.active_design_id,
    isEnabled: r.is_enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1
  }
}

// 逐字段容错：单个坏字段不拖垮整份设计（与 Flutter 一致）
function parseFields(raw: string | null): CustomFieldDef[] {
  if (!raw) return []
  let arr: unknown[]
  try {
    const decoded = JSON.parse(raw)
    if (!Array.isArray(decoded)) return []
    arr = decoded
  } catch {
    return []
  }
  const out: CustomFieldDef[] = []
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue
    const f = e as Record<string, unknown>
    if (!f['key'] || !f['type']) continue
    out.push({
      key: String(f['key']),
      type: f['type'] as CustomFieldDef['type'],
      label: String(f['label'] ?? ''),
      required: f['required'] === true,
      options: Array.isArray(f['options']) ? f['options'].map(String) : [],
      isTitle: f['isTitle'] === true,
      halfWidth: f['halfWidth'] === true,
      halfOnLeft: f['halfOnLeft'] !== false,
      icon: f['icon'] ? String(f['icon']) : ''
    })
  }
  return out
}

function rowToDesign(r: DesignRow): CustomModuleDesign {
  return {
    id: r.id,
    moduleId: r.module_id,
    name: r.name,
    fields: parseFields(r.fields_json),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1
  }
}

function rowToItem(r: ItemRow): CustomModuleItem {
  let data: Record<string, CustomFieldValue> = {}
  if (r.data_json) {
    try {
      const decoded = JSON.parse(r.data_json)
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) data = decoded
    } catch {
      /* keep empty */
    }
  }
  return {
    id: r.id,
    moduleId: r.module_id,
    title: r.title ?? '',
    coverPath: r.cover_path,
    rating: r.rating,
    status: r.status,
    data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDeleted: r.is_deleted === 1
  }
}

class ModuleDao {
  private db(): Database {
    return getDb()
  }

  list(includeDeleted = false): CustomModule[] {
    const sql = includeDeleted
      ? `SELECT * FROM custom_modules ORDER BY sort_order ASC, created_at ASC`
      : `SELECT * FROM custom_modules WHERE is_deleted=0
         ORDER BY sort_order ASC, created_at ASC`
    return (this.db().prepare(sql).all() as ModuleRow[]).map(rowToModule)
  }

  getById(id: string, includeDeleted = false): CustomModule | null {
    const row = this.db()
      .prepare(
        `SELECT * FROM custom_modules WHERE id=? ${includeDeleted ? '' : 'AND is_deleted=0'}`
      )
      .get(id) as ModuleRow | undefined
    return row ? rowToModule(row) : null
  }

  insert(input: CustomModuleInput): CustomModule {
    const ts = now()
    this.db()
      .prepare(
        `INSERT INTO custom_modules
         (id,name,icon,sort_order,active_design_id,is_enabled,created_at,updated_at,is_deleted)
         VALUES (@id,@name,@icon,@sort_order,@active_design_id,@is_enabled,@created_at,@updated_at,0)`
      )
      .run({
        id: input.id,
        name: input.name,
        icon: input.icon,
        sort_order: input.sortOrder,
        active_design_id: input.activeDesignId ?? null,
        is_enabled: input.isEnabled ? 1 : 0,
        created_at: ts,
        updated_at: ts
      })
    return this.getById(input.id)!
  }

  update(input: CustomModuleInput): CustomModule {
    this.db()
      .prepare(
        `UPDATE custom_modules SET name=@name,icon=@icon,sort_order=@sort_order,
         active_design_id=@active_design_id,is_enabled=@is_enabled,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({
        id: input.id,
        name: input.name,
        icon: input.icon,
        sort_order: input.sortOrder,
        active_design_id: input.activeDesignId ?? null,
        is_enabled: input.isEnabled ? 1 : 0,
        updated_at: now()
      })
    return this.getById(input.id)!
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db()
      .prepare(`UPDATE custom_modules SET is_enabled=?,updated_at=? WHERE id=?`)
      .run(enabled ? 1 : 0, now(), id)
  }

  // 级联软删设计与条目（与 Flutter deleteModule 一致）
  softDelete(id: string): void {
    const ts = now()
    const db = this.db()
    db.transaction(() => {
      db.prepare(`UPDATE custom_modules SET is_deleted=1,updated_at=? WHERE id=?`).run(ts, id)
      db.prepare(
        `UPDATE custom_module_designs SET is_deleted=1,updated_at=? WHERE module_id=?`
      ).run(ts, id)
      db.prepare(
        `UPDATE custom_module_items SET is_deleted=1,updated_at=? WHERE module_id=?`
      ).run(ts, id)
    })()
  }

  nextSortOrder(): number {
    const row = this.db()
      .prepare(`SELECT MAX(sort_order) AS m FROM custom_modules`)
      .get() as { m: number | null }
    return (row.m ?? -1) + 1
  }
}

class DesignDao {
  private db(): Database {
    return getDb()
  }

  listByModule(moduleId: string): CustomModuleDesign[] {
    return (this.db()
      .prepare(
        `SELECT * FROM custom_module_designs WHERE module_id=? AND is_deleted=0
         ORDER BY created_at ASC`
      )
      .all(moduleId) as DesignRow[]).map(rowToDesign)
  }

  getById(id: string): CustomModuleDesign | null {
    const row = this.db()
      .prepare(`SELECT * FROM custom_module_designs WHERE id=? AND is_deleted=0`)
      .get(id) as DesignRow | undefined
    return row ? rowToDesign(row) : null
  }

  getActive(moduleId: string): CustomModuleDesign | null {
    const row = this.db()
      .prepare(
        `SELECT * FROM custom_module_designs WHERE module_id=? AND is_active=1 AND is_deleted=0
         LIMIT 1`
      )
      .get(moduleId) as DesignRow | undefined
    return row ? rowToDesign(row) : null
  }

  insert(input: CustomModuleDesignInput): CustomModuleDesign {
    const ts = now()
    this.db()
      .prepare(
        `INSERT INTO custom_module_designs
         (id,module_id,name,fields_json,is_active,created_at,updated_at,is_deleted)
         VALUES (@id,@module_id,@name,@fields_json,0,@created_at,@updated_at,0)`
      )
      .run({
        id: input.id,
        module_id: input.moduleId,
        name: input.name,
        fields_json: JSON.stringify(input.fields ?? []),
        created_at: ts,
        updated_at: ts
      })
    return this.getById(input.id)!
  }

  update(input: CustomModuleDesignInput): CustomModuleDesign {
    this.db()
      .prepare(
        `UPDATE custom_module_designs SET name=@name,fields_json=@fields_json,updated_at=@updated_at
         WHERE id=@id`
      )
      .run({
        id: input.id,
        name: input.name,
        fields_json: JSON.stringify(input.fields ?? []),
        updated_at: now()
      })
    return this.getById(input.id)!
  }

  // 事务：清同模块其他激活 -> 激活指定 -> 同步模块 active_design_id
  setActive(moduleId: string, designId: string): void {
    const ts = now()
    const db = this.db()
    db.transaction(() => {
      db.prepare(
        `UPDATE custom_module_designs SET is_active=0,updated_at=? WHERE module_id=?`
      ).run(ts, moduleId)
      db.prepare(
        `UPDATE custom_module_designs SET is_active=1,updated_at=? WHERE id=? AND module_id=?`
      ).run(ts, designId, moduleId)
      db.prepare(
        `UPDATE custom_modules SET active_design_id=?,updated_at=? WHERE id=?`
      ).run(designId, ts, moduleId)
    })()
  }

  // 软删设计；模块当前指向它时清空 active_design_id
  softDelete(moduleId: string, designId: string): void {
    const ts = now()
    const db = this.db()
    db.transaction(() => {
      db.prepare(
        `UPDATE custom_module_designs SET is_deleted=1,updated_at=? WHERE id=?`
      ).run(ts, designId)
      db.prepare(
        `UPDATE custom_modules
         SET active_design_id=NULL,updated_at=?
         WHERE id=? AND active_design_id=?`
      ).run(ts, moduleId, designId)
    })()
  }
}

class ItemDao {
  private db(): Database {
    return getDb()
  }

  listByModule(moduleId: string): CustomModuleItem[] {
    return (this.db()
      .prepare(
        `SELECT * FROM custom_module_items WHERE module_id=? AND is_deleted=0
         ORDER BY created_at DESC`
      )
      .all(moduleId) as ItemRow[]).map(rowToItem)
  }

  listDeleted(): CustomModuleItem[] {
    return (this.db()
      .prepare(`SELECT * FROM custom_module_items WHERE is_deleted=1 ORDER BY updated_at DESC`)
      .all() as ItemRow[]).map(rowToItem)
  }

  getById(id: string, includeDeleted = false): CustomModuleItem | null {
    const row = this.db()
      .prepare(
        `SELECT * FROM custom_module_items WHERE id=? ${includeDeleted ? '' : 'AND is_deleted=0'}`
      )
      .get(id) as ItemRow | undefined
    return row ? rowToItem(row) : null
  }

  countForModule(moduleId: string): number {
    const row = this.db()
      .prepare(
        `SELECT COUNT(*) AS c FROM custom_module_items WHERE module_id=? AND is_deleted=0`
      )
      .get(moduleId) as { c: number }
    return row.c
  }

  search(moduleId: string, keyword: string): CustomModuleItem[] {
    return (this.db()
      .prepare(
        `SELECT * FROM custom_module_items
         WHERE module_id=? AND title LIKE ? AND is_deleted=0 ORDER BY updated_at DESC`
      )
      .all(moduleId, `%${keyword}%`) as ItemRow[]).map(rowToItem)
  }

  insert(input: CustomModuleItemInput): CustomModuleItem {
    const ts = now()
    this.db()
      .prepare(
        `INSERT INTO custom_module_items
         (id,module_id,title,cover_path,rating,status,data_json,created_at,updated_at,is_deleted)
         VALUES (@id,@module_id,@title,@cover_path,@rating,@status,@data_json,@created_at,@updated_at,0)`
      )
      .run({
        id: input.id,
        module_id: input.moduleId,
        title: input.title,
        cover_path: strOrNull(input.coverPath),
        rating: numOrNull(input.rating),
        status: strOrNull(input.status),
        data_json: JSON.stringify(input.data ?? {}),
        created_at: ts,
        updated_at: ts
      })
    return this.getById(input.id)!
  }

  update(input: CustomModuleItemInput): CustomModuleItem {
    this.db()
      .prepare(
        `UPDATE custom_module_items SET title=@title,cover_path=@cover_path,rating=@rating,
         status=@status,data_json=@data_json,updated_at=@updated_at WHERE id=@id`
      )
      .run({
        id: input.id,
        title: input.title,
        cover_path: strOrNull(input.coverPath),
        rating: numOrNull(input.rating),
        status: strOrNull(input.status),
        data_json: JSON.stringify(input.data ?? {}),
        updated_at: now()
      })
    return this.getById(input.id)!
  }

  softDelete(id: string): void {
    this.db()
      .prepare(`UPDATE custom_module_items SET is_deleted=1,updated_at=? WHERE id=?`)
      .run(now(), id)
  }

  restore(id: string): void {
    this.db()
      .prepare(`UPDATE custom_module_items SET is_deleted=0,updated_at=? WHERE id=?`)
      .run(now(), id)
  }

  permanentDelete(id: string): void {
    recordTombstone('custom_module_items', id)
    this.db().prepare(`DELETE FROM custom_module_items WHERE id=?`).run(id)
  }
}

export const moduleDao = new ModuleDao()
export const designDao = new DesignDao()
export const itemDao = new ItemDao()
