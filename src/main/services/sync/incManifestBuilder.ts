import fs from 'node:fs'
import { getDb } from '../../db'
import {
  GROUPS,
  ENTITIES,
  softDeleteGroupWhere,
  groupImageColumn,
  type IncEntitySpec
} from './incEntities'
import type { ChunkIndex, Manifest, Row, TombstoneEntry } from './incProtocol'
import { IncRowCodec, toLogical } from './incRowCodec'
import { IncRemote, sha256Hex } from './incRemote'

// manifest 构建：首次基线与 compaction 共用（与 Flutter inc_manifest_builder.dart 一致）。
const CHUNK_SIZE = 250

interface BuildOptions {
  remote: IncRemote
  codec: IncRowCodec
  version: number
  clientId: string
  foldedDeltas: string[]
  imageMap: Record<string, string>
  tombstones?: TombstoneEntry[]
}

export async function buildManifestFromLocal(opts: BuildOptions): Promise<Manifest> {
  const { remote, codec, version, clientId, foldedDeltas, imageMap } = opts
  const db = getDb()
  const chunks: Record<string, ChunkIndex[]> = {}
  const images: Record<string, string> = { ...imageMap }

  const ensureImage = async (logical: string): Promise<void> => {
    if (Object.prototype.hasOwnProperty.call(images, logical)) return
    const file = codec.localPathOf(logical)
    if (!fs.existsSync(file)) return
    const bytes = fs.readFileSync(file)
    const hash = sha256Hex(bytes)
    if (!(await remote.putBlob(hash, bytes))) {
      throw new Error(`图片上传失败: ${logical}`)
    }
    images[logical] = hash
  }

  for (const spec of ENTITIES) {
    const rows = db.prepare(`SELECT * FROM ${spec.table}`).all() as Row[]
    const index: ChunkIndex[] = []

    // 预取该实体全部子组行，按父 id 分桶
    const groupsByParent = new Map<string, Map<string, Row[]>>()
    for (const groupKey of Object.keys(spec.groups)) {
      const gspec = GROUPS.find((g) => g.table === groupKey)
      if (!gspec) continue
      const where = softDeleteGroupWhere(groupKey)
      const sql = where
        ? `SELECT * FROM ${groupKey} WHERE ${where}`
        : `SELECT * FROM ${groupKey}`
      const groupRows = db.prepare(sql).all() as Row[]
      for (const gr of groupRows) {
        const pid = String(gr[gspec.parentColumn])
        let byTable = groupsByParent.get(pid)
        if (!byTable) {
          byTable = new Map()
          groupsByParent.set(pid, byTable)
        }
        const list = byTable.get(groupKey) ?? []
        list.push(gr)
        byTable.set(groupKey, list)
      }
      // 子组行内图片（海报墙/截图/分集章节关卡配图）也要进基线 img 映射，
      // 否则重建基线后对端拿到子组行却下载不到图片
      const imgCol = groupImageColumn(groupKey)
      const jsonCol = gspec.imageJsonColumn
      for (const gr of groupRows) {
        if (imgCol) {
          const v = gr[imgCol]
          if (typeof v === 'string' && v) await ensureImage(toLogical(v))
        }
        if (jsonCol) {
          for (const l of codec.logicalFromJsonList(gr[jsonCol] as string | undefined)) {
            await ensureImage(l)
          }
        }
      }
    }

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const slice = rows.slice(i, Math.min(i + CHUNK_SIZE, rows.length))
      // 仅携带本分片父行的子组
      const sliceGroups: Record<string, Row[]> = {}
      for (const r of slice) {
        const g = groupsByParent.get(String(r['id']))
        if (!g) continue
        for (const [k, v] of g) {
          if (!sliceGroups[k]) sliceGroups[k] = []
          sliceGroups[k].push(...v)
        }
      }
      const obj: Record<string, unknown> = { t: spec.table, rows: slice }
      if (Object.keys(sliceGroups).length) obj.g = sliceGroups
      const blobBytes = Buffer.from(JSON.stringify(obj), 'utf-8')
      const hash = sha256Hex(blobBytes)
      // 上传失败必须中止：残缺 manifest 会让其他设备对账时误删正常数据
      if (!(await remote.putBlob(hash, blobBytes))) {
        throw new Error(`分块上传失败: ${spec.table} ${hash}`)
      }
      index.push({ h: hash, ids: slice.map((r) => String(r['id'])) })
    }
    chunks[spec.table] = index

    // 现场扫描图片（首建基线）
    for (const row of rows) {
      for (const logical of codec.referencedLogical(row, spec)) {
        await ensureImage(logical)
      }
    }
  }

  return {
    v: version,
    at: new Date().toISOString(),
    c: clientId,
    folded: foldedDeltas,
    chunks,
    img: images,
    tombs: opts.tombstones ?? []
  }
}

export type { IncEntitySpec }
