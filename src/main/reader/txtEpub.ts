import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import iconv from 'iconv-lite'

// TXT 不在 foliate-js 直接支持的格式内，导入时按章节切分转换成 EPUB 3 再入库。
// 转换策略参考 anx-reader（lib/service/convert_to_epub）：多编码探测 + 默认章节正则 + 长文本兜底分卷。

export interface TxtBookInfo {
  title: string
  author: string | null
}

// 混入正文的典型乱码字（GBK 被误读为 Latin-1 等场景）；样本中占比超过阈值即判定乱码
const GARBLE_RE =
  /[ÕÊÇ³¾ÐÓÎÁÉÃÄÅÆËÌÍÏÒÔÖÙÚÛÜÝàáâãäåæèéêëìíîïðñòóôõöùúûüýÿ\ufffd\ufffe｡-ﾟ€]/g
const GARBLE_LIMIT = 20 / 500

function isGarbled(text: string): boolean {
  const sample = text.length > 500 ? text.slice(0, 500) : text
  if (!sample) return false
  return (sample.match(GARBLE_RE)?.length ?? 0) / sample.length > GARBLE_LIMIT
}

// 依次尝试 BOM → UTF-8 严格解码 → GBK → Big5 → UTF-16LE
function decodeTxt(buf: Buffer): string {
  // UTF-8 BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3))
  }
  // UTF-16 LE/BE BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // 非 UTF-8，走中文编码探测
  }

  for (const enc of ['gbk', 'big5'] as const) {
    const text = iconv.decode(buf, enc)
    if (!isGarbled(text)) return text
  }

  const utf16 = new TextDecoder('utf-16le').decode(buf)
  if (!isGarbled(utf16) && !utf16.includes('\u0000')) return utf16

  // 全部判定失败时仍以 GBK 兜底（由调用方决定是否继续）
  return iconv.decode(buf, 'gbk')
}

interface Section {
  title: string
  body: string
}

// 与 anx-reader 默认章节规则一致：第X章/第X卷、Chapter/Vol/Book，允许行首前缀与行尾副标题
const CHAPTER_RE =
  /^(?:(.+[ 　]+)|())(第[一二三四五六七八九十零〇百千万两0-9]+[章卷]|卷[一二三四五六七八九十零〇百千万两0-9]+|chap(?:ter)?\.?|vol(?:ume)?\.?|book|bk)(?:[ 　]+(?:\S.*)?)?[ 　]*$/gim

const CHUNK_SIZE = 20000

function buildSections(content: string, fallbackTitle: string): Section[] {
  const matches = [...content.matchAll(CHAPTER_RE)]
  const sections: Section[] = []

  if (matches.length) {
    const first = matches[0]!
    const intro = content.slice(0, first.index).trim()
    if (intro) sections.push({ title: '', body: intro })

    matches.forEach((m, i) => {
      const title: string = m[0].trim()
      const start = (m.index ?? 0) + m[0].length
      const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? content.length) : content.length
      const body = content.slice(start, end).trim()
      if (body || title) sections.push({ title, body })
    })
  } else if (content.length <= CHUNK_SIZE) {
    sections.push({ title: fallbackTitle, body: content.trim() })
  } else {
    // 无章节标识：按 2 万字切块，切点对齐到最近换行
    let start = 0
    while (start < content.length) {
      let end = start + CHUNK_SIZE
      if (end < content.length) {
        const nl = content.indexOf('\n', end)
        end = nl === -1 ? content.length : nl
      }
      sections.push({ title: `第 ${sections.length + 1} 节`, body: content.slice(start, end).trim() })
      start = end + 1
    }
  }

  return sections.filter((s) => s.body || s.title)
}

function escapeXml(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseNameInfo(fileName: string): TxtBookInfo {
  const base = path.basename(fileName, path.extname(fileName))
  const title = /《([^》]+)/.exec(base)?.[1]?.trim() || base
  const author = /作者[：:]\s*(.+?)\s*$/.exec(base)?.[1]?.trim() || null
  return { title, author }
}

function xhtmlPage(section: Section, bookTitle: string, index: number): string {
  const heading = section.title ? `    <h2>${escapeXml(section.title)}</h2>\n` : ''
  const paras = section.body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `    <p>${escapeXml(l)}</p>`)
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${escapeXml(section.title || bookTitle)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
${heading}${paras}
  </body>
</html>`
}

// 无标题分节（章节前的简介等）：取正文首行做目录名，超长截断
function sectionLabel(s: Section, index: number): string {
  if (s.title) return s.title
  const first = s.body
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (first) return first.length > 18 ? first.slice(0, 18) + '…' : first
  return `第 ${index + 1} 节`
}

function buildNcx(sections: Section[], title: string, uid: string): string {
  const points = sections
    .map((s, i) => {
      const label = escapeXml(sectionLabel(s, i))
      return `    <navPoint id="navPoint-${i}" playOrder="${i + 1}">
      <navLabel><text>${label}</text></navLabel>
      <content src="xhtml/${i}.xhtml"/>
    </navPoint>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uid}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`
}

function buildOpf(sections: Section[], title: string, author: string | null, uid: string): string {
  const manifest = sections
    .map((_, i) => `    <item id="item${i}" href="xhtml/${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spine = sections.map((_, i) => `    <itemref idref="item${i}"/>`).join('\n')
  const creator = author ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>` : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>${creator}
    <dc:identifier id="pub-id">urn:uuid:${uid}</dc:identifier>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`
}

const STYLE_CSS = `p { text-indent: 2em; margin: 0.5em 0; line-height: 1.8; }
h2 { text-align: center; margin: 1.2em 0; }
`

// 把 TXT 文件转换为 EPUB 写入 destPath（扩展名应为 .epub），返回书名/作者
export function convertTxtToEpub(txtPath: string, destPath: string): TxtBookInfo {
  const info = parseNameInfo(txtPath)
  const text = decodeTxt(fs.readFileSync(txtPath)).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const sections = buildSections(text, info.title)
  const uid = randomUUID()

  // noSort：保证 mimetype 保持为第一个条目（OCF 规范要求）
  const zip = new AdmZip({ noSort: true })
  // OCF 规范要求 mimetype 为第一个条目且不压缩
  zip.addFile('mimetype', Buffer.from('application/epub+zip'))
  const mimeEntry = zip.getEntry('mimetype')
  if (mimeEntry) mimeEntry.header.method = 0

  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  )
  zip.addFile('OEBPS/content.opf', Buffer.from(buildOpf(sections, info.title, info.author, uid)))
  zip.addFile('OEBPS/toc.ncx', Buffer.from(buildNcx(sections, info.title, uid)))
  zip.addFile('OEBPS/style.css', Buffer.from(STYLE_CSS))
  sections.forEach((s, i) => zip.addFile(`OEBPS/xhtml/${i}.xhtml`, Buffer.from(xhtmlPage(s, info.title, i))))

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  zip.writeZip(destPath)
  return info
}
