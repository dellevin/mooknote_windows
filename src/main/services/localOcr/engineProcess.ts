import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CloudOcrLine } from '../../../shared/types'
import { LOCAL_ENGINES, type EngineRunOptions, type LocalEngineId } from './engines'

// 常驻子进程：模型只加载一次，全程保持 stdin 开启（关流后两引擎都会持续刷错误码）。
// 一次只允许一个在途请求；引擎/语言/参数变化时销毁重拉。

const INIT_TIMEOUT_MS = 30000
const REQ_TIMEOUT_MS = 60000
const READY_TOKEN = 'OCR init completed.'

interface EngineResponse {
  code?: number
  data?: unknown
  msg?: string
}

interface ActiveProcess {
  signature: string
  proc: ChildProcessWithoutNullStreams
  ready: Promise<void>
  /** 读行循环把下一个 JSON 结果交给在途请求 */
  pending: ((r: EngineResponse) => void) | null
  rejecter: ((e: Error) => void) | null
}

let active: ActiveProcess | null = null
let chain: Promise<unknown> = Promise.resolve()

function killActive(): void {
  if (!active) return
  const a = active
  active = null
  a.rejecter?.(new Error('引擎已停止'))
  try {
    a.proc.kill()
  } catch {
    // ignore
  }
}

function signatureFor(id: LocalEngineId, opts: EngineRunOptions): string {
  return [id, opts.language.key, opts.angle ? 1 : 0, opts.maxSideLen].join('|')
}

async function start(id: LocalEngineId, opts: EngineRunOptions, exePath: string): Promise<ActiveProcess> {
  const def = LOCAL_ENGINES[id]
  const signature = signatureFor(id, opts)
  if (active && active.signature === signature) return active
  killActive()

  const args = def.buildArgs(opts)
  const proc = spawn(exePath, args, {
    cwd: path.dirname(exePath),
    windowsHide: true,
    // Paddle 初始化会往 stderr 打大量融合日志，不消费会撑满管道导致进程阻塞
    stdio: ['pipe', 'pipe', 'ignore']
  })

  let buffer = ''
  const instance: ActiveProcess = {
    signature,
    proc,
    pending: null,
    rejecter: null,
    ready: Promise.resolve()
  }
  let resolveReady: () => void = () => {}
  let rejectReady: (e: Error) => void = () => {}
  instance.ready = new Promise<void>((res, rej) => {
    resolveReady = res
    rejectReady = rej
  })
  let readyDone = false

  const onLine = (line: string): void => {
    const t = line.trim()
    if (!readyDone && t.includes(READY_TOKEN)) {
      readyDone = true
      resolveReady()
      return
    }
    if (!t.startsWith('{')) return // 版本横幅、Paddle 融合日志等
    let parsed: EngineResponse
    try {
      parsed = JSON.parse(t) as EngineResponse
    } catch {
      return
    }
    if (!readyDone) {
      // 个别情况下不发握手直接给结果：首条 JSON 也视作就绪
      readyDone = true
      resolveReady()
    }
    if (instance.pending) {
      const fn = instance.pending
      instance.pending = null
      instance.rejecter = null
      fn(parsed)
    }
  }

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      onLine(line)
    }
  })
  proc.on('error', (e) => {
    if (!readyDone) rejectReady(e)
    instance.rejecter?.(e)
  })
  proc.on('exit', () => {
    if (active === instance) active = null
    if (!readyDone) rejectReady(new Error('引擎进程启动后退出'))
    instance.rejecter?.(new Error('引擎进程已退出'))
  })

  active = instance
  return instance
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + '超时')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// 串行化：同一时刻只发一个识别请求
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

export interface LocalRecognizeRequest {
  buf: Buffer
  engineId: LocalEngineId
  exePath: string
  options: EngineRunOptions
}

export async function recognizeLocal(req: LocalRecognizeRequest): Promise<CloudOcrLine[]> {
  return runExclusive(async () => {
    const inst = await start(req.engineId, req.options, req.exePath)
    await withTimeout(inst.ready, INIT_TIMEOUT_MS, '引擎初始化')

    const payload = JSON.stringify({ image_base64: req.buf.toString('base64') }) + '\n'
    const reply = withTimeout<EngineResponse>(
      new Promise<EngineResponse>((resolve, reject) => {
        inst.pending = resolve
        inst.rejecter = reject
        inst.proc.stdin.write(payload)
      }),
      REQ_TIMEOUT_MS,
      'OCR 识别'
    )

    const r = await reply
    if (r.code === 101) return [] // 图中无文字
    if (r.code !== 100) {
      throw new Error(`本地 OCR 错误 ${r.code ?? ''}：${typeof r.data === 'string' ? r.data : r.msg ?? '未知错误'}`)
    }
    const rows = Array.isArray(r.data) ? (r.data as { text?: string }[]) : []
    return rows
      .map((x) => String(x.text ?? ''))
      .filter((t) => t.length > 0)
      .map((text) => ({ text, confidence: 1 }))
  })
}

export function stopLocalEngine(): void {
  killActive()
}
