import { ipcMain, app, BrowserWindow, nativeTheme, systemPreferences, nativeImage, net } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { getDb } from '../db'
import { getDataRoot, dbPath, imagesRoot } from '../paths'
import { prefs } from '../prefs'
import {
  clearCacheData,
  cleanEmptyImageDirs,
  purgeSoftDeleted
} from '../services/maintenanceService'
import { pickImageFiles, importImage } from '../services/imageService'

// 友好的系统名称，如「Windows 11 x64」「macOS 14 arm64」「Linux x64」
function friendlyPlatform(): string {
  const arch = os.arch() === 'x64' ? 'x64' : os.arch()
  const release = os.release()
  if (process.platform === 'win32') {
    const build = Number(release.split('.')[2] ?? 0)
    // NT 10.0，内部版本号 >= 22000 为 Windows 11，其余为 Windows 10
    const name = build >= 22000 ? 'Windows 11' : build > 0 ? 'Windows 10' : 'Windows'
    return `${name} ${arch}`
  }
  if (process.platform === 'darwin') {
    const major = Number(release.split('.')[0] ?? 0)
    // Darwin 内核版本号换算 macOS 版本：20=11, 21=12, 22=13, 23=14, 24=15…
    const macVer = major >= 20 ? `macOS ${major - 9}` : 'macOS'
    return `${macVer} ${arch}`
  }
  return `Linux ${arch}`
}

