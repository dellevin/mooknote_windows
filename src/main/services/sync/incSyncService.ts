import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDb } from '../../db'
import { imagesRoot } from '../../paths'
import { getConfig } from '../webdavHttp'
import {
  ENTITIES,
  GROUPS,
  groupImageColumn,
  groupSpecOf,
  softDeleteGroupWhere,
  specOf,
  type IncEntitySpec
} from './incEntities'
import { IncRowCodec, isImagePath, toLogical } from './incRowCodec'
import { IncRemote, sha256Hex } from './incRemote'
import { buildManifestFromLocal } from './incManifestBuilder'
import {
  type ChunkIndex,
  type DeltaOp,
  type GroupMap,
  type Manifest,
  type Row,
  type TombstoneEntry
} from './incProtocol'
import { clientId, cachedClientId } from './syncIdentity'
import {
  K_LAST_SYNC,
  K_MANIFEST_VERSION,
  K_PUSH_AFTER,
  getAppliedDeltas,
  getImageMap,
  getSeenChunks,
  metaGet,
  metaGetInt,
  metaSet,
  setAppliedDeltas,
  setImageMap,
  setSeenChunks
} from './syncMetaStore'
import {
  allTombstones,
  clearEmbedded,
  markPushed,
  recordRemote as recordRemoteTomb,
  takePending,
  type TombRow
} from './syncTombstones'

export interface IncSyncResult {
  success: boolean
  message: string
  uploadedRecords: number
  downloadedRecords: number
  uploadedImages: number
  downloadedImages: number
  dedupImages: number
  needReload: boolean
  manifestVersion: number
}

export type IncStage =
  | 'connect'
  | 'baseline'
  | 'pull-chunk'
  | 'pull-delta'
  | 'reconcile'
  | 'push'
  | 'image'
  | 'compact'
  | 'done'

export interface IncProgress {
  stage: IncStage
  message: string
  upRecords: number
  downRecords: number
  upImages: number
  downImages: number
  dedupImages: number
}

type ProgressCb = (p: IncProgress) => void

class Counters {
  upRecords = 0
  downRecords = 0
  upImages = 0
  downImages = 0
  dedupImages = 0
  failedImages = 0
}

function result(partial: Partial<IncSyncResult> & { success: boolean; message: string }): IncSyncResult {
  return {
    uploadedRecords: 0,
    downloadedRecords: 0,
    uploadedImages: 0,
    downloadedImages: 0,
    dedupImages: 0,
    needReload: false,
    manifestVersion: 0,
    ...partial
  }
}

let syncing = false

export async function incUpload(onProgress?: ProgressCb): Promise<IncSyncResult> {
  return run({ push: true, onProgress })
}
export async function incDownload(onProgress?: ProgressCb): Promise<IncSyncResult> {
  return run({ push: false, onProgress })
}

export async function getIncInfo(
  fetchRemoteVersion = true
): Promise<{ lastSync: string; manifestVersion: number | null }> {
  const lastSync = metaGet(K_LAST_SYNC) ?? ''
  const cfg = getConfig()
  if (!cfg || !fetchRemoteVersion) return { lastSync, manifestVersion: null }
  try {
    const remote = await IncRemote.create(cfg)
    const manifest = await remote.getManifest()
    return { lastSync, manifestVersion: manifest?.v ?? null }
  } catch {
    return { lastSync, manifestVersion: null }
  }
}

// ── 通用 DB 帮助 ────────────────────────────────────────

const columnCache = new Map<string, Set<string>>()

function columnsOf(table: string): Set<string> {
  let cols = columnCache.get(table)
  if (!cols) {
    const info = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    cols = new Set(info.map((c) => c.name))
    columnCache.set(table, cols)
  }
  return cols
}

/** 整行 INSERT OR REPLACE，按目标表实际列过滤，布尔归一为 0/1 */
function insertRow(table: string, row: Row): void {
  const cols = [...Object.keys(row)].filter((c) => columnsOf(table).has(c))
  if (!cols.length) return
  const placeholders = cols.map(() => '?').join(', ')
  const quoted = cols.map((c) => `"${c}"`).join(', ')
  const values = cols.map((c) => {
    const v = row[c]
    return v === true ? 1 : v === false ? 0 : v
  })
  getDb()
    .prepare(`INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${placeholders})`)
    .run(...values)
}

function rowById(table: string, id: string): Row | null {
  return (getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined) ?? null
}

function setForeignKeys(on: boolean): void {
  getDb().pragma(`foreign_keys = ${on ? 'ON' : 'OFF'}`)
}

function tombEntryFromRow(r: TombRow): TombstoneEntry {
  return { t: r.entity_type, id: r.entity_id, ts: r.deleted_at, c: r.client_id }
}

