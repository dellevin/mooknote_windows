import type Vditor from 'vditor'

/*
 * Notion 风格块行为（Vditor wysiwyg 适配层）
 *  - 悬停/光标所在块左缘显示 ＋（下方插入空块）与 ⠿（点击菜单 / 长按拖拽排序）
 *  - 输入 / 弹出命令面板
 * 所有块操作都直接改 contenteditable DOM 再派发 input，Vditor 会重新同步 Markdown
 * （该机制已用真实 Electron 实例逐项验证）。
 */

interface SlashItem {
  title: string
  keywords: string
  icon: string
  snippet?: string
  hr?: boolean
}

// 模块级：切换笔记时编辑器组件按 :key 整体销毁重建，实例内的高度记忆会丢。
// 键 = 语言 + 代码长度 + FNV-1a 指纹，值 = 用户拖出的块高度（px）。
const codeHeightStore = new Map<string, number>()
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Lucide 风格线性图标（24x24，stroke=currentColor）
const ICONS = {
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  h1: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>',
  h2: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-8c0-3.5 8-4 8-9a3.5 3.5 0 0 0-7 0"/>',
  h3: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 8a3 3 0 1 1 4 3 3 3 0 0 0-4 3h5"/>',
  ul: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  ol: '<path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  todo: '<rect width="14" height="14" x="3" y="3" rx="2"/><path d="m7.5 10.5 2 2 4-4.5"/>',
  quote:
    '<path d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6c0 4-2 5-4 5"/><path d="M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6c0 4-2 5-4 5"/>',
  divider: '<path d="M4 12h16"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  table:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  math: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
  footnote:
    '<path d="M3 6v12"/><path d="M3 6h7"/><path d="M3 10h7"/><path d="M10 18v-8"/><path d="M14 8h.01"/><path d="M18.5 8v.01"/><path d="M14.5 12c1.5-2 4-2.5 4.5-.5s-3 2-3 4.5h3.5"/>'
}

const SLASH_ITEMS: SlashItem[] = [
  { title: '正文文本', keywords: 'text zhengwen 文本 段落', icon: ICONS.text, snippet: '' },
  { title: '标题 1', keywords: 'h1 heading biaoti 标题', icon: ICONS.h1, snippet: '# ' },
  { title: '标题 2', keywords: 'h2 heading biaoti 标题', icon: ICONS.h2, snippet: '## ' },
  { title: '标题 3', keywords: 'h3 heading biaoti 标题', icon: ICONS.h3, snippet: '### ' },
  { title: '无序列表', keywords: 'ul list liebiao 列表 无序', icon: ICONS.ul, snippet: '- ' },
  { title: '有序列表', keywords: 'ol list liebiao 列表 有序', icon: ICONS.ol, snippet: '1. ' },
  { title: '待办事项', keywords: 'todo task daiban 待办 任务 勾选', icon: ICONS.todo, snippet: '- [ ] ' },
  { title: '引用', keywords: 'quote blockquote yinyong 引用', icon: ICONS.quote, snippet: '> ' },
  { title: '分割线', keywords: 'divider hr fenge 分割线', icon: ICONS.divider, hr: true },
  { title: '代码块', keywords: 'code daima 代码', icon: ICONS.code, snippet: '```\n' },
  { title: '表格', keywords: 'table biaoge 表格', icon: ICONS.table, snippet: '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n' },
  { title: '公式块', keywords: 'math latex gongshi 公式', icon: ICONS.math, snippet: '$$\n' },
  { title: '脚注', keywords: 'footnote fn jiaozhu 脚注', icon: ICONS.footnote, snippet: '[^1] ' }
]