export function registerIpc(): void {
  ipcMain.on('win:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('win:toggle-max', () => {
    const w = BrowserWindow.getFocusedWindow()
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('win:close', () => BrowserWindow.getFocusedWindow()?.close())
  ipcMain.on('win:toggle-devtools', () => {
    const wc = BrowserWindow.getFocusedWindow()?.webContents
    if (!wc) return
    // mode: 'detach' 让调试器以独立窗口弹出，而非停靠在应用窗口内
    wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' })
  })

  // 自定义窗口/任务栏图标：src 为 http(s)（开发态）或 file://（打包态）资源地址
  ipcMain.handle('win:set-icon', async (_e, src: string | null) => {
    const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!w) return false
    if (!src) {
      w.setIcon(nativeImage.createEmpty())
      return true
    }
    let buf: Buffer
    if (src.startsWith('data:')) {
      // data:image/png;base64,....
      const b64 = src.slice(src.indexOf(',') + 1)
      buf = Buffer.from(b64, 'base64')
    } else if (/^https?:\/\//.test(src)) {
      buf = Buffer.from(await (await net.fetch(src)).arrayBuffer())
    } else if (src.startsWith('file://')) {
      buf = fs.readFileSync(fileURLToPath(src))
    } else {
      buf = fs.readFileSync(src)
    }
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) throw new Error('无法解析该图标文件')
    w.setIcon(img)
    return true
  })

  // 外壳信息：材质支持、系统强调色、深浅色
  // getAccentColor 在部分版本返回 8 位（前导字节非颜色），统一取末 6 位 RRGGBB
  ipcMain.handle('win:shell-info', () => ({
    material: 'solid' as const,
    accent: '#' + systemPreferences.getAccentColor().slice(-6),
    dark: nativeTheme.shouldUseDarkColors
  }))

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataRoot: getDataRoot(),
    dbPath: dbPath(),
    imagesRoot: imagesRoot(),
    platform: friendlyPlatform()
  }))

  ipcMain.handle('db:tables', () => {
    const rows = getDb()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[]
    return rows.map((r) => r.name)
  })

  ipcMain.handle('db:count', (_e, table: string) => {
    // 表名来自内部白名单式校验：仅允许字母下划线
    if (!/^[a-z_]+$/.test(table)) throw new Error('非法表名')
    const row = getDb().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
      c: number
    }
    return row.c
  })

  // 在线查看表数据：返回列名、主键列与前 N 行
  ipcMain.handle(
    'db:rows',
    (
      _e,
      table: string,
      limit = 100,
      offset = 0,
      search?: { column: string; keyword: string }
    ) => {
    if (!/^[a-z_]+$/.test(table)) throw new Error('非法表名')
    const db = getDb()
    const max = Math.min(Math.max(Number(limit) || 100, 1), 500)
    const off = Math.max(Number(offset) || 0, 0)
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }[]
    const columns = info.map((c) => c.name)
    const primaryKeys = info.filter((c) => c.pk > 0).map((c) => c.name)
    // 按字段搜索：列名白名单校验后，CAST 成文本做 LIKE 模糊匹配
    let where = ''
    const params: unknown[] = []
    const kw = search?.keyword?.trim()
    if (kw && search.column && columns.includes(search.column)) {
      where = ' WHERE CAST("' + search.column + '" AS TEXT) LIKE ?'
      params.push(`%${kw}%`)
    }
    const orderBy = primaryKeys.length
      ? `ORDER BY ${primaryKeys.map((k) => `"${k}"`).join(', ')}`
      : 'ORDER BY rowid'
    const rows = db
      .prepare(`SELECT * FROM ${table}${where} ${orderBy} LIMIT ${max} OFFSET ${off}`)
      .all(...params) as Record<string, unknown>[]
    return {
      columns,
      primaryKeys,
      columnInfo: info.map((c) => ({
        name: c.name,
        type: c.type,
        notNull: c.notnull === 1,
        defaultValue: c.dflt_value,
        pk: c.pk
      })),
      rows,
      total: (
        db
          .prepare(`SELECT COUNT(*) AS c FROM ${table}${where}`)
          .get(...params) as { c: number }
      ).c
    }
  }
  )

  // 插入一行：字段名白名单校验，值以字符串传入（空串视为 NULL），SQLite 按列亲和性转换
  ipcMain.handle(
    'db:insert',
    (_e, table: string, values: Record<string, string | null>) => {
      if (!/^[a-z_]+$/.test(table)) throw new Error('非法表名')
      const db = getDb()
      const cols = Object.keys(values)
      if (!cols.length) throw new Error('没有字段')
      for (const c of cols) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)) throw new Error('非法字段名')
      }
      const colList = cols.map((c) => `"${c}"`).join(', ')
      const placeholders = cols.map(() => '?').join(', ')
      const stmt = db.prepare(
        `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`
      )
      const info = stmt.run(...cols.map((c) => values[c]))
      return info.changes
    }
  )

  // 按主键删除一行
  ipcMain.handle(
    'db:delete-row',
    (_e, table: string, pk: { name: string; value: unknown }[]) => {
      if (!/^[a-z_]+$/.test(table)) throw new Error('非法表名')
      if (!pk.length) throw new Error('该表没有主键，无法定位行')
      const db = getDb()
      const where = pk
        .map((k) => {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k.name)) throw new Error('非法主键名')
          return `${k.name} = ?`
        })
        .join(' AND ')
      const info = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(
        ...pk.map((k) => k.value)
      )
      return info.changes
    }
  )

  // 单元格更新（双击编辑），必须有主键
  ipcMain.handle(
    'db:update-cell',
    (
      _e,
      table: string,
      column: string,
      value: unknown,
      pk: { name: string; value: unknown }[]
    ) => {
      if (!/^[a-z_]+$/.test(table) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column))
        throw new Error('非法字段名')
      if (!pk.length) throw new Error('该表没有主键，无法定位行')
      const db = getDb()
      const where = pk
        .map((k) => {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k.name)) throw new Error('非法主键名')
          return `${k.name} = ?`
        })
        .join(' AND ')
      const stmt = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${where}`)
      const info = stmt.run(value, ...pk.map((k) => k.value))
      return info.changes
    }
  )

  // 执行任意 SQL：SELECT/PRAGMA 返回结果集，其余返回影响行数
  ipcMain.handle('db:exec', (_e, sql: string) => {
    const trimmed = sql.trim()
    if (!trimmed) throw new Error('SQL 为空')
    const lowered = trimmed.toLowerCase()
    const db = getDb()
    if (
      lowered.startsWith('select') ||
      lowered.startsWith('pragma') ||
      lowered.startsWith('with') ||
      lowered.startsWith('explain')
    ) {
      const rows = db.prepare(trimmed).all() as Record<string, unknown>[]
      return {
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows,
        changes: 0
      }
    }
    const info = db.prepare(trimmed).run()
    return { columns: [] as string[], rows: [] as Record<string, unknown>[], changes: info.changes }
  })

  ipcMain.handle('prefs:all', () => prefs.all())
  ipcMain.handle('prefs:get', (_e, key: string, fallback?: unknown) =>
    prefs.get(key, fallback)
  )
  ipcMain.handle('prefs:set', (_e, key: string, value: unknown) => {
    prefs.set(key, value)
    return true
  })

  // 个人资料头像：选择本地图片，复制进 images/avatar/profile/ 后存相对路径
  ipcMain.handle('profile:pick-avatar', async (): Promise<string | null> => {
    const files = await pickImageFiles(false)
    if (!files.length) return null
    return importImage('avatar', 'profile', files[0])
  })

  // 维护：清理缓存数据 / 清理空文件夹
  ipcMain.handle('maintenance:clear-cache', () => clearCacheData())
  ipcMain.handle('maintenance:clean-empty-dirs', () => cleanEmptyImageDirs())
  ipcMain.handle('maintenance:purge-deleted', () => purgeSoftDeleted())
}