function emit(cb: ProgressCb | undefined, c: Counters, stage: IncStage, message: string): void {
  cb?.({
    stage,
    message,
    upRecords: c.upRecords,
    downRecords: c.downRecords,
    upImages: c.upImages,
    downImages: c.downImages,
    dedupImages: c.dedupImages
  })
}

// ── 主编排 ──────────────────────────────────────────────

async function run(opts: { push: boolean; onProgress?: ProgressCb }): Promise<IncSyncResult> {
  const { push, onProgress } = opts
  const cfg = getConfig()
  if (!cfg) return result({ success: false, message: '未配置 WebDAV' })
  if (syncing) return result({ success: false, message: '同步正在进行中，请稍后再试' })
  syncing = true

  const counters = new Counters()
  const syncStart = new Date().toISOString()
  const codec = new IncRowCodec(imagesRoot())

  try {
    const cid = clientId()
    emit(onProgress, counters, 'connect', '正在连接服务器…')
    const remote = await IncRemote.create(cfg)
    const manifest = await remote.getManifest()

    // ── 情况1：远程尚无基线，本客户端成为首个客户端 ──
    if (!manifest) {
      emit(onProgress, counters, 'baseline', '正在建立首个云端基线…')
      const tombRows = allTombstones()
      const built = await buildManifestFromLocal({
        remote,
        codec,
        version: 1,
        clientId: cid,
        foldedDeltas: [],
        imageMap: {},
        tombstones: tombRows.map(tombEntryFromRow)
      })
      if (!(await remote.putManifest(built))) {
        return result({ success: false, message: '上传基线失败' })
      }
      clearEmbedded(tombRows)
      const imageCount = Object.keys(built.img).length
      const recordCount = Object.values(built.chunks)
        .flat()
        .reduce((a, c) => a + c.ids.length, 0)
      metaSet(K_MANIFEST_VERSION, '1')
      setAppliedDeltas(new Set())
      setImageMap(built.img)
      metaSet(K_PUSH_AFTER, syncStart)
      metaSet(K_LAST_SYNC, syncStart)
      return result({
        success: true,
        message: '同步完成',
        uploadedRecords: recordCount,
        uploadedImages: imageCount,
        manifestVersion: 1
      })
    }

    // ── 情况2：基线存在，拉取合并 ──
    const localV = metaGetInt(K_MANIFEST_VERSION) ?? 0
    const isNewManifest = localV < manifest.v
    const localWins = new Set<string>()
    let imageMap = getImageMap()
    let appliedDeltas = getAppliedDeltas()
    let manifestApplied = true

    setForeignKeys(false)
    try {
      if (isNewManifest) {
        imageMap = { ...imageMap, ...manifest.img }

        // 0) manifest 携带的墓碑：被压实折叠的删除只能通过这里传播
        for (const t of manifest.tombs) {
          if (!specOf(t.t)) continue
          mergeDelete(t.t, t.id, t.ts, t.c, counters, localWins)
        }

        // 1) 应用新 manifest 的分块
        emit(onProgress, counters, 'pull-chunk', '正在下载云端快照…')
        const seen = getSeenChunks()
        for (const spec of ENTITIES) {
          for (const chunk of manifest.chunks[spec.table] ?? []) {
            if (seen.has(chunk.h)) continue
            const bytes = await remote.getBlob(chunk.h)
            if (!bytes) {
              manifestApplied = false
              continue
            }
            try {
              const obj = JSON.parse(bytes.toString('utf-8')) as {
                rows?: Row[]
                g?: Record<string, Row[]>
              }
              const groupsBucket = bucketGroups(obj.g)
              const failedBefore = counters.failedImages
              for (const r of obj.rows ?? []) {
                await mergeUpsert(
                  spec,
                  r,
                  manifest.c,
                  (r[spec.tsColumn] as string | undefined) ?? null,
                  groupsBucket.get(String(r.id)) ?? null,
                  counters,
                  localWins,
                  codec,
                  remote,
                  imageMap,
                  false,
                  onProgress
                )
              }
              if (counters.failedImages === failedBefore) seen.add(chunk.h)
              else manifestApplied = false
            } catch {
              manifestApplied = false
            }
          }
        }
        setSeenChunks(seen)

        // 2) 对账：硬删除只能靠 manifest 全量 ID 列表反推
        if (manifestApplied) {
          emit(onProgress, counters, 'reconcile', '正在核对删除…')
          reconcile(manifest, counters)
        }

        // 3) 已折叠 delta 从待应用集合剔除
        for (const f of manifest.folded) appliedDeltas.delete(f)
        imageMap = { ...imageMap, ...manifest.img }
      }

      // 拉取远程增量列表
      const names = await remote.listDeltaNames()
      if (names === null) {
        return result({ success: false, message: '无法读取远程增量列表，同步中止' })
      }

      let allDeltasClean = true
      {
        const folded = new Set(manifest.folded)
        const pending = names.filter((n) => !appliedDeltas.has(n) && !folded.has(n))
        if (pending.length) emit(onProgress, counters, 'pull-delta', `正在下载 ${pending.length} 个增量…`)

        for (const name of pending) {
          const delta = await remote.getDelta(name)
          if (!delta) {
            allDeltasClean = false
            continue
          }
          imageMap = { ...imageMap, ...delta.img }
          const failedBefore = counters.failedImages
          for (const op of delta.ops) {
            const spec = specOf(op.t)
            if (!spec) continue
            if (op.d === 1) {
              mergeDelete(op.t, op.id, op.ts, delta.c, counters, localWins)
            } else if (op.row) {
              await mergeUpsert(
                spec,
                op.row,
                delta.c,
                op.ts,
                op.g ?? null,
                counters,
                localWins,
                codec,
                remote,
                imageMap,
                false,
                onProgress
              )
            } else if (op.g) {
              await mergeGroupsOnly(
                spec,
                op.id,
                op.ts,
                op.g,
                delta.c,
                counters,
                localWins,
                codec,
                remote,
                imageMap,
                onProgress
              )
            }
          }
          if (counters.failedImages === failedBefore) appliedDeltas.add(name)
          else allDeltasClean = false
        }
        setAppliedDeltas(appliedDeltas)
        setImageMap(imageMap)
        // 分块未完整应用时不推进版本，下次重试缺失分块
        metaSet(K_MANIFEST_VERSION, manifestApplied ? String(manifest.v) : String(localV))

        if (metaGet(K_PUSH_AFTER) === null) {
          metaSet(K_PUSH_AFTER, syncStart)
        }
      }

      // ── 推送本地变更 ──
      if (push) {
        emit(onProgress, counters, 'push', '正在推送本地变更…')
        await pushChanges(remote, codec, cid, localWins, counters, appliedDeltas, syncStart, onProgress)
      }

      metaSet(K_LAST_SYNC, syncStart)

      // ── 压实检查：完全对齐且 delta>50 时 ──
      if (manifestApplied && allDeltasClean && localV === manifest.v && names.length > 50) {
        emit(onProgress, counters, 'compact', '正在整理云端数据…')
        await compact(remote, codec, cid, names)
      }
    } finally {
      setForeignKeys(true)
    }

    const anyChange = counters.upRecords > 0 || counters.downRecords > 0
    emit(onProgress, counters, 'done', anyChange ? '同步完成' : '没有新的变更')
    return result({
      success: true,
      message: anyChange ? '同步完成' : '没有新的变更',
      uploadedRecords: counters.upRecords,
      downloadedRecords: counters.downRecords,
      uploadedImages: counters.upImages,
      downloadedImages: counters.downImages,
      dedupImages: counters.dedupImages,
      needReload: counters.downRecords > 0,
      manifestVersion: manifest.v
    })
  } catch (e) {
    return result({ success: false, message: `同步失败: ${String(e)}` })
  } finally {
    syncing = false
  }
}