const STYLE_ID = 'mook-block-behavior-style'
const CSS = `
.mb-handles{position:fixed;z-index:1200;display:flex;align-items:flex-start;gap:2px;pointer-events:none;}
.mb-handles button{width:20px;height:26px;border:none;background:transparent;color:#9aa0ac;padding:0;cursor:pointer;border-radius:5px;display:flex;align-items:center;justify-content:center;pointer-events:auto;opacity:.6;}
.mb-handles button:hover{background:#eef0f4;color:#2f3540;opacity:1;}
.mb-handles button svg{width:17px;height:17px;display:block;}
.mb-handles button{transition:background .12s ease,color .12s ease,opacity .12s ease,transform .12s ease;}
body.mb-dragging .mb-handles button:last-child{opacity:1;background:#eaf2ff;color:#3468f6;transform:scale(1.16);}
.mb-menu{position:fixed;z-index:1300;min-width:132px;background:var(--surface);border:1px solid #e6e8ee;border-radius:8px;box-shadow:0 6px 22px rgba(31,38,52,.14);padding:4px;transform-origin:top left;animation:mb-pop-in .14s cubic-bezier(.2,.9,.25,1.15) both;}
.mb-menu.closing,.mb-slash.closing{animation:mb-fade-out .12s ease both;pointer-events:none;}
.mb-menu-item{padding:6px 10px;font-size:13px;color:#3a4050;border-radius:5px;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease;}
.mb-menu-item:hover{background:#f2f4f8;}
.mb-menu-item.danger{color:#e0483d;}
.mb-menu-item.danger:hover{background:#fdeceb;}
.mb-slash{position:fixed;z-index:1300;width:212px;max-height:264px;overflow-y:auto;background:var(--surface);border:1px solid #e6e8ee;border-radius:8px;box-shadow:0 6px 22px rgba(31,38,52,.14);padding:4px;transform-origin:top left;animation:mb-pop-in .14s cubic-bezier(.2,.9,.25,1.15) both;}
.mb-slash-item{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:13px;color:#3a4050;border-radius:5px;cursor:pointer;white-space:nowrap;transition:background .12s ease;}
.mb-slash-item .mb-ico{width:24px;height:24px;flex:0 0 24px;border:1px solid #e7e9f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#6b7280;background:#fafbfc;}
.mb-slash-item .mb-ico svg{width:15px;height:15px;display:block;}
.mb-slash-item.active .mb-ico,.mb-slash-item:hover .mb-ico{color:#3468f6;border-color:#cdddff;background:var(--surface);}
.mb-slash-item.active,.mb-slash-item:hover{background:#eef3ff;}
.mb-slash-empty{padding:10px;font-size:12px;color:#9aa0ac;}
body.mb-dragging{cursor:grabbing !important;-webkit-user-select:none;user-select:none;}
.mb-source-block{opacity:.32 !important;transition:opacity .14s ease;}
.mb-reordering{transition:transform .2s cubic-bezier(.2,.8,.2,1) !important;will-change:transform;}
.mb-ghost{position:fixed;z-index:1400;pointer-events:none;opacity:.5;background:#eaf2ff;border:1px solid #7aa2f7;border-radius:6px;transition:left .08s ease,top .08s ease,width .12s ease;animation:mb-ghost-in .14s ease both;}
.mb-indicator{position:fixed;z-index:1400;pointer-events:none;height:3px;background:#3468f6;border-radius:2px;left:0;right:0;opacity:0;transform:scaleX(.4);transition:top .12s cubic-bezier(.2,.8,.2,1),opacity .12s ease,transform .12s ease;}
.mb-indicator.show{opacity:1;transform:scaleX(1);}
/* 代码块语言选择 */
.mb-lang-chip{position:fixed;z-index:1200;display:none;align-items:center;gap:5px;height:23px;padding:0 7px 0 5px;font:inherit;font-size:12px;font-weight:500;color:#5b6472;background:rgba(255,255,255,.92);border:1px solid #e3e6ee;border-radius:6px;cursor:pointer;box-shadow:0 1px 3px rgba(31,38,52,.08);backdrop-filter:blur(3px);transition:background .12s ease,border-color .12s ease,color .12s ease;}
.mb-lang-chip:hover{background:var(--surface);border-color:#cdddff;color:#3468f6;}
.mb-lang-chip .mb-lang-caret{width:9px;height:9px;opacity:.55;flex:0 0 auto;}
.mb-lang-chip .mb-lang-badge{width:16px;height:16px;flex:0 0 16px;font-size:8px;border-radius:4px;}
.mb-lang-panel{position:fixed;z-index:1300;display:none;width:248px;background:var(--surface);border:1px solid #e6e8ee;border-radius:10px;box-shadow:0 10px 32px rgba(31,38,52,.16);padding:6px;transform-origin:top right;animation:mb-pop-in .14s cubic-bezier(.2,.9,.25,1.15) both;}
.mb-lang-panel.closing{animation:mb-fade-out .12s ease both;pointer-events:none;}
.mb-lang-search{width:100%;box-sizing:border-box;height:30px;border:1px solid #e3e6ee;border-radius:7px;padding:0 10px;font:inherit;font-size:13px;color:#2f3540;outline:none;margin-bottom:5px;}
.mb-lang-search:focus{border-color:#9db9fb;box-shadow:0 0 0 3px rgba(52,104,246,.12);}
.mb-lang-list{max-height:236px;overflow-y:auto;margin:0;padding:0;list-style:none;}
.mb-lang-opt{display:flex;align-items:center;gap:9px;padding:6px 9px;font-size:13px;color:#3a4050;border-radius:6px;cursor:pointer;white-space:nowrap;}
.mb-lang-opt.active,.mb-lang-opt:hover{background:#eef3ff;}
.mb-lang-badge{flex:0 0 22px;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;letter-spacing:-.3px;}
.mb-lang-opt .mb-lang-name{flex:1;overflow:hidden;text-overflow:ellipsis;}
.mb-lang-opt .mb-lang-check{width:13px;height:13px;color:#3468f6;opacity:0;flex:0 0 auto;}
.mb-lang-opt[aria-selected="true"] .mb-lang-check{opacity:1;}
.mb-lang-empty{padding:10px;font-size:12px;color:#9aa0ac;}
/* 固定高度代码块：内容超出在块内滚动，拖动底部横条可改高度。
   显示态由预览 pre 自身滚动；编辑态源码 pre 滚动，预览 pre 绝对定位铺满、
   内容按滚动量 transform 平移，两层视口永远一致。
   左右各留 16px，不占满整行；底部预留 9px 给拖拽条。 */
.vditor-wysiwyg__block[data-type='code-block']{
  height:var(--mb-code-h, 220px);min-height:96px;margin:0 16px 14px;
  resize:none;overflow:hidden;position:relative;
  border:1px solid #e3e6ee;border-radius:10px;background:#fafbfc;
  box-sizing:border-box;
}
.vditor-wysiwyg__block[data-type='code-block']:hover{border-color:#cdd5e4;}
.vditor-wysiwyg__block[data-type='code-block'] > pre{
  margin:0 !important;height:calc(100% - 9px);box-sizing:border-box;overflow:auto;
  /* 代码与边框之间的内边距；两层 pre 同值，保证源码层与高亮层像素对齐 */
  padding:12px 14px;
  /* 仍可滚动（滚轮/触控板），但不显示滚动条；两层 pre 同规则保证宽度一致，
     超长行折行点相同，不会行数发散。 */
  scrollbar-width:none;-ms-overflow-style:none;
}
.vditor-wysiwyg__block[data-type='code-block'] > pre::-webkit-scrollbar{
  width:0;height:0;display:none;
}
/* 显示态：高亮预览铺满块并作为滚动容器 */
.vditor-wysiwyg__block[data-type='code-block'] > pre.vditor-wysiwyg__preview{
  display:block;min-height:0;cursor:text;
}
/* 底部整条拖拽调高（替代浏览器右下角 resize 角） */
.mb-code-resizer{
  position:absolute;left:0;right:0;bottom:0;height:9px;z-index:6;
  cursor:row-resize;display:flex;align-items:flex-end;justify-content:center;
}
.mb-code-resizer:before{
  content:'';width:44px;height:3px;border-radius:2px;margin-bottom:3px;
  background:#c3cad8;opacity:0;transition:opacity .15s;
}
.vditor-wysiwyg__block[data-type='code-block']:hover .mb-code-resizer:before,
.mb-code-resizing .mb-code-resizer:before{opacity:1;}
/* 编辑态叠加布局 */
.vditor-wysiwyg__block.mb-code-editing > pre.vditor-wysiwyg__preview{
  position:absolute;left:0;right:0;top:0;bottom:9px;height:auto;overflow:hidden !important;
  pointer-events:none;background:transparent !important;cursor:default;
}
.vditor-wysiwyg__block.mb-code-editing > pre.vditor-wysiwyg__preview code{
  transform:translate(calc(var(--mb-sx,0) * -1px), calc(var(--mb-sy,0) * -1px));
}
.vditor-wysiwyg__block.mb-code-editing > pre.vditor-wysiwyg__pre{
  display:block !important;position:relative;z-index:1;
  background:transparent !important;
}
/* 源码层：文字透明只留光标；去掉 vditor 给 code 的内联代码底色/字色，
   否则会看到一份灰色底的黑字压在高亮层上 */
.vditor-wysiwyg__block.mb-code-editing > pre.vditor-wysiwyg__pre code{
  color:transparent !important;background:transparent !important;caret-color:#2f3540;
}
/* hljs 主题（github.css 的 .hljs{padding:.85em 1em}）会让预览层多一圈内边距，
   两层必须对齐到像素，统一清零。 */
.vditor-wysiwyg__block[data-type='code-block'] pre code{padding:0 !important;}
/* 两层统一不折行、横向滚动：hljs 会把超长 URL 包成单个 string span，
   pre-wrap/break-word 对嵌套 span 的长无空格 token 在 Chromium 不断行，
   而纯文本源码层会断，导致两层行数发散、底部内容像被截断。
   改用代码编辑器惯例 white-space:pre，长行横向滚动，sx/sy 同步平移预览层。 */
.vditor-wysiwyg__block[data-type='code-block'] pre,
.vditor-wysiwyg__block[data-type='code-block'] pre code{
  white-space:pre !important;overflow-wrap:normal !important;word-break:normal !important;
}
/* hljs github 主题给 .hljs 设了 overflow-x:auto，vditor reset 也给 pre>code
   设了 overflow:auto——会形成 code 内层与 pre 外层双重横向滚动（编辑态表现为
   外层左右拖不动，长行在 code 内部自行滚动）。交给 pre 统一滚动，code 不裁不滚。 */
.vditor-wysiwyg__block[data-type='code-block'] pre code{overflow:visible !important;}
.vditor-wysiwyg__block.mb-code-editing > pre.vditor-wysiwyg__pre ::selection{background:rgba(52,104,246,.18);}
@keyframes mb-pop-in{from{opacity:0;transform:translateY(-4px) scale(.97);}to{opacity:1;transform:translateY(0) scale(1);}}
@keyframes mb-fade-out{from{opacity:1;transform:translateY(0) scale(1);}to{opacity:0;transform:translateY(-4px) scale(.98);}}
@keyframes mb-ghost-in{from{opacity:0;transform:scale(.98);}to{opacity:.5;transform:scale(1);}}
`

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const st = document.createElement('style')
  st.id = STYLE_ID
  st.textContent = CSS
  document.head.appendChild(st)
}

const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg>'
const DRAG_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="5" r="2.1"/><circle cx="18" cy="5" r="2.1"/><circle cx="6" cy="12" r="2.1"/><circle cx="18" cy="12" r="2.1"/><circle cx="6" cy="19" r="2.1"/><circle cx="18" cy="19" r="2.1"/></svg>'

