import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

// 本地个人笔记内容，仍经 DOMPurify 消毒，防止注入脚本/外链资源
export function renderMarkdown(md: string): string {
  if (!md) return ''
  const html = marked.parse(md, { async: false }) as string
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style']
  })
}

// 列表卡片用：剥离 markdown 符号后的纯文本摘要
export function plainPreview(md: string, max = 120): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_`#~-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}