// ── 对账 ────────────────────────────────────────────────

function reconcile(manifest: Manifest, counters: Counters): void {
  const pushAfter = metaGet(K_PUSH_AFTER)
  if (pushAfter === null) return // 从未推送：无法区分本地新增与远程已删
  const pa = Date.parse(pushAfter)
  const mc = Date.parse(manifest.at)
  const db = getDb()
  for (const spec of ENTITIES) {
    const manifestIds = new Set<string>()
    for (const chunk of manifest.chunks[spec.table] ?? []) {
      for (const id of chunk.ids) manifestIds.add(id)
    }
    const localRows = db.prepare(`SELECT * FROM ${spec.table}`).all() as Row[]
    for (const row of localRows) {
      const id = String(row.id)
      if (manifestIds.has(id)) continue
      const ts = Date.parse((row[spec.tsColumn] as string | undefined) ?? '')
      if (Number.isNaN(ts)) continue // 无法解析 → 保留
      if (!Number.isNaN(pa) && ts > pa) continue // 待推送 → 保留
      if (Number.isNaN(mc) || ts >= mc) continue // 快照后才动 → 保留
      db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(id)
      for (const groupKey of Object.keys(spec.groups)) {
        const gspec = groupSpecOf(groupKey)
        if (gspec) db.prepare(`DELETE FROM ${groupKey} WHERE ${gspec.parentColumn} = ?`).run(id)
      }
      counters.downRecords++
    }
  }
}

// ── 合并 ────────────────────────────────────────────────

