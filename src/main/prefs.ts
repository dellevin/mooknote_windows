import fs from 'node:fs'
import { prefsPath } from './paths'

// 轻量偏好存储，键名与 Flutter UserPrefs (SharedPreferences) 对齐，便于备份互通。
class PrefsStore {
  private cache: Record<string, unknown> = {}

  load(): void {
    try {
      const raw = fs.readFileSync(prefsPath(), 'utf-8')
      this.cache = JSON.parse(raw) ?? {}
    } catch {
      this.cache = {}
    }
  }

  private flush(): void {
    fs.writeFileSync(prefsPath(), JSON.stringify(this.cache, null, 2), 'utf-8')
  }

  get<T>(key: string, fallback: T): T {
    return key in this.cache ? (this.cache[key] as T) : fallback
  }

  set(key: string, value: unknown): void {
    this.cache[key] = value
    this.flush()
  }

  all(): Record<string, unknown> {
    return { ...this.cache }
  }

  // 恢复备份时整体替换（敏感键由调用方排除）
  replaceAll(values: Record<string, unknown>): void {
    this.cache = { ...values }
    this.flush()
  }
}

export const prefs = new PrefsStore()