export function mountBlockBehavior(vd: Vditor, host: HTMLElement): () => void {
  injectStyle()

  const getPre = (): HTMLPreElement | null =>
    host.querySelector('.vditor-wysiwyg pre.vditor-reset')

  /* ---------- 通用工具 ---------- */

  function topBlock(node: Node | null): HTMLElement | null {
    const pre = getPre()
    if (!pre || !node) return null
    let el: HTMLElement | null = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement
    while (el && el.parentElement && !el.parentElement.isSameNode(pre)) {
      el = el.parentElement
    }
    if (!el || !el.parentElement || !el.parentElement.isSameNode(pre)) return null
    return el
  }

  function fireInput(): void {
    getPre()?.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function newParagraph(): HTMLParagraphElement {
    const p = document.createElement('p')
    p.appendChild(document.createElement('br'))
    return p
  }

  function caretInto(el: HTMLElement, atStart = true): void {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(atStart)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    vd.focus()
  }

  function insertBlock(reference: HTMLElement, where: 'before' | 'after'): HTMLElement {
    const p = newParagraph()
    reference.insertAdjacentElement(where === 'before' ? 'beforebegin' : 'afterend', p)
    caretInto(p, true)
    return p
  }

  /* ---------- 块手柄 ---------- */

  const handles = document.createElement('div')
  handles.className = 'mb-handles'
  const plusBtn = document.createElement('button')
  plusBtn.type = 'button'
  plusBtn.title = '在下方插入块'
  plusBtn.innerHTML = PLUS_SVG
  const dragBtn = document.createElement('button')
  dragBtn.type = 'button'
  dragBtn.title = '点击打开菜单，按住拖动排序'
  dragBtn.innerHTML = DRAG_SVG
  handles.append(plusBtn, dragBtn)
  document.body.appendChild(handles)

  let activeBlock: HTMLElement | null = null

  function positionHandles(): void {
    const b = activeBlock
    if (!b || !b.isConnected) {
      handles.style.display = 'none'
      return
    }
    const pre = getPre()
    if (!pre) return
    const rect = b.getBoundingClientRect()
    const preRect = pre.getBoundingClientRect()
    if (rect.bottom < preRect.top - 4 || rect.top > preRect.bottom + 4) {
      handles.style.display = 'none'
      return
    }
    handles.style.display = 'flex'
    handles.style.top = `${Math.round(rect.top + 1)}px`
    handles.style.left = `${Math.round(preRect.left - 46)}px`
  }

  function schedulePosition(): void {
    positionHandles()
    syncCodeEditing()
    syncLangChip()
    // 面板都是 fixed 定位，编辑器/页面滚动时也要跟着走
    if (slashOpen) positionSlash()
    if (langOpen) positionLangPanel()
  }

  function setBlock(el: HTMLElement | null): void {
    if (el === activeBlock) return
    activeBlock = el
    schedulePosition()
  }

  function blockFromCaret(): HTMLElement | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
    const pre = getPre()
    if (!pre || !pre.contains(sel.anchorNode)) return null
    return topBlock(sel.anchorNode)
  }

  let mouseInside = false

  function onMouseMove(e: MouseEvent): void {
    mouseInside = true
    const pre = getPre()
    if (!pre || !pre.contains(e.target as Node)) return
    if (slashOpen || langOpen) return
    // 光标正在某个代码块内编辑时（如刚从语言面板选完语言），锚点必须钉在
    // 光标所在块上；否则鼠标划过其它块会把语言角标/面板“带跑”。
    const caretBlock = blockFromCaret()
    if (codeBlockOf(caretBlock)) return
    const b = topBlock(e.target as Node)
    if (b) setBlock(b)
  }

  function onHostMouseDown(): void {
    mouseInside = true
  }

  function onPressCancelMove(e: PointerEvent): void {
    if (pressTimer && Math.hypot(e.clientX - pendingX, e.clientY - pendingY) > 5) clearPress()
  }

  function onSelectionChange(): void {
    const b = blockFromCaret()
    if (b) setBlock(b)
    else if (!mouseInside) setBlock(null)
    // 同一块内从预览 pre 进入源码 pre 时 activeBlock 不变，编辑态要单独刷新
    syncCodeEditing()
  }

  /* 首次点进代码块时，Vditor 的 showCode 无视点击位置，固定把光标放到代码
     第一行开头（所见即所得下表现为“点第 N 行却在编辑第 1 行/上一行”）。
     此监听在 Vditor 自身 click 处理之后（冒泡到 host 更晚）执行：
     先让叠加编辑态 class 立即生效（MutationObserver 的微任务在整个事件
     派发结束后才跑，此刻布局还是源码/预览上下排列，必须手动同步一次），
     再用点击坐标在源码 pre 上做命中测试，把光标挪到用户真正点的位置。 */
  function onCodeBlockClick(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const preview = target.closest
      ? (target.closest('pre.vditor-wysiwyg__preview') as HTMLElement | null)
      : null
    if (!preview) return
    const block = preview.parentElement
    if (!block || !block.matches("div.vditor-wysiwyg__block[data-type='code-block']")) return
    const srcPre = block.querySelector('pre.vditor-wysiwyg__pre') as HTMLElement | null
    if (!srcPre || srcPre.style.display === 'none') return
    syncCodeEditing()
    const point = document.caretRangeFromPoint
      ? document.caretRangeFromPoint(e.clientX, e.clientY)
      : null
    if (!point || !srcPre.contains(point.startContainer)) return
    const sel = window.getSelection()
    sel?.removeAllRanges()
    const r = document.createRange()
    r.setStart(point.startContainer, point.startOffset)
    r.collapse(true)
    sel?.addRange(r)
  }

  /* ---------- 代码块语言选择（Typora 式角标 + 可搜索面板） ---------- */

  // 语言直接体现在源码 code 的 language-xxx class 上；改 class 后派发 input，
  // Vditor 会 SpinVditorDOM 重渲染并按新语言重新 hljs 高亮、同步回 Markdown。
  // badge：角标缩写；color：品牌色；kw：搜索关键词（含中文/别名）
  interface LangDef {
    value: string
    label: string
    badge: string
    color: string
    kw: string
  }
  // 纯文本固定置顶，其余按 label 首字母 A–Z 排序
  const CODE_LANGUAGES: LangDef[] = [
    { value: '', label: '纯文本', badge: 'Aa', color: '#9aa0ac', kw: 'plain text chunwenben 文本 无高亮' },
    { value: 'bash', label: 'Bash', badge: 'Bsh', color: '#4eaa25', kw: 'bash zsh 终端 terminal 脚本' },
    { value: 'c', label: 'C', badge: 'C', color: '#03599c', kw: 'c c99' },
    { value: 'csharp', label: 'C#', badge: 'C#', color: '#178600', kw: 'csharp c# cs dotnet' },
    { value: 'cpp', label: 'C++', badge: 'C+', color: '#00599c', kw: 'cpp c++ cxx cc' },
    { value: 'css', label: 'CSS', badge: '#', color: '#2965f1', kw: 'css 样式 style' },
    { value: 'dart', label: 'Dart', badge: 'Dt', color: '#0175c2', kw: 'dart flutter' },
    { value: 'diff', label: 'Diff', badge: '±', color: '#6b7280', kw: 'diff patch 补丁' },
    { value: 'dockerfile', label: 'Dockerfile', badge: 'Dk', color: '#2496ed', kw: 'docker dockerfile 容器' },
    { value: 'go', label: 'Go', badge: 'Go', color: '#00add8', kw: 'go golang' },
    { value: 'graphql', label: 'GraphQL', badge: 'GQ', color: '#e10098', kw: 'graphql gql 查询' },
    { value: 'html', label: 'HTML', badge: '</>', color: '#e34c26', kw: 'html 网页' },
    { value: 'ini', label: 'INI', badge: 'INI', color: '#6d8086', kw: 'ini conf config 配置' },
    { value: 'java', label: 'Java', badge: 'Jv', color: '#e76f00', kw: 'java' },
    { value: 'javascript', label: 'JavaScript', badge: 'JS', color: '#c8a900', kw: 'js node nodejs ecmascript 脚本' },
    { value: 'json', label: 'JSON', badge: '{}', color: '#a07400', kw: 'json 配置 config' },
    { value: 'kotlin', label: 'Kotlin', badge: 'Kt', color: '#7f52ff', kw: 'kotlin kt android' },
    { value: 'lua', label: 'Lua', badge: 'Lu', color: '#2c2d72', kw: 'lua 脚本' },
    { value: 'makefile', label: 'Makefile', badge: 'Mk', color: '#6d8086', kw: 'make makefile 构建' },
    { value: 'markdown', label: 'Markdown', badge: 'MD', color: '#083fa1', kw: 'markdown md 文档' },
    { value: 'objectivec', label: 'Objective-C', badge: 'OC', color: '#438eff', kw: 'objective-c objectivec objc ios' },
    { value: 'php', label: 'PHP', badge: 'PHP', color: '#777bb4', kw: 'php' },
    { value: 'perl', label: 'Perl', badge: 'Pl', color: '#394578', kw: 'perl' },
    { value: 'powershell', label: 'PowerShell', badge: 'PS', color: '#012456', kw: 'powershell ps pwsh cmd 终端' },
    { value: 'python', label: 'Python', badge: 'Py', color: '#3776ab', kw: 'py python 脚本' },
    { value: 'r', label: 'R', badge: 'R', color: '#276dc3', kw: 'r statistics 统计' },
    { value: 'ruby', label: 'Ruby', badge: 'Rb', color: '#cc342d', kw: 'ruby rb gem' },
    { value: 'rust', label: 'Rust', badge: 'Rs', color: '#ce422b', kw: 'rust rs cargo' },
    { value: 'sql', label: 'SQL', badge: 'SQ', color: '#d68b00', kw: 'sql mysql postgres 数据库 database' },
    { value: 'scala', label: 'Scala', badge: 'Sc', color: '#dc322f', kw: 'scala' },
    { value: 'shell', label: 'Shell', badge: 'Sh', color: '#4eaa25', kw: 'shell sh 终端 terminal' },
    { value: 'swift', label: 'Swift', badge: 'Sw', color: '#f05138', kw: 'swift ios apple' },
    { value: 'toml', label: 'TOML', badge: 'TOM', color: '#9c4221', kw: 'toml 配置 config' },
    { value: 'typescript', label: 'TypeScript', badge: 'TS', color: '#3178c6', kw: 'ts' },
    { value: 'vue', label: 'Vue', badge: 'V', color: '#42b883', kw: 'vue 前端' },
    { value: 'xml', label: 'XML', badge: '</>', color: '#f16529', kw: 'xml 配置' },
    { value: 'yaml', label: 'YAML', badge: 'YML', color: '#cb171e', kw: 'yaml yml 配置 config' }
  ]

  const langChip = document.createElement('button')
  langChip.type = 'button'
  langChip.className = 'mb-lang-chip'
  document.body.appendChild(langChip)

  const langPanel = document.createElement('div')
  langPanel.className = 'mb-lang-panel'
  langPanel.innerHTML =
    '<input class="mb-lang-search" type="text" placeholder="搜索语言…" spellcheck="false">' +
    '<ul class="mb-lang-list"></ul>'
  document.body.appendChild(langPanel)
  const langSearch = langPanel.querySelector('.mb-lang-search') as HTMLInputElement
  const langList = langPanel.querySelector('.mb-lang-list') as HTMLUListElement
  const CHECK_SVG =
    '<svg class="mb-lang-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  const CARET_SVG =
    '<svg class="mb-lang-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'

  function codeBlockOf(el: HTMLElement | null): HTMLElement | null {
    return el && el.matches?.("div.vditor-wysiwyg__block[data-type='code-block']") ? el : null
  }

  function codeLangOf(b: HTMLElement): string {
    const code = b.querySelector('pre code')
    const m = code?.className.match(/language-([^\s]+)/)
    return m ? m[1] : ''
  }

  function langDef(value: string): LangDef {
    return (
      CODE_LANGUAGES.find((l) => l.value === value) ?? {
        value,
        label: value || '纯文本',
        badge: value.slice(0, 2) || 'Aa',
        color: '#9aa0ac',
        kw: ''
      }
    )
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function badgeHtml(def: LangDef): string {
    // badge 文本含 </> 等字符，必须转义，否则 </ 被当成标签解析导致图标不显示
    return `<span class="mb-lang-badge" style="background:${def.color}">${escapeHtml(def.badge)}</span>`
  }

  /* 编辑态标记严格跟随源码 pre 的实际可见性：
     Vditor 用内联 style display:none/block 切换源码 pre 与高亮预览 pre。
     不能按选区/焦点自己判断——离开代码块时浏览器 selectionchange 早于 Vditor 在
     click 里隐藏源码 pre，自行提前移除 class 会露出「源码 + 预览」双份一帧。
     用 MutationObserver 监听 pre 的 style：Vditor 在同一事件任务内改 style，
     observer 微任务在浏览器渲染前同步 class，任何时刻两者都不会同时可见。
     childList 也要监听：SpinVditorDOM 整块替换时新块自带 style 属性，不触发 attribute 回调。 */
  function syncCodeEditing(): void {
    // SpinVditorDOM 整块替换后新源码 pre 的内联 style 可能短暂为 none，
    // 但光标仍在该 pre 内（输入/删除过程中）——此时也必须保持编辑态叠加，
    // 否则会瞬间退回“只显示预览”，表现为删除时一块内容消失/残影。
    const anchor = window.getSelection()?.anchorNode ?? null
    host.querySelectorAll("div.vditor-wysiwyg__block[data-type='code-block']").forEach((el) => {
      const block = el as HTMLElement
      const src = block.querySelector('pre.vditor-wysiwyg__pre') as HTMLElement | null
      // 只读 Vditor 的内联 style 意图，不能用 getComputedStyle：本模块加的
      // mb-code-editing CSS 带 display:block !important，会反过来污染 computed 值，
      // 造成「Vditor 已设 none → class 却按 computed=block 保留」的死锁。
      const shown = !!src && src.style.display !== 'none'
      const caretInside = !!src && !!anchor && src.contains(anchor)
      const editing = shown || caretInside
      const was = block.classList.contains('mb-code-editing')
      if (editing && !was) {
        // 进入编辑：必须在 class 切换前读预览滚动位置——切到叠加布局后预览
        // 变 absolute/overflow:hidden，scrollTop 立刻归零。读不触发 mutation，安全。
        const prv = block.querySelector('pre.vditor-wysiwyg__preview') as HTMLElement | null
        if (prv && (prv.scrollTop || prv.scrollLeft)) {
          scrollMap.set(codeBlocks().indexOf(block), { top: prv.scrollTop, left: prv.scrollLeft })
        }
      }
      block.classList.toggle('mb-code-editing', editing)
    })
  }
  // observer 回调里只做纯读 + class 切换；写 scrollTop / setProperty 会再次触发
  // style mutation，同步嵌套会连锁反馈卡死渲染进程。恢复操作统一延迟到 rAF。
  // Vditor 重渲染（Spin / Md2VditorDOM / undo）可能整块替换 DOM，内联高度与滚动
  // 量都会丢——表现为回车后高度回到默认、滚动跳回顶部。
  // 按代码块在文档中的序号独立持久化，替换后按序号套回。
  const heightMap = new Map<number, number>()
  const scrollMap = new Map<number, { top: number; left: number }>()
  function codeBlocks(): HTMLElement[] {
    return Array.from(
      host.querySelectorAll("div.vditor-wysiwyg__block[data-type='code-block']")
    ) as HTMLElement[]
  }
  function blockIndex(block: HTMLElement): number {
    return codeBlocks().indexOf(block)
  }
  // 代码块内容指纹（语言 + 代码文本）：切换笔记时 WysiwygEditor 以 :key=noteId
  // 整体重建，闭包内的 heightMap 会销毁。用模块级 Map 按内容记住高度，
  // 换笔记/换实例后同内容的代码块仍恢复用户拖出的高度。
  function blockContentKey(block: HTMLElement): string {
    const code =
      (block.querySelector('pre.vditor-wysiwyg__pre code') as HTMLElement | null)?.textContent ??
      (block.querySelector('pre.vditor-wysiwyg__preview code') as HTMLElement | null)
        ?.textContent ??
      ''
    const m = /language-(\S+)/.exec(
      (block.querySelector('pre code') as HTMLElement | null)?.className ?? ''
    )
    return `${m ? m[1] : ''}\u0000${code.length}\u0000${fnv1a(code)}`
  }
  let reconcileRaf = 0
  function applyCodeScroll(block: HTMLElement, src: HTMLElement): void {
    const x = String(src.scrollLeft)
    const y = String(src.scrollTop)
    if (block.style.getPropertyValue('--mb-sx') !== x) block.style.setProperty('--mb-sx', x)
    if (block.style.getPropertyValue('--mb-sy') !== y) block.style.setProperty('--mb-sy', y)
  }
  function scheduleReconcile(): void {
    if (reconcileRaf) return
    reconcileRaf = requestAnimationFrame(() => {
      reconcileRaf = 0
      restoreCodeState()
    })
  }
  // Vditor 重渲染会整块替换 DOM，拖拽条要随每次渲染补挂
  function ensureResizer(block: HTMLElement): void {
    if (block.querySelector('.mb-code-resizer')) return
    const bar = document.createElement('div')
    bar.className = 'mb-code-resizer'
    block.appendChild(bar)
  }
  function onResizerDown(e: PointerEvent): void {
    const bar = (e.target as HTMLElement).closest?.('.mb-code-resizer') as HTMLElement | null
    if (!bar) return
    const block = bar.closest("div.vditor-wysiwyg__block[data-type='code-block']") as HTMLElement | null
    if (!block) return
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = block.getBoundingClientRect().height
    block.classList.add('mb-code-resizing')
    const onMove = (ev: PointerEvent): void => {
      const h = Math.max(96, Math.round(startH + ev.clientY - startY))
      block.style.height = `${h}px`
      // 即时持久化：拖动过程中若触发 Spin 替换，新块按序号取回当前高度
      const i = blockIndex(block)
      heightMap.set(i, h)
      codeHeightStore.set(blockContentKey(block), h)
    }
    const onUp = (): void => {
      block.classList.remove('mb-code-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // 通知 Vditor 尺寸变化（内部弹层/行高缓存），不改正文内容
      window.dispatchEvent(new Event('resize'))
    }
    // 监听挂 window：横条只有 9px，一旦块开始长高或鼠标稍快就会移出条，
    // 依赖指针捕获在部分合成事件下不可靠
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  function restoreCodeState(): void {
    codeBlocks().forEach((block, i) => {
      const src = block.querySelector('pre.vditor-wysiwyg__pre') as HTMLElement | null
      const prv = block.querySelector('pre.vditor-wysiwyg__preview') as HTMLElement | null
      ensureResizer(block)
      // —— 高度：用户拖过（内联 style.height 有值）就同时记入序号表与内容表；
      // 新渲染的块没有内联高度：先按序号恢复（同一次编辑内 Spin 替换，此时内容
      // 可能正在变化），再按内容指纹恢复（切换笔记后实例重建，序号表是空的）。 ——
      const inlineH = block.style.height
      if (inlineH) {
        const h = parseFloat(inlineH)
        if (h > 0) {
          heightMap.set(i, h)
          codeHeightStore.set(blockContentKey(block), h)
        }
      } else if (heightMap.has(i)) {
        block.style.height = `${heightMap.get(i)}px`
      } else {
        const stored = codeHeightStore.get(blockContentKey(block))
        if (stored) {
          block.style.height = `${stored}px`
          heightMap.set(i, stored)
        }
      }
      const saved = scrollMap.get(i)
      if (block.classList.contains('mb-code-editing') && src) {
        if (saved) {
          // Spin/整页重渲染后源码 pre 滚动归零，恢复到输入前位置
          if (src.scrollTop !== saved.top) src.scrollTop = saved.top
          if (src.scrollLeft !== saved.left) src.scrollLeft = saved.left
        }
        applyCodeScroll(block, src)
        // 编辑态预览自身不滚动（偏移只靠 code transform），否则双重偏移
        if (prv && (prv.scrollTop || prv.scrollLeft)) {
          prv.scrollTop = 0
          prv.scrollLeft = 0
        }
      } else if (prv && saved) {
        // 显示态：恢复高亮预览的滚动位置
        if (prv.scrollTop !== saved.top) prv.scrollTop = saved.top
        if (prv.scrollLeft !== saved.left) prv.scrollLeft = saved.left
      }
    })
  }
  function onCodeScroll(e: Event): void {
    const el = e.target as HTMLElement
    const block = el.closest?.("div.vditor-wysiwyg__block[data-type='code-block']") as HTMLElement | null
    if (!block) return
    const i = blockIndex(block)
    if (el.matches("pre.vditor-wysiwyg__pre") && block.classList.contains('mb-code-editing')) {
      scrollMap.set(i, { top: el.scrollTop, left: el.scrollLeft })
      applyCodeScroll(block, el)
    } else if (el.matches("pre.vditor-wysiwyg__preview") && !block.classList.contains('mb-code-editing')) {
      // 显示态在预览层滚动
      scrollMap.set(i, { top: el.scrollTop, left: el.scrollLeft })
    }
  }
  const codeObserver = new MutationObserver(() => {
    syncCodeEditing()
    scheduleReconcile()
  })
  codeObserver.observe(host, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style']
  })

  function syncLangChip(): void {
    const b = codeBlockOf(activeBlock)
    if (!b || !b.isConnected) {
      langChip.style.display = 'none'
      return
    }
    const def = langDef(codeLangOf(b))
    langChip.innerHTML =
      '<span class="mb-lang-badge mb-lang-badge--sm" style="background:' +
      def.color +
      '">' +
      escapeHtml(def.badge) +
      '</span><span>' +
      escapeHtml(def.label) +
      '</span>' +
      CARET_SVG
    const rect = b.getBoundingClientRect()
    langChip.style.display = 'flex'
    // 右缘对齐代码块并夹取在视口内，避免窄屏时超出右边
    const width = langChip.offsetWidth || 96
    let left = Math.round(rect.right - width - 8)
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    langChip.style.top = `${Math.round(rect.top + 6)}px`
    langChip.style.left = `${left}px`
  }

  /* ---------- 语言搜索面板 ---------- */

  let langOpen = false
  let langFiltered: LangDef[] = []
  let langIndex = 0

  function closeLangPanel(): void {
    if (!langOpen) return
    langOpen = false
    langPanel.classList.add('closing')
    window.setTimeout(() => {
      langPanel.classList.remove('closing')
      langPanel.style.display = 'none'
    }, 120)
  }

  function ensureLangActiveVisible(): void {
    const item = langList.querySelector('.mb-lang-opt.active') as HTMLElement | null
    if (!item) return
    if (item.offsetTop < langList.scrollTop) {
      langList.scrollTop = item.offsetTop
    } else if (item.offsetTop + item.offsetHeight > langList.scrollTop + langList.clientHeight) {
      langList.scrollTop = item.offsetTop + item.offsetHeight - langList.clientHeight
    }
  }

  function renderLangList(): void {
    const current = codeBlockOf(activeBlock) ? codeLangOf(activeBlock as HTMLElement) : ''
    langList.innerHTML = ''
    if (langFiltered.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'mb-lang-empty'
      empty.textContent = '无匹配语言'
      langList.appendChild(empty)
      return
    }
    langFiltered.forEach((def, i) => {
      const li = document.createElement('li')
      li.className = `mb-lang-opt ${i === langIndex ? 'active' : ''}`
      li.dataset.value = def.value
      if (def.value === current) li.setAttribute('aria-selected', 'true')
      li.innerHTML = `${badgeHtml(def)}<span class="mb-lang-name">${def.label}</span>${CHECK_SVG}`
      li.addEventListener('mousedown', (e) => e.preventDefault())
      li.addEventListener('click', () => pickLang(def))
      langList.appendChild(li)
    })
    ensureLangActiveVisible()
  }

  function filterLangs(): void {
    const q = langSearch.value.trim().toLowerCase()
    if (!q) {
      langFiltered = CODE_LANGUAGES.slice()
    } else {
      langFiltered = CODE_LANGUAGES.filter(
        (l) => l.label.toLowerCase().includes(q) || l.value.includes(q) || l.kw.includes(q)
      )
      // 内置表没有但输入了合法标识（hljs 支持的其它语言）：回车直接采用
      if (!langFiltered.some((l) => l.value === q)) {
        langFiltered.unshift({
          value: q,
          label: q,
          badge: q.slice(0, 2).toUpperCase(),
          color: '#3468f6',
          kw: ''
        })
      }
    }
    const current = codeBlockOf(activeBlock) ? codeLangOf(activeBlock as HTMLElement) : ''
    const ci = langFiltered.findIndex((l) => l.value === current)
    langIndex = ci >= 0 ? ci : 0
    renderLangList()
  }

  function positionLangPanel(): void {
    const rect = langChip.getBoundingClientRect()
    const W = 248
    const H = langPanel.offsetHeight || 320
    let left = Math.round(rect.right - W)
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8))
    let top = Math.round(rect.bottom + 5)
    if (top + H > window.innerHeight - 8) {
      // 下方放不下时翻到芯片上方
      top = Math.max(8, Math.round(rect.top - H - 5))
    }
    langPanel.style.left = `${left}px`
    langPanel.style.top = `${top}px`
  }

  function openLangPanel(): void {
    if (!codeBlockOf(activeBlock)) return
    langOpen = true
    langPanel.classList.remove('closing')
    langPanel.style.display = 'block'
    langSearch.value = ''
    filterLangs()
    positionLangPanel()
    langSearch.focus()
    syncCodeEditing()
  }

  function pickLang(def: LangDef): void {
    const b = codeBlockOf(activeBlock)
    const code = b?.querySelector('pre.vditor-wysiwyg__pre code') as HTMLElement | null
    closeLangPanel()
    if (!b || !code) return
    // 先把光标落回代码区再派发 input：Vditor 的 input 处理器靠编辑器内 selection
    // 决定要 Spin 的块；光标还在语言搜索框时会取不到 range 而跳过重渲染，
    // 表现为源码 class/Markdown 已更新但高亮预览仍是旧语言。
    code.className = def.value ? `language-${def.value}` : ''
    caretInto(code, true)
    fireInput()
    requestAnimationFrame(() => {
      setBlock(codeBlockOf(topBlock(window.getSelection()?.anchorNode ?? null)))
      syncLangChip()
    })
  }

  langChip.addEventListener('mousedown', (e) => e.preventDefault())
  langChip.addEventListener('click', () => {
    if (langOpen) closeLangPanel()
    else openLangPanel()
  })
  langSearch.addEventListener('input', filterLangs)
  langSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeLangPanel()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      langIndex = Math.min(langIndex + 1, langFiltered.length - 1)
      renderLangList()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      langIndex = Math.max(langIndex - 1, 0)
      renderLangList()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const def = langFiltered[langIndex]
      if (def) pickLang(def)
    }
  })

  /* ---------- 块菜单（⠿ 点击） ---------- */

  let blockMenu: HTMLElement | null = null

  function closeBlockMenu(): void {
    const menu = blockMenu
    if (!menu) return
    blockMenu = null
    menu.classList.add('closing')
    window.setTimeout(() => menu.remove(), 120)
  }

  function openBlockMenu(anchor: HTMLElement, block: HTMLElement): void {
    if (blockMenu) {
      blockMenu.remove()
      blockMenu = null
    }
    const menu = document.createElement('div')
    menu.className = 'mb-menu'
    const items: Array<[string, string, () => void]> = [
      ['在上方插入', '', () => insertBlock(block, 'before')],
      ['在下方插入', '', () => insertBlock(block, 'after')],
      ['创建副本', '', () => {
        const dup = block.cloneNode(true) as HTMLElement
        block.insertAdjacentElement('afterend', dup)
        fireInput()
      }],
      ['删除', 'danger', () => {
        const prev = block.previousElementSibling as HTMLElement | null
        const next = block.nextElementSibling as HTMLElement | null
        block.remove()
        fireInput()
        const focus = prev ?? next
        if (focus) caretInto(focus, false)
      }]
    ]
    for (const [label, cls, fn] of items) {
      const it = document.createElement('div')
      it.className = `mb-menu-item ${cls}`
      it.textContent = label
      it.addEventListener('mousedown', (ev) => ev.preventDefault())
      it.addEventListener('click', () => {
        closeBlockMenu()
        fn()
      })
      menu.appendChild(it)
    }
    document.body.appendChild(menu)
    const r = anchor.getBoundingClientRect()
    menu.style.top = `${Math.round(r.bottom + 4)}px`
    menu.style.left = `${Math.round(r.left - 6)}px`
    blockMenu = menu
  }

  plusBtn.addEventListener('mousedown', (e) => e.preventDefault())
  plusBtn.addEventListener('click', () => {
    if (activeBlock) insertBlock(activeBlock, 'after')
  })
  dragBtn.addEventListener('mousedown', (e) => e.preventDefault())
  dragBtn.addEventListener('click', () => {
    if (activeBlock) openBlockMenu(dragBtn, activeBlock)
  })

  function onDocPointerDown(e: MouseEvent): void {
    if (blockMenu && !blockMenu.contains(e.target as Node)) closeBlockMenu()
    // 斜杠/语言面板：点面板自身的选项交给 click；点其它任何位置都关闭
    if (slashOpen && !slashEl.contains(e.target as Node)) closeSlash()
    if (langOpen && !langPanel.contains(e.target as Node) && !langChip.contains(e.target as Node)) {
      closeLangPanel()
    }
  }

  function onKeydownMaybeCloseMenu(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeBlockMenu()
      if (slashOpen) closeSlash()
      if (langOpen) closeLangPanel()
    }
  }

  /* ---------- 长按拖拽 ---------- */

  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let pendingX = 0
  let pendingY = 0
  let dragEl: HTMLElement | null = null
  let ghost: HTMLElement | null = null
  let indicator: HTMLElement | null = null
  let dropRef: { el: HTMLElement; where: 'before' | 'after' } | null = null

  function clearPress(): void {
    if (pressTimer) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  function animateReorder(
    container: HTMLElement,
    firstRects: Map<HTMLElement, DOMRect>,
    source: HTMLElement
  ): void {
    const moved: HTMLElement[] = []
    firstRects.forEach((firstRect, el) => {
      if (!el.isConnected || !container.contains(el)) return
      const lastRect = el.getBoundingClientRect()
      const dy = firstRect.top - lastRect.top
      if (Math.abs(dy) < 1) return
      el.classList.add('mb-reordering')
      el.style.transform = `translateY(${dy}px)`
      moved.push(el)
    })
    if (!moved.length) return
    void container.offsetHeight
    requestAnimationFrame(() => {
      for (const el of moved) el.style.transform = ''
      window.setTimeout(() => {
        for (const el of moved) {
          el.classList.remove('mb-reordering')
          el.style.transform = ''
        }
        source.classList.remove('mb-source-block')
      }, 230)
    })
  }

  function endDrag(): void {
    const source = dragEl
    const pre = getPre()
    let moved = false
    let firstRects = new Map<HTMLElement, DOMRect>()

    if (source && pre) {
      firstRects = new Map(
        Array.from(pre.children).map((el) => [el as HTMLElement, (el as HTMLElement).getBoundingClientRect()])
      )
    }

    if (source && dropRef && dropRef.el.isConnected) {
      const { el, where } = dropRef
      // 避免无意义的自插入
      if (!el.isSameNode(source) && el[where === 'before' ? 'previousElementSibling' : 'nextElementSibling'] !== source) {
        el.insertAdjacentElement(where === 'before' ? 'beforebegin' : 'afterend', source)
        moved = true
        if (pre) animateReorder(pre, firstRects, source)
        fireInput()
      }
    }
    if (!moved && source) source.classList.remove('mb-source-block')

    dragEl = null
    dropRef = null
    ghost?.remove()
    ghost = null
    if (indicator) {
      indicator.classList.remove('show')
      const oldIndicator = indicator
      window.setTimeout(() => oldIndicator.remove(), 130)
    }
    indicator = null
    document.body.classList.remove('mb-dragging')
    window.removeEventListener('pointermove', onDragMove)
    schedulePosition()
  }

  function onDragMove(e: PointerEvent): void {
    if (!dragEl || !ghost || !indicator) return
    const rect = dragEl.getBoundingClientRect()
    ghost.style.width = `${rect.width}px`
    ghost.style.top = `${Math.round(e.clientY - 14)}px`
    ghost.style.left = `${Math.round(rect.left)}px`
    ghost.textContent = dragEl.textContent?.slice(0, 40) ?? ''
    // 优先按鼠标正下方的元素找块；若鼠标停在左侧 gutter 空白处，
    // elementFromPoint 命中不到正文，则按纵向位置遍历顶层块兜底，
    // 这样在手柄列/留白区上下拖动也能换位。
    let target = topBlock(document.elementFromPoint(e.clientX, e.clientY))
    if (!target || target.isSameNode(dragEl)) {
      const pre = getPre()
      const blocks = pre ? (Array.from(pre.children) as HTMLElement[]) : []
      target =
        blocks.find((el) => {
          if (el.isSameNode(dragEl)) return false
          const r = el.getBoundingClientRect()
          return e.clientY >= r.top && e.clientY <= r.bottom
        }) ?? null
    }
    if (!target || target.isSameNode(dragEl)) {
      indicator.classList.remove('show')
      dropRef = null
      return
    }
    const tr = target.getBoundingClientRect()
    const where: 'before' | 'after' = e.clientY < tr.top + tr.height / 2 ? 'before' : 'after'
    const lineY = where === 'before' ? tr.top : tr.bottom
    indicator.style.left = `${Math.round(tr.left)}px`
    indicator.style.right = `${Math.round(window.innerWidth - tr.right)}px`
    indicator.style.top = `${Math.round(lineY) - 2}px`
    indicator.classList.add('show')
    dropRef = { el: target, where }
  }

  function startDrag(): void {
    const block = activeBlock
    if (!block) return
    dragEl = block
    document.body.classList.add('mb-dragging')
    block.classList.add('mb-source-block')
    const rect = block.getBoundingClientRect()
    ghost = document.createElement('div')
    ghost.className = 'mb-ghost'
    ghost.style.height = `${Math.min(rect.height, 60)}px`
    ghost.style.width = `${rect.width}px`
    ghost.style.left = `${Math.round(rect.left)}px`
    ghost.style.top = `${Math.round(rect.top)}px`
    ghost.style.padding = '4px 8px'
    ghost.style.fontSize = '13px'
    ghost.style.overflow = 'hidden'
    ghost.textContent = block.textContent?.slice(0, 40) ?? ''
    document.body.appendChild(ghost)
    indicator = document.createElement('div')
    indicator.className = 'mb-indicator'
    indicator.style.left = `${Math.round(rect.left)}px`
    indicator.style.right = `${Math.round(window.innerWidth - rect.right)}px`
    indicator.style.top = `${Math.round(rect.top) - 2}px`
    document.body.appendChild(indicator)
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDrag, { once: true })
  }

  dragBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !activeBlock) return
    pendingX = e.clientX
    pendingY = e.clientY
    pressTimer = setTimeout(() => {
      pressTimer = null
      closeBlockMenu()
      startDrag()
    }, 320)
  })
  window.addEventListener('pointermove', onPressCancelMove)
  window.addEventListener('pointerup', clearPress)

  /* ---------- 斜杠命令 ---------- */

  const slashEl = document.createElement('div')
  slashEl.className = 'mb-slash'
  slashEl.style.display = 'none'
  document.body.appendChild(slashEl)

  let slashOpen = false
  let slashItems: SlashItem[] = []
  let slashIndex = 0
  let slashAnchor: { node: Text; offset: number } | null = null

  // 面板是挂在 body 上的 fixed 元素，滚动容器（pre.vditor-reset 等）的 scroll
  // 事件不冒泡且嵌套层级多，scroll 监听无法保证跟随；打开期间用 rAF 逐帧定位，
  // 任何一层滚动都能立即同步。
  // 注意：不能用光标 Range.getBoundingClientRect()——在 contenteditable 的 pre
  // 滚动时，Chromium 对折叠光标的 Range rect 返回陈旧缓存坐标，面板会原地不动。
  // 用光标所在“块元素”的 rect 定位，Element rect 滚动时必定更新。
  let slashRaf = 0
  let lastCaretKey = ''
  function trackSlash(): void {
    slashRaf = 0
    if (slashOpen) {
      const sel = window.getSelection()
      const block = sel ? topBlock(sel.anchorNode) : null
      if (block) {
        const r = block.getBoundingClientRect()
        const key = `${Math.round(r.top)}:${Math.round(r.left)}:${block.textContent?.length ?? 0}`
        if (key !== lastCaretKey) {
          lastCaretKey = key
          positionSlash()
        }
      }
      slashRaf = requestAnimationFrame(trackSlash)
    }
  }
  function startSlashTrack(): void {
    if (!slashRaf) slashRaf = requestAnimationFrame(trackSlash)
  }
  function stopSlashTrack(): void {
    if (slashRaf) {
      cancelAnimationFrame(slashRaf)
      slashRaf = 0
    }
    lastCaretKey = ''
  }

  function closeSlash(): void {
    if (!slashOpen) return
    slashOpen = false
    slashAnchor = null
    stopSlashTrack()
    slashEl.classList.add('closing')
    window.setTimeout(() => {
      slashEl.classList.remove('closing')
      slashEl.style.display = 'none'
    }, 120)
  }

  // 面板自身是 max-height 264px 的滚动容器，命令多时键盘 ↓↑ 选中项可能在
  // 可视区外；手动把 .active 项滚入面板视口（不用 scrollIntoView，避免连带
  // 滚动编辑器/页面）。
  function ensureActiveVisible(): void {
    const item = slashEl.querySelector('.mb-slash-item.active') as HTMLElement | null
    if (!item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < slashEl.scrollTop) {
      slashEl.scrollTop = top
    } else if (bottom > slashEl.scrollTop + slashEl.clientHeight) {
      slashEl.scrollTop = bottom - slashEl.clientHeight
    }
  }

  function renderSlash(): void {
    slashEl.innerHTML = ''
    if (slashItems.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'mb-slash-empty'
      empty.textContent = '无匹配项'
      slashEl.appendChild(empty)
      return
    }
    slashItems.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = `mb-slash-item ${i === slashIndex ? 'active' : ''}`
      const ico = document.createElement('span')
      ico.className = 'mb-ico'
      ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>`
      const txt = document.createElement('span')
      txt.textContent = item.title
      row.append(ico, txt)
      row.addEventListener('mousedown', (e) => e.preventDefault())
      row.addEventListener('click', () => pickSlash(item))
      slashEl.appendChild(row)
    })
    ensureActiveVisible()
  }

  function locateSlash(): { node: Text; offset: number; query: string } | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
    const block = topBlock(sel.anchorNode)
    if (!block) return null
    const caret = sel.getRangeAt(0).cloneRange()
    const start = document.createRange()
    start.selectNodeContents(block)
    try {
      start.setEnd(caret.startContainer, caret.startOffset)
    } catch {
      return null
    }
    const prefix = start.toString()
    const slash = prefix.lastIndexOf('/')
    if (slash < 0) return null
    if (slash > 0 && !/\s/.test(prefix[slash - 1])) return null
    const query = prefix.slice(slash + 1)
    if (/\s/.test(query)) return null
    // 找到 “/” 所在的文本节点
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let acc = 0
    let node: Text | null = null
    let offset = 0
    let n = walker.nextNode() as Text | null
    while (n) {
      const len = n.textContent?.length ?? 0
      if (acc + len >= slash) {
        node = n
        offset = slash - acc
        break
      }
      acc += len
      n = walker.nextNode() as Text | null
    }
    if (!node) return null
    return { node, offset, query }
  }

  function refreshSlash(): void {
    if (!slashOpen) return
    const found = locateSlash()
    if (!found) {
      closeSlash()
      return
    }
    slashAnchor = { node: found.node, offset: found.offset }
    const q = found.query.toLowerCase()
    slashItems = q
      ? SLASH_ITEMS.filter((it) => it.title.toLowerCase().includes(q) || it.keywords.includes(q))
      : SLASH_ITEMS.slice()
    slashIndex = 0
    renderSlash()
    positionSlash()
  }

  function positionSlash(): void {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    // 以光标所在块元素为锚点（不用 Range rect，滚动时它可能是陈旧值）
    const block = topBlock(sel.anchorNode)
    if (!block) return
    const rect = block.getBoundingClientRect()
    // 块已滚出视口：面板临时隐藏，滚回来再显示
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      slashEl.style.visibility = 'hidden'
      return
    }
    slashEl.style.visibility = ''
    // 必须用完整内容高度（scrollHeight）而非 offsetHeight：面板 max-height 会把
    // 后者裁剪成可视高度，据此判断翻转/容纳会低估，导致「引用」等下半部分选项
    // 落在裁剪区外，点击实际命中后面的编辑器、命令不执行。
    const need = slashEl.scrollHeight || 264
    const gap = 4
    const spaceBelow = window.innerHeight - 8 - Math.round(rect.bottom) - gap
    const spaceAbove = Math.round(rect.top) - 12
    let top: number
    if (need <= spaceBelow || spaceBelow >= spaceAbove) {
      // 放下方：按可用高度收紧 max-height，能放下时展示全部选项
      top = Math.round(rect.bottom) + gap
      slashEl.style.maxHeight = `${Math.max(120, spaceBelow)}px`
    } else {
      // 下方放不下且上方更宽裕：翻到块上方，同样按可用高度裁剪
      const h = Math.min(need, Math.max(120, spaceAbove))
      top = Math.max(8, Math.round(rect.top) - h - gap)
      slashEl.style.maxHeight = `${h}px`
    }
    slashEl.style.left = `${Math.round(rect.left) + 2}px`
    slashEl.style.top = `${top}px`
  }

  function openSlash(): void {
    slashOpen = true
    slashEl.classList.remove('closing')
    slashEl.style.display = 'block'
    refreshSlash()
    startSlashTrack()
  }

  function removeToken(): void {
    const found = locateSlash()
    if (!found) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const caret = sel.getRangeAt(0)
    const r = document.createRange()
    r.setStart(found.node, found.offset)
    r.setEnd(caret.startContainer, caret.startOffset)
    r.deleteContents()
    sel.removeAllRanges()
    const nr = document.createRange()
    nr.setStart(found.node, found.offset)
    nr.collapse(true)
    sel.addRange(nr)
  }

  function pickSlash(item: SlashItem): void {
    const block = topBlock(window.getSelection()?.anchorNode ?? null)
    removeToken()
    closeSlash()
    if (item.hr) {
      if (block) {
        block.insertAdjacentElement('afterend', document.createElement('hr'))
        fireInput()
      }
      return
    }
    vd.insertValue(item.snippet ?? '', true)
  }

  function onSlashKeydown(e: KeyboardEvent): void {
    if (!slashOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSlash()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      slashIndex = Math.min(slashIndex + 1, slashItems.length - 1)
      renderSlash()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      slashIndex = Math.max(slashIndex - 1, 0)
      renderSlash()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const it = slashItems[slashIndex]
      if (it) pickSlash(it)
    }
  }

  function onEditorInput(): void {
    if (slashOpen) {
      refreshSlash()
      return
    }
    const found = locateSlash()
    if (found && found.query === '' && window.getSelection()?.isCollapsed) {
      // 只在刚键入 “/” 时打开：locateSlash 对任意行首/空格后的 / 均成立
      openSlash()
    }
    // 输入触发 Vditor 重渲染会替换代码块 DOM，活动块引用与编辑态标记需重新对齐；
    // 滚动位置/自定义高度的恢复由 restoreCodeState 统一处理
    requestAnimationFrame(() => {
      schedulePosition()
      restoreCodeState()
    })
  }

  /* ---------- 绑定 ---------- */

  host.addEventListener('mousemove', onMouseMove as EventListener)
  host.addEventListener('scroll', onCodeScroll, true)
  host.addEventListener('mousedown', onHostMouseDown)
  host.addEventListener('click', onCodeBlockClick)
  host.addEventListener('pointerdown', onResizerDown, true)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeydownMaybeCloseMenu)
  host.addEventListener('keydown', onSlashKeydown as EventListener, true)
  const pre = getPre()
  pre?.addEventListener('input', onEditorInput)
  // Vditor 重渲染会替换 pre，用捕获监听兜底
  host.addEventListener(
    'input',
    (e) => {
      if (e.target === getPre()) onEditorInput()
    },
    true
  )
  window.addEventListener('resize', schedulePosition)
  host.addEventListener('scroll', schedulePosition, true)
  document.addEventListener('scroll', schedulePosition, true)

  return () => {
    codeObserver.disconnect()
    if (reconcileRaf) cancelAnimationFrame(reconcileRaf)
    host.removeEventListener('mousemove', onMouseMove as EventListener)
    host.removeEventListener('scroll', onCodeScroll, true)
    host.removeEventListener('mousedown', onHostMouseDown)
    host.removeEventListener('click', onCodeBlockClick)
    host.removeEventListener('pointerdown', onResizerDown, true)
    window.removeEventListener('pointermove', onPressCancelMove)
    window.removeEventListener('pointerup', clearPress)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onKeydownMaybeCloseMenu)
    host.removeEventListener('keydown', onSlashKeydown as EventListener, true)
    window.removeEventListener('resize', schedulePosition)
    host.removeEventListener('scroll', schedulePosition, true)
    document.removeEventListener('scroll', schedulePosition, true)
    clearPress()
    endDrag()
    closeBlockMenu()
    closeSlash()
    stopSlashTrack()
    handles.remove()
    langChip.remove()
    langPanel.remove()
    slashEl.remove()
  }
}