function bucketGroups(g: Record<string, Row[]> | undefined): Map<string, GroupMap> {
  const bucket = new Map<string, GroupMap>()
  for (const [groupTable, rows] of Object.entries(g ?? {})) {
    const gspec = groupSpecOf(groupTable)
    if (!gspec) continue
    for (const r of rows) {
      const pid = String(r[gspec.parentColumn])
      const byTable = bucket.get(pid) ?? {}
      ;(byTable[groupTable] ??= []).push(r)
      bucket.set(pid, byTable)
    }
  }
  return bucket
}

interface MergeCtx {
  counters: Counters
  localWins: Set<string>
  codec: IncRowCodec
  remote: IncRemote
  imageMap: Record<string, string>
  onProgress?: ProgressCb
}

async function mergeUpsert(
  spec: IncEntitySpec,
  incomingRow: Row,
  origin: string,
  incomingTs: string | null,
  groups: GroupMap | null,
  counters: Counters,
  localWins: Set<string>,
  codec: IncRowCodec,
  remote: IncRemote,
  imageMap: Record<string, string>,
  force: boolean,
  onProgress?: ProgressCb
): Promise<void> {
  const id = String(incomingRow.id)
  const local = rowById(spec.table, id)
  const ownId = cachedClientId()
  const ctx: MergeCtx = { counters, localWins, codec, remote, imageMap, onProgress }

  if (local && !force) {
    const wins = remoteWins((local[spec.tsColumn] as string | undefined) ?? null, incomingTs, origin, ownId)
    if (!wins && !rowsEqual(normalizeForCompare(local, spec), normalizeForCompare(incomingRow, spec))) {
      localWins.add(`${spec.table}|${id}`)
      return
    }
    if (!wins && !groups) {
      localWins.add(`${spec.table}|${id}`)
      return
    }
  }

  const localized = codec.localize(incomingRow, spec)
  insertRow(spec.table, localized)
  if (groups) replaceGroups(id, groups, codec)
  counters.downRecords++

  const logical = new Set(codec.referencedLogical(localized, spec))
  if (groups) collectGroupImageLogical(groups, logical)
  for (const l of logical) await downloadImage(ctx, l)
}

async function mergeGroupsOnly(
  spec: IncEntitySpec,
  parentId: string,
  incomingTs: string,
  groups: GroupMap,
  origin: string,
  counters: Counters,
  localWins: Set<string>,
  codec: IncRowCodec,
  remote: IncRemote,
  imageMap: Record<string, string>,
  onProgress?: ProgressCb
): Promise<void> {
  const local = rowById(spec.table, parentId)
  if (!local) return // 本地无父实体，忽略
  const ownId = cachedClientId()
  if (!remoteWins((local[spec.tsColumn] as string | undefined) ?? null, incomingTs, origin, ownId)) {
    localWins.add(`${spec.table}|${parentId}`)
    return
  }
  replaceGroups(parentId, groups, codec)
  counters.downRecords++
  const ctx: MergeCtx = { counters, localWins, codec, remote, imageMap, onProgress }
  const logical = new Set<string>()
  collectGroupImageLogical(groups, logical)
  for (const l of logical) await downloadImage(ctx, l)
}

function collectGroupImageLogical(groups: GroupMap, out: Set<string>): void {
  for (const [groupTable, rows] of Object.entries(groups)) {
    const imgCol = groupImageColumn(groupTable)
    const jsonCol = groupSpecOf(groupTable)?.imageJsonColumn ?? null
    for (const r of rows) {
      if (imgCol) {
        const v = r[imgCol]
        if (typeof v === 'string' && v) out.add(toLogical(v))
      }
      if (jsonCol && typeof r[jsonCol] === 'string') {
        for (const l of new IncRowCodec('').logicalFromJsonList(r[jsonCol] as string)) out.add(l)
      }
    }
  }
}

function mergeDelete(
  table: string,
  id: string,
  incomingTs: string,
  origin: string,
  counters: Counters,
  localWins: Set<string>,
  force = false
): void {
  const spec = specOf(table)
  if (!spec) return
  const local = rowById(table, id)
  const ownId = cachedClientId()
  if (local && !force && !remoteWins((local[spec.tsColumn] as string | undefined) ?? null, incomingTs, origin, ownId)) {
    localWins.add(`${table}|${id}`)
    return
  }
  if (local) {
    const db = getDb()
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    for (const groupKey of Object.keys(spec.groups)) {
      const gspec = groupSpecOf(groupKey)
      if (gspec) db.prepare(`DELETE FROM ${groupKey} WHERE ${gspec.parentColumn} = ?`).run(id)
    }
    counters.downRecords++
  }
  recordRemoteTomb(table, id, incomingTs, origin)
}

