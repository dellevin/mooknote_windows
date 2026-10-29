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
.mb-menu{position:fixed;z-index:1300;min-width:132px;background:#fff;border:1px solid #e6e8ee;border-radius:8px;box-shadow:0 6px 22px rgba(31,38,52,.14);padding:4px;transform-origin:top left;animation:mb-pop-in .14s cubic-bezier(.2,.9,.25,1.15) both;}
.mb-menu.closing,.mb-slash.closing{animation:mb-fade-out .12s ease both;pointer-events:none;}
.mb-menu-item{padding:6px 10px;font-size:13px;color:#3a4050;border-radius:5px;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease;}
.mb-menu-item:hover{background:#f2f4f8;}
.mb-menu-item.danger{color:#e0483d;}
.mb-menu-item.danger:hover{background:#fdeceb;}
.mb-slash{position:fixed;z-index:1300;width:212px;max-height:264px;overflow-y:auto;background:#fff;border:1px solid #e6e8ee;border-radius:8px;box-shadow:0 6px 22px rgba(31,38,52,.14);padding:4px;transform-origin:top left;animation:mb-pop-in .14s cubic-bezier(.2,.9,.25,1.15) both;}
.mb-slash-item{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:13px;color:#3a4050;border-radius:5px;cursor:pointer;white-space:nowrap;transition:background .12s ease;}
.mb-slash-item .mb-ico{width:24px;height:24px;flex:0 0 24px;border:1px solid #e7e9f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#6b7280;background:#fafbfc;}
.mb-slash-item .mb-ico svg{width:15px;height:15px;display:block;}
.mb-slash-item.active .mb-ico,.mb-slash-item:hover .mb-ico{color:#3468f6;border-color:#cdddff;background:#fff;}
.mb-slash-item.active,.mb-slash-item:hover{background:#eef3ff;}
.mb-slash-empty{padding:10px;font-size:12px;color:#9aa0ac;}
body.mb-dragging{cursor:grabbing !important;-webkit-user-select:none;user-select:none;}
.mb-source-block{opacity:.32 !important;transition:opacity .14s ease;}
.mb-reordering{transition:transform .2s cubic-bezier(.2,.8,.2,1) !important;will-change:transform;}
.mb-ghost{position:fixed;z-index:1400;pointer-events:none;opacity:.5;background:#eaf2ff;border:1px solid #7aa2f7;border-radius:6px;transition:left .08s ease,top .08s ease,width .12s ease;animation:mb-ghost-in .14s ease both;}
.mb-indicator{position:fixed;z-index:1400;pointer-events:none;height:3px;background:#3468f6;border-radius:2px;left:0;right:0;opacity:0;transform:scaleX(.4);transition:top .12s cubic-bezier(.2,.8,.2,1),opacity .12s ease,transform .12s ease;}
.mb-indicator.show{opacity:1;transform:scaleX(1);}
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
    // 斜杠面板是 fixed 定位，编辑器/页面滚动时也要跟着光标走
    if (slashOpen) positionSlash()
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
    if (slashOpen) return
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
  }

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
    // 斜杠面板：点面板自身的选项交给 click；点其它任何位置都关闭
    if (slashOpen && !slashEl.contains(e.target as Node)) closeSlash()
  }

  function onKeydownMaybeCloseMenu(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeBlockMenu()
      if (slashOpen) closeSlash()
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
    // 下方放不下时翻到块上方，避免弹窗内容超出视口底部
    const panelH = slashEl.offsetHeight || 264
    let top = Math.round(rect.bottom) + 4
    if (top + panelH > window.innerHeight - 8) {
      top = Math.max(8, Math.round(rect.top) - panelH - 4)
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
  }

  /* ---------- 绑定 ---------- */

  host.addEventListener('mousemove', onMouseMove as EventListener)
  host.addEventListener('mousedown', onHostMouseDown)
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
    host.removeEventListener('mousemove', onMouseMove as EventListener)
    host.removeEventListener('mousedown', onHostMouseDown)
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
    slashEl.remove()
  }
}
