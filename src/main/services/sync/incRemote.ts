import crypto from 'node:crypto'
import {
  dirUrl,
  putVerified,
  sendAuthed,
  type WebDavConfig
} from '../webdavHttp'
import {
  decodeDelta,
  decodeManifest,
  encodeDelta,
  encodeManifest,
  type DeltaFile,
  type Manifest
} from './incProtocol'

// 增量同步 v2 远程文件操作（与 Flutter inc_remote.dart 一致）。所有数据在 <同步目录>/inc2/ 下：
//   inc2/manifest.json   全局快照清单
//   inc2/blobs/<sha256>  内容寻址块（记录 chunk / 图片）
//   inc2/delta/<uuid>.json
export class IncRemote {
  private constructor(private readonly cfg: WebDavConfig, readonly base: string) {}

  static async create(cfg: WebDavConfig): Promise<IncRemote> {
    const r = new IncRemote(cfg, `${dirUrl(cfg)}/inc2`)
    await r.ensureDirs()
    return r
  }

  /** 确保 inc2/、blobs/、delta/ 存在（201 创建 / 405 已存在均可用） */
  async ensureDirs(): Promise<void> {
    for (const url of [this.base, `${this.base}/blobs`, `${this.base}/delta`]) {
      await sendAuthed(this.cfg, 'MKCOL', url)
    }
  }

  private async ensureBlobDir(): Promise<void> {
    await sendAuthed(this.cfg, 'MKCOL', `${this.base}/blobs`)
  }

  private get manifestUrl(): string {
    return `${this.base}/manifest.json`
  }
  private blobUrl(hash: string): string {
    return `${this.base}/blobs/${hash}`
  }
  private deltaUrl(name: string): string {
    return `${this.base}/delta/${name}`
  }

  /** 防缓存：反代/CDN 可能缓存 GET/HEAD/PROPFIND 导致读到旧数据 */
  private noCache(url: string): string {
    return `${url}?_ts=${Date.now()}`
  }

  /** 404 → null（允许建首个基线）；其他失败抛异常，避免把网络故障误判为无基线而覆盖云端 */
  async getManifest(): Promise<Manifest | null> {
    const r = await sendAuthed(this.cfg, 'GET', this.noCache(this.manifestUrl))
    if (r.status === 404) return null
    if (r.status !== 200) throw new Error(`manifest 获取失败: HTTP ${r.status}`)
    try {
      return decodeManifest(JSON.parse(r.body.toString('utf-8')))
    } catch (e) {
      throw new Error(`manifest 解析失败: ${String(e)}`)
    }
  }

  async putManifest(manifest: Manifest): Promise<boolean> {
    const bytes = Buffer.from(JSON.stringify(encodeManifest(manifest)), 'utf-8')
    let ok = await putVerified(this.cfg, this.manifestUrl, bytes, 'application/json')
    if (!ok) {
      await this.ensureDirs()
      ok = await putVerified(this.cfg, this.manifestUrl, bytes, 'application/json')
    }
    return ok
  }

  /** 列出 delta 目录下所有 .json 文件名；请求失败返回 null，目录空/不存在返回 [] */
  async listDeltaNames(): Promise<string[] | null> {
    const hrefs = await this.propfindHrefs(`${this.base}/delta`)
    if (hrefs === null) return null
    const result: string[] = []
    for (const href of hrefs) {
      const m = /delta\/([^/]+\.json)$/.exec(href)
      if (m) result.push(m[1])
    }
    result.sort()
    return result
  }

  private async propfindHrefs(url: string): Promise<string[] | null> {
    let resp = await sendAuthed(this.cfg, 'PROPFIND', this.noCache(url), { headers: { Depth: '1' } })
    if (resp.status === 404 && url.endsWith('/delta')) {
      await sendAuthed(this.cfg, 'MKCOL', url)
      return []
    }
    if (resp.status !== 207) {
      // 部分 WAF 拒绝带 ?_ts 的 PROPFIND，去掉查询串重试一次
      const retry = await sendAuthed(this.cfg, 'PROPFIND', url, { headers: { Depth: '1' } })
      if (retry.status !== 207) return null
      resp = retry
    }
    const body = resp.body.toString('utf-8')
    const re = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/gi
    const out: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) {
      try {
        out.push(decodeURIComponent(m[1]))
      } catch {
        out.push(m[1])
      }
    }
    return out
  }

  async getDelta(name: string): Promise<DeltaFile | null> {
    const r = await sendAuthed(this.cfg, 'GET', this.noCache(this.deltaUrl(name)))
    if (r.status !== 200) return null
    try {
      return decodeDelta(JSON.parse(r.body.toString('utf-8')))
    } catch {
      return null
    }
  }

  async putDelta(name: string, delta: DeltaFile): Promise<boolean> {
    const bytes = Buffer.from(JSON.stringify(encodeDelta(delta)), 'utf-8')
    let ok = await putVerified(this.cfg, this.deltaUrl(name), bytes, 'application/json')
    if (!ok) {
      await sendAuthed(this.cfg, 'MKCOL', `${this.base}/delta`)
      ok = await putVerified(this.cfg, this.deltaUrl(name), bytes, 'application/json')
    }
    return ok
  }

  async blobExists(hash: string): Promise<boolean> {
    const r = await sendAuthed(this.cfg, 'HEAD', this.noCache(this.blobUrl(hash)))
    return r.status === 200
  }

  async getBlob(hash: string): Promise<Buffer | null> {
    const r = await sendAuthed(this.cfg, 'GET', this.noCache(this.blobUrl(hash)), { timeout: 120000 })
    if (r.status !== 200) return null
    return r.body
  }

  /** 内容寻址 blob 上传（已存在则跳过） */
  async putBlob(hash: string, bytes: Buffer): Promise<boolean> {
    if (await this.blobExists(hash)) return true
    return this.uploadBlob(hash, bytes)
  }

  /** blob 直接上传（调用方已确认远程不存在），失败补建父目录后重试一次 */
  async uploadBlob(hash: string, bytes: Buffer): Promise<boolean> {
    let ok = await putVerified(this.cfg, this.blobUrl(hash), bytes)
    if (!ok) {
      await this.ensureBlobDir()
      ok = await putVerified(this.cfg, this.blobUrl(hash), bytes)
    }
    return ok
  }

  async deleteDelta(name: string): Promise<void> {
    await sendAuthed(this.cfg, 'DELETE', this.deltaUrl(name))
  }
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}