function normalizeForCompare(row: Row, spec: IncEntitySpec): Row {
  const out: Row = { ...row }
  for (const col of spec.imageColumns) {
    const v = out[col]
    if (typeof v === 'string' && v) out[col] = toLogical(v)
  }
  const jsonCol = spec.imageJsonColumn
  if (jsonCol) {
    const v = out[jsonCol]
    if (typeof v === 'string' && v) {
      try {
        const list = (JSON.parse(v) as unknown[]).filter((e): e is string => typeof e === 'string').map(toLogical)
        out[jsonCol] = JSON.stringify(list)
      } catch {
        /* keep */
      }
    }
  }
  const mapCol = spec.imageJsonMapColumn
  if (mapCol) {
    const v = out[mapCol]
    if (typeof v === 'string' && v) {
      try {
        const map = JSON.parse(v) as Record<string, unknown>
        const updated: Record<string, unknown> = { ...map }
        let changed = false
        for (const [k, val] of Object.entries(map)) {
          if (typeof val === 'string' && isImagePath(val)) {
            updated[k] = toLogical(val)
            changed = true
          } else if (Array.isArray(val)) {
            updated[k] = val.map((e) => (typeof e === 'string' && isImagePath(e) ? toLogical(e) : e))
            changed = true
          }
        }
        if (changed) out[mapCol] = JSON.stringify(updated)
      } catch {
        /* keep */
      }
    }
  }
  return out
}

function rowsEqual(a: Row, b: Row): boolean {
  if (Object.keys(a).length !== Object.keys(b).length) return false
  for (const key of Object.keys(a)) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    const av = a[key]
    const bv = b[key]
    if (av && typeof av === 'object') {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false
    } else if (av !== bv) {
      return false
    }
  }
  return true
}

/** LWW：远程较新返回 true；时间戳相同用 clientId 字典序兜底 */
function remoteWins(
  localTs: string | null,
  remoteTs: string | null,
  remoteClient: string,
  ownClient: string
): boolean {
  if (localTs === null) return true
  if (remoteTs === null) return false
  const lt = Date.parse(localTs)
  const rt = Date.parse(remoteTs)
  if (Number.isNaN(lt) || Number.isNaN(rt)) return true
  if (rt !== lt) return rt > lt
  return remoteClient > ownClient
}

function replaceGroups(parentId: string, groups: GroupMap, codec: IncRowCodec): void {
  const db = getDb()
  const txn = db.transaction(() => {
    for (const [groupTable, rows] of Object.entries(groups)) {
      const gspec = groupSpecOf(groupTable)
      if (!gspec) continue
      db.prepare(`DELETE FROM ${groupTable} WHERE ${gspec.parentColumn} = ?`).run(parentId)
      for (const r of codec.localizeGroupRows(groupTable, rows)) insertRow(groupTable, r)
    }
  })
  txn()
}

