import { prefs } from '../prefs'
import type { CloudOcrLine } from '../../shared/types'

// 云端 OCR：讯飞星辰 MaaS（OpenAI 兼容的视觉理解大模型）。
// 凭证与模型全部保存在本地 prefs，由用户在设置页填写；不内置任何密钥。
const TIMEOUT_MS = 60000
const DEFAULT_ENDPOINT = 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
const DEFAULT_MODEL = 'xoppaddleocrv16'

class CloudOcrError extends Error {}

function readPrefs(): { apiKey: string; endpoint: string; model: string } {
  const g = (k: string): string => String(prefs.get(k, '') ?? '').trim()
  return {
    apiKey: g('xfOcrApiKey'),
    endpoint: g('xfOcrEndpoint') || DEFAULT_ENDPOINT,
    model: g('xfOcrModel') || DEFAULT_MODEL
  }
}

export function getCloudConfig(): { configured: boolean; model: string } {
  const p = readPrefs()
  return { configured: !!p.apiKey, model: p.model }
}

const OCR_PROMPT = [
  '你是纯文字抄写机器（OCR），不是图像描述助手。唯一任务：把图片里【实际显示出来的文字】按原样逐字抄录下来。',
  '严格禁止：',
  '- 描述、概括、解说图片内容、界面布局、图标、功能或场景（不要写“左上角是…”“中间显示…”“底部有…”之类的话）；',
  '- 回答图片是什么或截图来自哪个应用；做任何分析、推测、补充、翻译或纠正错别字；',
  '- 输出标题、序号、引导语、引号、markdown 等原文中不存在的字符。',
  '必须做到：',
  '1) 只输出图片中真实存在的文字，与原文逐字完全一致；',
  '2) 按原始阅读顺序与换行输出，每个自然行单独占一行；',
  '3) 原样保留繁简体、数字、字母、标点、空格与特殊符号；',
  '4) 图片中确实没有任何文字时，只输出 NO_TEXT。'
].join('\n')

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  error?: { code?: string; message?: string }
  message?: string
}

async function chatWithImage(buf: Buffer): Promise<string> {
  const p = readPrefs()
  if (!p.apiKey) throw new CloudOcrError('未配置讯飞星辰 API Key')

  const dataUrl = 'data:image/png;base64,' + buf.toString('base64')
  const payload = JSON.stringify({
    model: p.model,
    stream: false,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p.apiKey}`
      },
      body: payload,
      signal: ctrl.signal
    })
    const j = (await resp.json()) as ChatResponse
    if (j.error) {
      throw new CloudOcrError(`讯飞 OCR 错误 ${j.error.code ?? ''}：${j.error.message ?? ''}`)
    }
    const content = j.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new CloudOcrError('讯飞 OCR 无有效响应：' + (j.message ?? '返回格式异常'))
    }
    return content
  } catch (e) {
    if (e instanceof CloudOcrError) throw e
    throw new CloudOcrError('网络请求失败：' + String(e))
  } finally {
    clearTimeout(timer)
  }
}

export async function recognizeCloud(buf: Buffer): Promise<CloudOcrLine[]> {
  const content = (await chatWithImage(buf)).trim()
  if (!content || content === 'NO_TEXT') return []
  // 模型偶尔会用代码块包裹，去掉包裹后按行拆分；逐字保留原文，不 trim 每一行（避免吞掉行首空格）
  let text = content.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '')
  text = text.replace(/\s+$/, '')
  return text.split(/\r?\n/).map((t) => ({ text: t, confidence: 1 }))
}

// 凭证测试：发一张 50x50 空白图（接口要求分辨率 50x50~6000x6000）做真实请求。
// 鉴权类错误 = Key 无效；无文字/限流等业务报错反而证明鉴权已通过。
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAAAAAA7VNdtAAAAI0lEQVR4nGP4TzJgGNUyqmVUy6iWUS2jWka1jGoZ1TLUtAAAaaW6xDUOEP0AAAAASUVORK5CYII=',
  'base64'
)
const AUTH_ERROR_HINTS = [
  'auth',
  'unauthorized',
  'invalid api key',
  'apikey',
  'api key',
  '401',
  '403',
  'token',
  '密钥',
  '凭证',
  '未配置',
  '网络请求失败',
  '无有效响应'
]

export async function testCloud(): Promise<{ ok: boolean; message: string }> {
  try {
    const content = await chatWithImage(TINY_PNG)
    void content
    return { ok: true, message: '连接成功，讯飞星辰 API Key 与模型有效' }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    const lower = msg.toLowerCase()
    const isAuth = AUTH_ERROR_HINTS.some((h) => lower.includes(h.toLowerCase()))
    if (isAuth) return { ok: false, message: msg }
    // 非鉴权错误（测试图太小、无文字、限流等）：请求已通过鉴权
    return { ok: true, message: '连接成功，密钥有效（接口返回：' + msg + '）' }
  }
}
