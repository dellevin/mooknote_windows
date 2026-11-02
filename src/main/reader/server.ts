import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'

// foliate-js 运行时需要以同源 HTTP 方式加载 ES 模块和电子书文件
// （直接 file:// 加载会被模块 CORS 与 zip worker 限制卡住），
// 这里在 127.0.0.1 随机端口起一个仅本机可访问的静态服务：
//   /reader.html                         宿主页面
//   /foliate/**                          foliate-js 运行时（对应原 src/）
//   /foliate-js/src/**                  book.js 里写死的 prism 路径别名
//   /book/<token>/<encodeURIComponent(文件名)>  书架中的电子书
let server: http.Server | null = null
let port = 0

// token -> 磁盘绝对路径。书库文件路径不直接出现在 URL 里。
const bookTokens = new Map<string, string>()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

export function readerAssetsDir(): string {
  // 打包后 extraResources 把 resources/reader 放到 resourcesPath/reader；
  // 开发态主进程构建产物在 out/main，上两级即项目根。
  return app.isPackaged
    ? path.join(process.resourcesPath, 'reader')
    : path.join(__dirname, '../../resources/reader')
}

// 把书库文件登记成一次性 token，返回可在 foliate-js 中 fetch 的 URL。
// 路径末尾保留真实文件名：book.js 用 URL.pathname 构造 File，扩展名决定格式解析器。
export function registerBookFile(filePath: string): string {
  const token = randomUUID()
  bookTokens.set(token, filePath)
  const name = encodeURIComponent(path.basename(filePath))
  return `http://127.0.0.1:${port}/book/${token}/${name}`
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(filePath).pipe(res)
}

function resolveStatic(urlPath: string): string | null {
  // 去掉锚点/查询，归一化并阻止路径穿越
  let p = decodeURIComponent(urlPath.split('?')[0] ?? '')
  const root = readerAssetsDir()

  let rel: string | null = null
  if (p === '/' || p === '/reader.html') rel = 'reader.html'
  else if (p === '/reader-app.js') rel = 'reader-app.js'
  else if (p.startsWith('/foliate/')) rel = path.join('foliate', p.slice('/foliate/'.length))
  else if (p.startsWith('/foliate-js/src/'))
    rel = path.join('foliate', p.slice('/foliate-js/src/'.length))

  if (!rel) return null
  const full = path.normalize(path.join(root, rel))
  if (!full.startsWith(path.normalize(root) + path.sep) && full !== path.normalize(root)) {
    return null
  }
  return full
}

export function startReaderServer(): Promise<number> {
  if (server) return Promise.resolve(port)
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const urlPath = req.url ?? '/'

        const bookMatch = urlPath.match(/^\/book\/([^/]+)\//)
        if (bookMatch) {
          const filePath = bookTokens.get(bookMatch[1] ?? '')
          if (!filePath || !fs.existsSync(filePath)) {
            res.statusCode = 404
            res.end('Book Not Found')
            return
          }
          // foliate-js 先整文件 fetch 为 Blob 再解析，统一给 application/epub+zip
          res.setHeader('Content-Type', 'application/epub+zip')
          res.setHeader('Access-Control-Allow-Origin', '*')
          fs.createReadStream(filePath).pipe(res)
          return
        }

        const staticFile = resolveStatic(urlPath)
        if (staticFile) {
          sendFile(res, staticFile)
          return
        }

        res.statusCode = 404
        res.end('Not Found')
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      if (addr && typeof addr === 'object') {
        port = addr.port
        resolve(port)
      } else {
        reject(new Error('reader server address unavailable'))
      }
    })
  })
}