async function downloadImage(ctx: MergeCtx, logical: string): Promise<void> {
  const file = ctx.codec.localPathOf(logical)
  if (fs.existsSync(file)) return
  const hash = ctx.imageMap[logical]
  if (!hash) return
  const bytes = await ctx.remote.getBlob(hash)
  if (!bytes) {
    ctx.counters.failedImages++
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  ctx.counters.downImages++
}

// ── 推送 ────────────────────────────────────────────────

async function pushChanges(
  remote: IncRemote,
  codec: IncRowCodec,
  cid: string,
  localWins: Set<string>,
  counters: Counters,
  appliedDeltas: Set<string>,
  syncStart: string,
  onProgress?: ProgressCb
): Promise<void> {
  const after = metaGet(K_PUSH_AFTER)
  const afterTs = after === null ? NaN : Date.parse(after)

  // 历史数据本地/UTC 混存，统一解析后比较；无法解析按已变更处理（宁多推勿漏推）
  const changedAfter = (tsStr: string | null | undefined): boolean => {
    if (Number.isNaN(afterTs)) return true
    if (!tsStr) return true
    const ts = Date.parse(tsStr)
    if (Number.isNaN(ts)) return true
    return ts > afterTs
  }

  const db = getDb()
  // 1) 水位之后变更的行
  const selected = new Map<string, Row>()
  for (const spec of ENTITIES) {
    const rows = db.prepare(`SELECT * FROM ${spec.table}`).all() as Row[]
    for (const r of rows) {
      if (changedAfter(r[spec.tsColumn] as string | undefined)) {
        selected.set(`${spec.table}|${r.id}`, r)
      }
    }
  }

  // 2) 拉取合并中本地胜出的行
  for (const key of localWins) {
    if (selected.has(key)) continue
    const sep = key.indexOf('|')
    const rows = db
      .prepare(`SELECT * FROM ${key.slice(0, sep)} WHERE id = ?`)
      .all(key.slice(sep + 1)) as Row[]
    if (rows.length) selected.set(key, rows[0])
  }

  // 3) 待推送墓碑
  const tombRows = takePending()

  // 4) 子组新增（父行本身未变）
  const groupOnly = new Map<string, Set<string>>()
  for (const gspec of GROUPS) {
    const tsCol = gspec.tsColumn
    if (!tsCol) continue
    const where = softDeleteGroupWhere(gspec.table)
    const rows = (where
      ? db.prepare(`SELECT * FROM ${gspec.table} WHERE ${where}`).all()
      : db.prepare(`SELECT * FROM ${gspec.table}`).all()) as Row[]
    for (const r of rows) {
      if (changedAfter(r[tsCol] as string | undefined)) {
        if (!groupOnly.has(gspec.table)) groupOnly.set(gspec.table, new Set())
        groupOnly.get(gspec.table)!.add(String(r[gspec.parentColumn]))
      }
    }
  }

  const ops: DeltaOp[] = []
  const newImageMap: Record<string, string> = {}
  const pushCtx: MergeCtx = { counters, localWins, codec, remote, imageMap: {}, onProgress }

  const loadGroups = (parentId: string, spec: IncEntitySpec): GroupMap => {
    const result: GroupMap = {}
    for (const groupKey of Object.keys(spec.groups)) {
      const gspec = GROUPS.find((g) => g.table === groupKey)!
      const where = softDeleteGroupWhere(groupKey)
      const rows = (where
        ? db
            .prepare(`SELECT * FROM ${groupKey} WHERE ${gspec.parentColumn} = ? AND ${where}`)
            .all(parentId)
        : db.prepare(`SELECT * FROM ${groupKey} WHERE ${gspec.parentColumn} = ?`).all(parentId)) as Row[]
      result[groupKey] = rows
      for (const r of rows) {
        const imgCol = groupImageColumn(groupKey)
        const abs = imgCol ? (r[imgCol] as string | undefined) : undefined
        if (abs) pushImage(pushCtx, newImageMap, toLogical(abs))
        if (gspec.imageJsonColumn) {
          for (const l of codec.logicalFromJsonList(r[gspec.imageJsonColumn] as string | undefined)) {
            pushImage(pushCtx, newImageMap, l)
          }
        }
      }
    }
    return result
  }

  for (const [key, row] of selected) {
    const sep = key.indexOf('|')
    const spec = specOf(key.slice(0, sep))!
    const groups = loadGroups(String(row.id), spec)
    for (const l of codec.referencedLogical(row, spec)) pushImage(pushCtx, newImageMap, l)
    ops.push({
      t: spec.table,
      id: String(row.id),
      ts: row[spec.tsColumn] as string,
      row,
      ...(Object.keys(groups).length ? { g: groups } : {})
    })
    counters.upRecords++
  }

  // group-only ops
  for (const [groupTable, parentIds] of groupOnly) {
    const gspec = GROUPS.find((g) => g.table === groupTable)!
    for (const parentId of parentIds) {
      const key = `${gspec.parentTable}|${parentId}`
      if (selected.has(key)) continue
      const parents = db.prepare(`SELECT * FROM ${gspec.parentTable} WHERE id = ?`).all(parentId) as Row[]
      if (!parents.length) continue
      const spec = specOf(gspec.parentTable)!
      const groups = loadGroups(parentId, spec)
      let latestTs = Date.parse(parents[0][spec.tsColumn] as string)
      const tsCol = gspec.tsColumn
      if (tsCol) {
        for (const rows of Object.values(groups)) {
          for (const r of rows) {
            const v = Date.parse((r[tsCol] as string | undefined) ?? '')
            if (!Number.isNaN(v) && v > latestTs) latestTs = v
          }
        }
      }
      ops.push({
        t: gspec.parentTable,
        id: parentId,
        ts: new Date(latestTs).toISOString(),
        g: groups
      })
    }
  }

  // 墓碑 ops
  for (const t of tombRows) {
    ops.push({ t: t.entity_type, id: t.entity_id, ts: t.deleted_at, d: 1 })
  }

  if (!ops.length) return

  // 分批写 delta（UUID 文件名，每批 ≤200，图片映射只随首批携带）
  const BATCH = 200
  const uploadedNames: string[] = []
  for (let i = 0; i < ops.length; i += BATCH) {
    const slice = ops.slice(i, Math.min(i + BATCH, ops.length))
    const name = `${randomUUID()}.json`
    const ok = await remote.putDelta(
      name,
      { c: cid, at: new Date().toISOString(), ops: slice, img: i === 0 ? newImageMap : {} }
    )
    if (!ok) throw new Error('delta 上传失败')
    uploadedNames.push(name)
  }

  markPushed(tombRows)
  metaSet(K_PUSH_AFTER, syncStart)
  const merged = { ...getImageMap(), ...newImageMap }
  setImageMap(merged)
  for (const n of uploadedNames) appliedDeltas.add(n)
  setAppliedDeltas(appliedDeltas)
}

async function pushImage(
  ctx: MergeCtx,
  newImageMap: Record<string, string>,
  logical: string
): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(newImageMap, logical)) return
  const file = ctx.codec.localPathOf(logical)
  if (!fs.existsSync(file)) return
  const bytes = fs.readFileSync(file)
  const hash = sha256Hex(bytes)
  if (await ctx.remote.blobExists(hash)) {
    ctx.counters.dedupImages++
  } else {
    const ok = await ctx.remote.uploadBlob(hash, bytes)
    // 失败必须中止：否则 delta 引用远端不存在的 blob，水位推进后不再重发
    if (!ok) throw new Error('图片上传失败')
    ctx.counters.upImages++
  }
  newImageMap[logical] = hash
}

