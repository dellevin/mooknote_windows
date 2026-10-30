import { randomUUID } from 'node:crypto'
import { prefs } from '../../prefs'

// 同步客户端标识：每台设备一个稳定 UUID（prefs sync_client_id，与 Flutter 对齐）。
const KEY = 'sync_client_id'
let cached = ''

export function cachedClientId(): string {
  return cached
}

export function clientId(): string {
  if (cached) return cached
  let id = prefs.get<string>(KEY, '')
  if (!id) {
    id = randomUUID()
    prefs.set(KEY, id)
  }
  cached = id
  return id
}
