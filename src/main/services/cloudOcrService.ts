import { prefs } from '../prefs'
import type { CloudOcrLine } from '../../shared/types'

// 云端 OCR：支持多个提供方，由 prefs.ocrProvider 决定当前使用哪一个。
//  - xf：讯飞星辰 MaaS（OpenAI 兼容的视觉理解大模型）
//  - baidu：百度智能云 OCR（AK/SK 换 access_token，调 pp_ocr 通用文字识别）
// 凭证全部保存在本地 prefs，由用户在设置页填写；不内置任何密钥。
const TIMEOUT_MS = 60000
const DEFAULT_ENDPOINT = 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
const DEFAULT_MODEL = 'xoppaddleocrv16'

type Provider = 'xf' | 'baidu'

class CloudOcrError extends Error {}

function g(k: string): string {
  return String(prefs.get(k, '') ?? '').trim()
}

function activeProvider(): Provider {
  return g('ocrProvider') === 'baidu' ? 'baidu' : 'xf'
}

// ── 讯飞星辰 ────────────────────────────────────────────────
function readXfPrefs(): { apiKey: string; endpoint: string; model: string } {
  return {
    apiKey: g('xfOcrApiKey'),
    endpoint: g('xfOcrEndpoint') || DEFAULT_ENDPOINT,
    model: g('xfOcrModel') || DEFAULT_MODEL
  }
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
  const p = readXfPrefs()
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

async function recognizeXf(buf: Buffer): Promise<CloudOcrLine[]> {
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

async function testXf(): Promise<{ ok: boolean; message: string }> {
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

// ── 百度智能云 OCR ─────────────────────────────────────────
const BAIDU_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const BAIDU_OCR_BASE = 'https://aip.baidubce.com/rest/2.0/ocr/v1/'
const BAIDU_DEFAULT_ENDPOINT = 'general_basic'
// 允许的通用文字识别端点（含位置版额外返回坐标，这里同样只取文字）
const BAIDU_ENDPOINTS = new Set(['general_basic', 'general', 'accurate_basic', 'accurate'])

interface BaiduCreds {
  ak: string
  sk: string
  endpoint: string
}
function readBaiduPrefs(): BaiduCreds {
  const endpoint = g('baiduOcrEndpoint')
  return {
    ak: g('baiduOcrAk'),
    sk: g('baiduOcrSk'),
    endpoint: BAIDU_ENDPOINTS.has(endpoint) ? endpoint : BAIDU_DEFAULT_ENDPOINT
  }
}

// access_token 有效期 30 天，缓存到内存，过期前 60s 主动刷新
let tokenCache: { token: string; expireAt: number } | null = null

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function fetchBaiduToken(force = false): Promise<string> {
  const now = Date.now()
  if (!force && tokenCache && tokenCache.expireAt - 60_000 > now) {
    return tokenCache.token
  }
  const c = readBaiduPrefs()
  if (!c.ak || !c.sk) throw new CloudOcrError('未配置百度智能云 API Key / Secret Key')
  const url =
    BAIDU_TOKEN_URL +
    '?grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(c.ak) +
    '&client_secret=' + encodeURIComponent(c.sk)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { method: 'POST', signal: ctrl.signal })
    const j = (await resp.json()) as TokenResponse
    if (!j.access_token) {
      throw new CloudOcrError(
        `百度鉴权失败：${j.error ?? ''} ${j.error_description ?? '无法获取 access_token'}`.trim()
      )
    }
    tokenCache = {
      token: j.access_token,
      expireAt: now + (Number(j.expires_in) || 2592000) * 1000
    }
    return tokenCache.token
  } catch (e) {
    if (e instanceof CloudOcrError) throw e
    throw new CloudOcrError('百度鉴权网络请求失败：' + String(e))
  } finally {
    clearTimeout(timer)
  }
}

interface BaiduOcrResponse {
  words_result?: { words?: string }[]
  words_result_num?: number
  error_code?: number
  error_msg?: string
}

async function recognizeBaidu(buf: Buffer): Promise<CloudOcrLine[]> {
  const c = readBaiduPrefs()
  const doRequest = async (token: string): Promise<BaiduOcrResponse> => {
    const body = 'image=' + encodeURIComponent(buf.toString('base64'))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const resp = await fetch(
        `${BAIDU_OCR_BASE}${c.endpoint}?access_token=${encodeURIComponent(token)}`,
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body,
        signal: ctrl.signal
      })
      return (await resp.json()) as BaiduOcrResponse
    } finally {
      clearTimeout(timer)
    }
  }

  let token = await fetchBaiduToken()
  let j = await doRequest(token)
  // 110/111：token 失效/过期，强制刷新一次后重试
  if (j.error_code === 110 || j.error_code === 111) {
    token = await fetchBaiduToken(true)
    j = await doRequest(token)
  }
  if (typeof j.error_code === 'number') {
    throw new CloudOcrError(`百度 OCR 错误 ${j.error_code}：${j.error_msg ?? ''}`)
  }
  const rows = j.words_result ?? []
  return rows
    .map((r) => String(r.words ?? ''))
    .filter((t) => t.length > 0)
    .map((text) => ({ text, confidence: 1 }))
}

async function testBaidu(): Promise<{ ok: boolean; message: string }> {
  try {
    await fetchBaiduToken(true)
    return { ok: true, message: '连接成功，百度智能云 AK/SK 有效' }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

// ── 统一入口 ────────────────────────────────────────────────
export function getCloudConfig(): { configured: boolean; model: string; provider: Provider } {
  const provider = activeProvider()
  if (provider === 'baidu') {
    const c = readBaiduPrefs()
    return { configured: !!c.ak && !!c.sk, model: c.endpoint, provider }
  }
  const p = readXfPrefs()
  return { configured: !!p.apiKey, model: p.model, provider }
}

export async function recognizeCloud(buf: Buffer): Promise<CloudOcrLine[]> {
  return activeProvider() === 'baidu' ? recognizeBaidu(buf) : recognizeXf(buf)
}

export async function testCloud(): Promise<{ ok: boolean; message: string }> {
  return activeProvider() === 'baidu' ? testBaidu() : testXf()
}