// ── 压实 ────────────────────────────────────────────────

async function compact(
  remote: IncRemote,
  codec: IncRowCodec,
  cid: string,
  deltaNames: string[]
): Promise<void> {
  const imageMap = getImageMap()
  const currentVersion = metaGetInt(K_MANIFEST_VERSION) ?? 1
  const newVersion = currentVersion + 1

  // 墓碑随 manifest 携带：合并上一版 manifest 与本地墓碑
  const prev = await remote.getManifest()
  const tombRows = allTombstones()
  const merged = new Map<string, TombstoneEntry>()
  for (const t of prev?.tombs ?? []) merged.set(`${t.t}|${t.id}`, t)
  for (const r of tombRows) {
    const e = tombEntryFromRow(r)
    merged.set(`${e.t}|${e.id}`, e)
  }

  const manifest = await buildManifestFromLocal({
    remote,
    codec,
    version: newVersion,
    clientId: cid,
    foldedDeltas: deltaNames,
    imageMap,
    tombstones: [...merged.values()]
  })
  if (!(await remote.putManifest(manifest))) return

  // 并发压实保护：版本已不是我们的版本则放弃删除
  const back = await remote.getManifest()
  if (!back || back.v !== newVersion) return

  clearEmbedded(tombRows)
  for (const name of deltaNames) await remote.deleteDelta(name)

  metaSet(K_MANIFEST_VERSION, String(newVersion))
  const seen = getSeenChunks()
  for (const list of Object.values(manifest.chunks)) for (const c of list) seen.add(c.h)
  setSeenChunks(seen)
  const applied = getAppliedDeltas()
  for (const n of deltaNames) applied.delete(n)
  setAppliedDeltas(applied)
}

// ── 恢复（以云端为准强制覆盖）与强制推送 ──────────────────

