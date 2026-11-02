import fs from 'node:fs/promises'
import path from 'node:path'

// 本地 OCR 引擎适配层。
// RapidOCR-json 与 PaddleOCR-json（hiroi-sora 同系）管道 NDJSON 协议一致：
//   启动后 stdout 输出 "OCR init completed."；之后每行请求 {"image_base64":"..."}，
//   每行响应 {"code":100,"data":[{"text","score","box"}]}（101=图中无文字）。
// 差异只在「启动参数」和「语言配置文件格式」，收敛到下面两份描述里。

export type LocalEngineId = 'rapid' | 'paddle'

export interface LocalLanguage {
  /** 稳定标识：Rapid 用语言标题，Paddle 用 config_xxx 文件名 */
  key: string
  label: string
  /** 不透明负载：Rapid 为 det|cls|rec|keys，Paddle 为 config 文件名 */
  payload: string
}

export interface EngineRunOptions {
  language: LocalLanguage
  angle: boolean
  maxSideLen: number
}

export interface LocalEngineDef {
  id: LocalEngineId
  label: string
  exeName: string
  /** 解析模型目录，返回可选语言；读不到配置返回空数组 */
  parseLanguages: (modelsDir: string) => Promise<LocalLanguage[]>
  /** 根据语言/参数生成 exe 启动参数（cwd 为引擎目录，模型路径都相对 models/） */
  buildArgs: (opts: EngineRunOptions) => string[]
}

// ── RapidOCR-json：ONNX 单文件，逐命令行参数 ──────────────────
async function parseRapidLanguages(modelsDir: string): Promise<LocalLanguage[]> {
  const raw = await fs.readFile(path.join(modelsDir, 'configs.txt'), 'utf8')
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  // 每组 5 行：标题 / det / cls / rec / keys
  const out: LocalLanguage[] = []
  for (let i = 0; i + 4 < lines.length; i += 5) {
    const [label, det, cls, rec, keys] = lines.slice(i, i + 5)
    out.push({ key: label, label, payload: [det, cls, rec, keys].join('|') })
  }
  return out
}

// ── PaddleOCR-json：目录式模型，用 -config_path 整体切语言 ──────
async function parsePaddleLanguages(modelsDir: string): Promise<LocalLanguage[]> {
  const raw = await fs.readFile(path.join(modelsDir, 'configs.txt'), 'utf8')
  const out: LocalLanguage[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const sp = t.split(/\s+/)
    const file = sp[0]
    const label = sp.slice(1).join(' ') || file
    out.push({ key: file, label: label || file, payload: file })
  }
  return out
}

export const LOCAL_ENGINES: Record<LocalEngineId, LocalEngineDef> = {
  rapid: {
    id: 'rapid',
    label: 'RapidOCR-json',
    exeName: 'RapidOCR-json.exe',
    parseLanguages: parseRapidLanguages,
    buildArgs: ({ language, angle, maxSideLen }) => {
      const [det, cls, rec, keys] = language.payload.split('|')
      const args = [
        '--models=models',
        `--det=${det}`,
        `--cls=${cls}`,
        `--rec=${rec}`,
        `--keys=${keys}`,
        '--ensureAscii=1',
        `--doAngle=${angle ? 1 : 0}`,
        `--mostAngle=${angle ? 1 : 0}`,
        `--maxSideLen=${maxSideLen}`
      ]
      return args
    }
  },
  paddle: {
    id: 'paddle',
    label: 'PaddleOCR-json',
    exeName: 'PaddleOCR-json.exe',
    parseLanguages: parsePaddleLanguages,
    buildArgs: ({ language, angle, maxSideLen }) => {
      const args = [
        `-config_path=models/${language.payload}`,
        '-ensure_ascii=true',
        `-cls=${angle ? 'true' : 'false'}`,
        `-limit_side_len=${maxSideLen}`
      ]
      return args
    }
  }
}
