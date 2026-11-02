import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { LOCAL_ENGINES, type LocalEngineId, type LocalLanguage } from './engines'

// 引擎由用户手动下载解压后放进扫描目录，App 运行时自动发现（不随安装包分发）。
export type EngineStatusKind = 'ready' | 'incomplete' | 'missing'

export interface DiscoveredEngine {
  id: LocalEngineId
  label: string
  status: EngineStatusKind
  /** 引擎可执行文件绝对路径；missing 时为空串 */
  exePath: string
  /** 引擎目录（exe 所在目录）；missing 时为空串 */
  dir: string
  /** 解析出的可选语言；配置缺失或损坏时为空 */
  languages: LocalLanguage[]
  /** 状态说明（缺模型/配置解析失败等），可直接展示 */
  message: string
}

export interface EngineScanResult {
  /** 实际扫描的目录（绝对路径） */
  roots: string[]
  engines: Record<LocalEngineId, DiscoveredEngine>
}

function scanRoots(): string[] {
  const roots = [process.resourcesPath]
  if (!app.isPackaged) roots.unshift(path.join(app.getAppPath(), 'resources'))
  return [...new Set(roots.filter(Boolean))]
}

/** 用户放引擎的目录（设置页「打开引擎目录」用，开发态=项目 resources） */
export function primaryEngineDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// 在根目录下最多 3 层深度递归查找指定 exe 文件（用户可能多套一层版本目录）
async function findExe(root: string, exeName: string, depth = 0): Promise<string> {
  if (depth > 3) return ''
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return ''
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === exeName.toLowerCase()) {
      return path.join(root, e.name)
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = await findExe(path.join(root, e.name), exeName, depth + 1)
    if (hit) return hit
  }
  return ''
}

async function discoverEngine(id: LocalEngineId, roots: string[]): Promise<DiscoveredEngine> {
  const def = LOCAL_ENGINES[id]
  let exePath = ''
  for (const r of roots) {
    exePath = await findExe(r, def.exeName)
    if (exePath) break
  }
  if (!exePath) {
    return { id, label: def.label, status: 'missing', exePath: '', dir: '', languages: [], message: '未安装' }
  }
  const dir = path.dirname(exePath)
  const modelsDir = path.join(dir, 'models')
  if (!(await fileExists(modelsDir))) {
    return { id, label: def.label, status: 'incomplete', exePath, dir, languages: [], message: '缺少 models 目录' }
  }
  try {
    const languages = await def.parseLanguages(modelsDir)
    if (!languages.length) {
      return { id, label: def.label, status: 'incomplete', exePath, dir, languages: [], message: 'models/configs.txt 无可用语言' }
    }
    return { id, label: def.label, status: 'ready', exePath, dir, languages, message: '就绪' }
  } catch (e) {
    return {
      id,
      label: def.label,
      status: 'incomplete',
      exePath,
      dir,
      languages: [],
      message: '配置解析失败：' + String((e as Error)?.message ?? e)
    }
  }
}

let cache: EngineScanResult | null = null

/** 同步读取最近一次扫描缓存（未扫描过返回 null） */
export function getCachedScan(): EngineScanResult | null {
  return cache
}

export async function scanEngines(force = false): Promise<EngineScanResult> {
  if (cache && !force) return cache
  const roots = scanRoots()
  const [rapid, paddle] = await Promise.all([
    discoverEngine('rapid', roots),
    discoverEngine('paddle', roots)
  ])
  cache = { roots, engines: { rapid, paddle } }
  return cache
}