export async function incRestoreDownload(onProgress?: ProgressCb): Promise<IncSyncResult> {
  const cfg = getConfig()
  if (!cfg) return result({ success: false, message: '未配置 WebDAV' })
  if (syncing) return result({ success: false, message: '同步正在进行中，请稍后再试' })
  syncing = true
  const counters = new Counters()
  const syncStart = new Date().toISOString()
  const codec = new IncRowCodec(imagesRoot())

  try {
    const remote = await IncRemote.create(cfg)
    const manifest = await remote.getManifest()
    if (!manifest) return result({ success: false, message: '云端没有增量基线数据' })

    const imageMap = { ...getImageMap(), ...manifest.img }
    const localWins = new Set<string>()
    const seen = new Set<string>()
    let failedChunks = 0

    setForeignKeys(false)
    try {
      emit(onProgress, counters, 'pull-chunk', '正在从云端恢复快照…')
      for (const spec of ENTITIES) {
        for (const chunk of manifest.chunks[spec.table] ?? []) {
          const bytes = await remote.getBlob(chunk.h)
          if (!bytes) {
            failedChunks++
            continue
          }
          try {
            const obj = JSON.parse(bytes.toString('utf-8')) as { rows?: Row[]; g?: Record<string, Row[]> }
            const groupsBucket = bucketGroups(obj.g)
            for (const r of obj.rows ?? []) {
              await mergeUpsert(
                spec,
                r,
                manifest.c,
                (r[spec.tsColumn] as string | undefined) ?? null,
                groupsBucket.get(String(r.id)) ?? null,
                counters,
                localWins,
                codec,
                remote,
                imageMap,
                true,
                onProgress
              )
            }
            seen.add(chunk.h)
          } catch {
            failedChunks++
          }
        }
      }
      if (failedChunks > 0) {
        return result({
          success: false,
          message: `恢复中止：${failedChunks} 个数据分块拉取失败，请检查网络后重试`
        })
      }

      for (const t of manifest.tombs) {
        if (!specOf(t.t)) continue
        mergeDelete(t.t, t.id, t.ts, t.c, counters, localWins, true)
      }

      reconcile(manifest, counters)

      const names = await remote.listDeltaNames()
      if (names === null) return result({ success: false, message: '无法读取远程增量列表，同步中止' })
      const folded = new Set(manifest.folded)
      const applied = new Set<string>()
      let failedDeltas = 0
      for (const name of names) {
        if (folded.has(name)) continue
        const delta = await remote.getDelta(name)
        if (!delta) {
          failedDeltas++
          continue
        }
        Object.assign(imageMap, delta.img)
        for (const op of delta.ops) {
          const spec = specOf(op.t)
          if (!spec) continue
          if (op.d === 1) {
            mergeDelete(op.t, op.id, op.ts, delta.c, counters, localWins, true)
          } else if (op.row) {
            await mergeUpsert(
              spec,
              op.row,
              delta.c,
              op.ts,
              op.g ?? null,
              counters,
              localWins,
              codec,
              remote,
              imageMap,
              true,
              onProgress
            )
          } else if (op.g) {
            await mergeGroupsOnly(spec, op.id, op.ts, op.g, delta.c, counters, localWins, codec, remote, imageMap, onProgress)
          }
        }
        applied.add(name)
      }
      if (failedDeltas > 0) {
        return result({
          success: false,
          message: `恢复中止：${failedDeltas} 个增量文件拉取失败，请检查网络后重试`
        })
      }

      metaSet(K_MANIFEST_VERSION, String(manifest.v))
      setSeenChunks(seen)
      setAppliedDeltas(applied)
      setImageMap(imageMap)
      metaSet(K_LAST_SYNC, syncStart)
      if (metaGet(K_PUSH_AFTER) === null) metaSet(K_PUSH_AFTER, syncStart)
    } finally {
      setForeignKeys(true)
    }

    return result({
      success: true,
      message: counters.failedImages > 0 ? `恢复完成，但有 ${counters.failedImages} 张图片下载失败，再次执行恢复可重试` : '恢复完成',
      downloadedRecords: counters.downRecords,
      downloadedImages: counters.downImages,
      needReload: counters.downRecords > 0,
      manifestVersion: manifest.v
    })
  } catch (e) {
    return result({ success: false, message: `恢复失败: ${String(e)}` })
  } finally {
    syncing = false
  }
}

export async function incForcePush(onProgress?: ProgressCb): Promise<IncSyncResult> {
  const cfg = getConfig()
  if (!cfg) return result({ success: false, message: '未配置 WebDAV' })
  if (syncing) return result({ success: false, message: '同步正在进行中，请稍后再试' })
  syncing = true
  const syncStart = new Date().toISOString()
  const codec = new IncRowCodec(imagesRoot())

  try {
    const cid = clientId()
    const remote = await IncRemote.create(cfg)
    emit(onProgress, new Counters(), 'baseline', '正在以本机数据重建云端基线…')
    const prev = await remote.getManifest()
    const newVersion = (prev?.v ?? 0) + 1
    const tombRows = allTombstones()

    const built = await buildManifestFromLocal({
      remote,
      codec,
      version: newVersion,
      clientId: cid,
      foldedDeltas: [],
      imageMap: {},
      tombstones: tombRows.map(tombEntryFromRow)
    })
    if (!(await remote.putManifest(built))) return result({ success: false, message: '上传基线失败' })

    const names = await remote.listDeltaNames()
    if (names) for (const n of names) await remote.deleteDelta(n)

    clearEmbedded(tombRows)
    const imageCount = Object.keys(built.img).length
    const recordCount = Object.values(built.chunks)
      .flat()
      .reduce((a, c: ChunkIndex) => a + c.ids.length, 0)
    metaSet(K_MANIFEST_VERSION, String(newVersion))
    const seen = getSeenChunks()
    for (const list of Object.values(built.chunks)) for (const c of list) seen.add(c.h)
    setSeenChunks(seen)
    setAppliedDeltas(new Set())
    setImageMap(built.img)
    metaSet(K_PUSH_AFTER, syncStart)
    metaSet(K_LAST_SYNC, syncStart)

    return result({
      success: true,
      message: '推送完成',
      uploadedRecords: recordCount,
      uploadedImages: imageCount,
      manifestVersion: newVersion
    })
  } catch (e) {
    return result({ success: false, message: `推送失败: ${String(e)}` })
  } finally {
    syncing = false
  }
}
