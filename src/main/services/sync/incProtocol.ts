// 增量同步 v2 线上数据结构（与 Flutter inc_protocol.dart 字节级一致）。
// 短键 JSON：v/at/c/folded/chunks/img/tombs 与 t/id/ts/d/row/g。

export type Row = Record<string, unknown>
export type GroupMap = Record<string, Row[]>

/** 增量同步单条操作 */
export interface DeltaOp {
  /** 表名 */
  t: string
  /** 行 id */
  id: string
  /** 该行 LWW 时间戳 */
  ts: string
  /** 删除（墓碑）op */
  d?: 1
  /** upsert 完整行（删除时省略） */
  row?: Row
  /** 随父行整组替换的子表行：子表名 → 行列表 */
  g?: GroupMap
}

export function encodeOp(op: DeltaOp): Record<string, unknown> {
  return {
    t: op.t,
    id: op.id,
    ts: op.ts,
    ...(op.d === 1 ? { d: 1 } : {}),
    ...(op.d !== 1 && op.row !== undefined ? { row: op.row } : {}),
    ...(op.d !== 1 && op.g && Object.keys(op.g).length ? { g: op.g } : {})
  }
}

export function decodeOp(j: Record<string, unknown>): DeltaOp {
  return {
    t: String(j['t']),
    id: String(j['id']),
    ts: String(j['ts']),
    d: j['d'] === 1 ? 1 : undefined,
    row: (j['row'] as Row) ?? undefined,
    g: decodeGroupMap(j['g'])
  }
}

function decodeGroupMap(v: unknown): GroupMap | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: GroupMap = {}
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    out[k] = (list as unknown[]).map((e) => ({ ...(e as Row) }))
  }
  return out
}

/** 增量包：一次本地变更的快照。UUID 命名、LWW 幂等可交换，无需序号。 */
export interface DeltaFile {
  c: string
  at: string
  ops: DeltaOp[]
  /** 图片映射：逻辑路径 → blob hash（仅首批携带） */
  img: Record<string, string>
}

export function encodeDelta(d: DeltaFile): Record<string, unknown> {
  return {
    c: d.c,
    at: d.at,
    ops: d.ops.map(encodeOp),
    ...(Object.keys(d.img).length ? { img: d.img } : {})
  }
}

export function decodeDelta(j: Record<string, unknown>): DeltaFile {
  return {
    c: String(j['c']),
    at: String(j['at']),
    ops: ((j['ops'] as unknown[]) ?? []).map((e) => decodeOp({ ...(e as Row) })),
    img: ((j['img'] as Record<string, unknown>) ?? {})
      ? Object.fromEntries(
          Object.entries((j['img'] as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])
        )
      : {}
  }
}

/** 记录分块索引项 */
export interface ChunkIndex {
  h: string
  ids: string[]
}

function decodeChunks(v: unknown): Record<string, ChunkIndex[]> {
  const out: Record<string, ChunkIndex[]> = {}
  const src = (v ?? {}) as Record<string, unknown>
  for (const [table, list] of Object.entries(src)) {
    out[table] = ((list as unknown[]) ?? []).map((e) => {
      const o = e as Record<string, unknown>
      return { h: String(o['h']), ids: ((o['ids'] as unknown[]) ?? []).map(String) }
    })
  }
  return out
}

/** 随 manifest 携带的墓碑 */
export interface TombstoneEntry {
  t: string
  id: string
  ts: string
  c: string
}

function decodeTombs(v: unknown): TombstoneEntry[] {
  return ((v as unknown[]) ?? []).map((e) => {
    const o = e as Record<string, unknown>
    return { t: String(o['t']), id: String(o['id']), ts: String(o['ts']), c: String(o['c'] ?? '') }
  })
}

/** 全局快照清单：压实后包含全量记录的分块索引 */
export interface Manifest {
  v: number
  at: string
  c: string
  folded: string[]
  chunks: Record<string, ChunkIndex[]>
  img: Record<string, string>
  tombs: TombstoneEntry[]
}

export function encodeManifest(m: Manifest): Record<string, unknown> {
  return {
    v: m.v,
    at: m.at,
    c: m.c,
    folded: m.folded,
    chunks: Object.fromEntries(
      Object.entries(m.chunks).map(([k, list]) => [k, list.map((c) => ({ h: c.h, ids: c.ids }))])
    ),
    img: m.img,
    ...(m.tombs.length
      ? { tombs: m.tombs.map((t) => ({ t: t.t, id: t.id, ts: t.ts, c: t.c })) }
      : {})
  }
}

export function decodeManifest(j: Record<string, unknown>): Manifest {
  return {
    v: Number(j['v']),
    at: String(j['at']),
    c: String(j['c']),
    folded: ((j['folded'] as unknown[]) ?? []).map(String),
    chunks: decodeChunks(j['chunks']),
    img: Object.fromEntries(
      Object.entries((j['img'] as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])
    ),
    tombs: decodeTombs(j['tombs'])
  }
}
