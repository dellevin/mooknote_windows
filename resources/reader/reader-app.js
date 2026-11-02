/* MookNote 阅读页宿主控制层
 * 运行在 foliate-js reader.html 中（与 book.js 同页同域）。
 * book.js 通过 window.flutter_inappwebview.callHandler(name, data) 上报事件，
 * 已在 reader.html 桥接到 window.mook.readerHost.event → 主进程 → onHostEvent 回到本文件。
 * 宿主侧通过 window.goToHref/goToCfi/nextPage/changeStyle 等全局函数控制阅读器。
 */
;(function () {
  'use strict'

  const params = new URLSearchParams(location.search)
  const readParam = (k, fallback) => {
    try {
      const v = params.get(k)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  }
  const bookId = readParam('bookId', '')
  const importing = readParam('importing', false)
  // 无历史进度：foliate 对漫画(CBZ)在空 cfi 时会 next() 到末页，需加载后回到开头
  const hasInitialCfi = !!readParam('initialCfi', '')
  let toc = []
  let lastLocation = null
  let currentChapter = ''
  let loadFired = false
  let saveTimer = null

  const $ = (id) => document.getElementById(id)

  // importing 模式（隐藏窗提取元数据）不注入阅读控制 UI
  if (importing) return

  // ---------- UI 注入 ----------
  const css = `
  #mn-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 900;
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    background: rgba(245, 241, 232, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(0,0,0,0.08);
    color: #3a352c; font-family: system-ui, 'Microsoft YaHei', sans-serif;
    font-size: 13px; user-select: none;
    transition: transform .22s ease;
  }
  #mn-bar.hidden { transform: translateY(-100%); }
  .mn-btn {
    border: none; background: transparent; border-radius: 8px;
    padding: 6px 11px; font-size: 13px; font-family: inherit;
    color: #3a352c; cursor: pointer; white-space: nowrap;
  }
  .mn-btn:hover { background: rgba(0,0,0,0.08); }
  #mn-chapter { flex: 1; text-align: center; color: #6b6558; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; }
  .mn-panel {
    position: fixed; top: 0; bottom: 0; z-index: 950;
    background: rgba(250, 248, 243, 0.98);
    box-shadow: 0 0 28px rgba(0,0,0,0.18);
    font-family: system-ui, 'Microsoft YaHei', sans-serif; font-size: 14px;
    color: #2b2f36; display: flex; flex-direction: column;
    transition: transform .22s ease;
  }
  .mn-panel.from-left { left: 0; width: 320px; }
  .mn-panel.from-right { right: 0; width: 330px; }
  .mn-panel.hidden { transform: translateX(calc(-100% - 24px)); }
  .mn-panel.from-right.hidden { transform: translateX(calc(100% + 24px)); }
  .mn-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 18px; font-weight: 700; font-size: 15px;
    border-bottom: 1px solid rgba(0,0,0,0.08);
  }
  .mn-panel-body { flex: 1; overflow-y: auto; padding: 10px 8px; }
  .mn-x { border: none; background: transparent; font-size: 18px; cursor: pointer;
    color: #7a7669; padding: 2px 8px; border-radius: 6px; }
  .mn-x:hover { background: rgba(0,0,0,0.07); }
  .mn-toc-item {
    display: block; width: 100%; text-align: left; border: none; background: transparent;
    padding: 9px 10px; border-radius: 8px; cursor: pointer; font-family: inherit;
    font-size: 13.5px; color: #33383f; line-height: 1.4;
  }
  .mn-toc-item:hover { background: rgba(0,0,0,0.06); }
  .mn-toc-item.active { background: rgba(74,111,165,0.14); color: #2f568a; font-weight: 600; }
  .mn-set-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; }
  .mn-set-label { flex: 0 0 64px; color: #555; font-size: 13px; }
  .mn-stepper { display: flex; align-items: center; gap: 10px; }
  .mn-stepper button { width: 30px; height: 28px; border-radius: 7px; border: 1px solid rgba(0,0,0,0.18);
    background: #fff; font-size: 16px; cursor: pointer; }
  .mn-stepper .val { min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; }
  .mn-seg { display: flex; gap: 6px; flex: 1; }
  .mn-seg button { flex: 1; padding: 7px 0; border-radius: 8px; border: 1px solid rgba(0,0,0,0.18);
    background: #fff; font-size: 12.5px; font-family: inherit; cursor: pointer; }
  .mn-seg button.on { background: #4a6fa5; color: #fff; border-color: #4a6fa5; }
  .mn-themes { display: flex; gap: 12px; }
  .mn-theme { width: 42px; height: 42px; border-radius: 10px; cursor: pointer;
    border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); }
  .mn-theme.on { border-color: #4a6fa5; }
  .mn-mask { position: fixed; inset: 0; z-index: 920; background: transparent; }
  .mn-bm-item { width: 100%; text-align: left; border: none; background: transparent; cursor: pointer;
    padding: 10px 12px; border-radius: 8px; font-family: inherit; display: block; }
  .mn-bm-item:hover { background: rgba(0,0,0,0.06); }
  .mn-bm-chapter { font-size: 12px; color: #8a8578; margin-bottom: 3px; }
  .mn-bm-text { font-size: 13px; color: #33383f; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .mn-bm-del { float: right; color: #b04a3b; font-size: 12px; }
  .mn-empty { color: #9a9588; text-align: center; padding: 40px 20px; font-size: 13px; }
  `
  const styleEl = document.createElement('style')
  styleEl.textContent = css
  document.head.appendChild(styleEl)

  const ui = document.createElement('div')
  ui.innerHTML = `
  <div id="mn-bar">
    <button class="mn-btn" id="mn-back" title="返回书架">← 书架</button>
    <div id="mn-chapter"></div>
    <button class="mn-btn" id="mn-bookmark-btn" title="添加/移除本页书签">🔖</button>
    <button class="mn-btn" id="mn-bookmarks-btn">书签</button>
    <button class="mn-btn" id="mn-toc-btn">目录</button>
    <button class="mn-btn" id="mn-settings-btn">设置</button>
  </div>

  <div class="mn-panel from-left hidden" id="mn-toc-panel">
    <div class="mn-panel-head"><span id="mn-toc-title">目录</span><button class="mn-x" data-close="toc">✕</button></div>
    <div class="mn-panel-body" id="mn-toc-body"></div>
  </div>

  <div class="mn-panel from-left hidden" id="mn-bookmarks-panel">
    <div class="mn-panel-head"><span>书签</span><button class="mn-x" data-close="bookmarks">✕</button></div>
    <div class="mn-panel-body" id="mn-bookmarks-body"></div>
  </div>

  <div class="mn-panel from-right hidden" id="mn-settings-panel">
    <div class="mn-panel-head"><span>阅读设置</span><button class="mn-x" data-close="settings">✕</button></div>
    <div class="mn-panel-body">
      <div class="mn-set-row">
        <span class="mn-set-label">字号</span>
        <div class="mn-stepper">
          <button data-step="fontSize" data-d="-0.1">−</button>
          <span class="val" id="mn-val-fontSize"></span>
          <button data-step="fontSize" data-d="0.1">＋</button>
        </div>
      </div>
      <div class="mn-set-row">
        <span class="mn-set-label">行距</span>
        <div class="mn-stepper">
          <button data-step="spacing" data-d="-0.1">−</button>
          <span class="val" id="mn-val-spacing"></span>
          <button data-step="spacing" data-d="0.1">＋</button>
        </div>
      </div>
      <div class="mn-set-row">
        <span class="mn-set-label">左右边距</span>
        <div class="mn-stepper">
          <button data-step="sideMargin" data-d="-1">−</button>
          <span class="val" id="mn-val-sideMargin"></span>
          <button data-step="sideMargin" data-d="1">＋</button>
        </div>
      </div>
      <div class="mn-set-row">
        <span class="mn-set-label">翻页</span>
        <div class="mn-seg" id="mn-turn">
          <button data-turn="slide">滑动</button>
          <button data-turn="noAnimation">无动画</button>
          <button data-turn="scroll">滚动</button>
        </div>
      </div>
      <div class="mn-set-row">
        <span class="mn-set-label">分栏</span>
        <div class="mn-seg" id="mn-cols">
          <button data-cols="1">单栏</button>
          <button data-cols="2">双栏</button>
        </div>
      </div>
      <div class="mn-set-row">
        <span class="mn-set-label">主题</span>
        <div class="mn-themes" id="mn-themes"></div>
      </div>
    </div>
  </div>`
  document.body.appendChild(ui)

  // ---------- 本地可调样式状态（与 prefs 同步） ----------
  const THEMES = [
    { bg: '#f5f1e8', fg: '#26231d' },
    { bg: '#ffffff', fg: '#1f2329' },
    { bg: '#e8efe4', fg: '#23301f' },
    { bg: '#1e2128', fg: '#c8ccd4' }
  ]
  const local = {
    fontSize: readParam('style', {}).fontSize ?? 1.15,
    spacing: readParam('style', {}).spacing ?? 1.8,
    sideMargin: readParam('style', {}).sideMargin ?? 7,
    pageTurnStyle: readParam('style', {}).pageTurnStyle ?? 'slide',
    fontColor: readParam('style', {}).fontColor ?? '#26231d',
    backgroundColor: readParam('style', {}).backgroundColor ?? '#f5f1e8',
    maxColumnCount: readParam('style', {}).maxColumnCount ?? 1
  }

  function applyStyle(patch) {
    Object.assign(local, patch)
    window.changeStyle({
      fontSize: round(local.fontSize),
      spacing: round(local.spacing),
      sideMargin: local.sideMargin,
      pageTurnStyle: local.pageTurnStyle,
      fontColor: local.fontColor,
      backgroundColor: local.backgroundColor,
      maxColumnCount: local.maxColumnCount
    })
    if (local.pageTurnStyle === 'scroll') window.setScroll()
    else if (local.pageTurnStyle === 'noAnimation') window.setNoAnimation()
    else window.setPaginated()
    refreshSettingsUI()
    void window.mook.prefs.set('readerStyle', local)
  }
  const round = (n) => Math.round(n * 100) / 100

  function refreshSettingsUI() {
    $('mn-val-fontSize').textContent = local.fontSize.toFixed(2)
    $('mn-val-spacing').textContent = local.spacing.toFixed(1)
    $('mn-val-sideMargin').textContent = local.sideMargin + '%'
    document.querySelectorAll('#mn-turn button').forEach((b) =>
      b.classList.toggle('on', b.dataset.turn === local.pageTurnStyle)
    )
    document.querySelectorAll('#mn-cols button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.cols) === local.maxColumnCount)
    )
  }

  // 主题色块
  const themesBox = $('mn-themes')
  THEMES.forEach((t) => {
    const el = document.createElement('div')
    el.className = 'mn-theme'
    el.style.background = t.bg
    el.style.color = t.fg
    el.title = t.bg
    el.onclick = () => applyStyle({ backgroundColor: t.bg, fontColor: t.fg })
    themesBox.appendChild(el)
  })

  // 读取已保存的阅读偏好
  window.mook.prefs.get('readerStyle', null).then((saved) => {
    if (saved && typeof saved === 'object') {
      applyStyle(saved)
    } else {
      refreshSettingsUI()
    }
  })

  ui.querySelectorAll('[data-step]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.step
      const d = Number(btn.dataset.d)
      const next = { [key]: round(local[key] + d) }
      if (key === 'fontSize' && (next.fontSize < 0.6 || next.fontSize > 3)) return
      if (key === 'spacing' && (next.spacing < 1 || next.spacing > 3)) return
      if (key === 'sideMargin' && (next.sideMargin < 0 || next.sideMargin > 30)) return
      applyStyle(next)
    }
  })
  document.querySelectorAll('#mn-turn button').forEach((b) => {
    b.onclick = () => applyStyle({ pageTurnStyle: b.dataset.turn })
  })
  document.querySelectorAll('#mn-cols button').forEach((b) => {
    b.onclick = () => applyStyle({ maxColumnCount: Number(b.dataset.cols) })
  })

  // ---------- 面板显隐 ----------
  const panels = { toc: $('mn-toc-panel'), bookmarks: $('mn-bookmarks-panel'), settings: $('mn-settings-panel') }
  function closePanels() {
    Object.values(panels).forEach((p) => p.classList.add('hidden'))
    document.querySelectorAll('.mn-mask').forEach((m) => m.remove())
  }
  function openPanel(name) {
    const isOpen = !panels[name].classList.contains('hidden')
    closePanels()
    if (isOpen) return
    panels[name].classList.remove('hidden')
    const mask = document.createElement('div')
    mask.className = 'mn-mask'
    mask.onclick = closePanels
    document.body.appendChild(mask)
    if (name === 'bookmarks') void renderBookmarks()
    if (name === 'toc') renderToc()
  }
  $('mn-toc-btn').onclick = () => openPanel('toc')
  $('mn-bookmarks-btn').onclick = () => openPanel('bookmarks')
  $('mn-settings-btn').onclick = () => openPanel('settings')
  ui.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => closePanels()
  })
  $('mn-back').onclick = () => window.mook.reader.backShelf()
  $('mn-bookmark-btn').onclick = () => window.addBookmarkHere()

  // ---------- 目录 ----------
  function renderToc() {
    const body = $('mn-toc-body')
    body.innerHTML = ''
    if (!toc.length) {
      body.innerHTML = '<div class="mn-empty">本书没有目录</div>'
      return
    }
    const walk = (items, depth) => {
      for (const it of items) {
        const btn = document.createElement('button')
        btn.className = 'mn-toc-item'
        btn.style.paddingLeft = 10 + (depth - 1) * 14 + 'px'
        btn.textContent = it.label
        if (lastLocation?.tocItem?.href && it.href &&
            lastLocation.tocItem.href.split('#')[0] === it.href.split('#')[0]) {
          btn.classList.add('active')
        }
        btn.onclick = () => {
          window.goToHref(it.href)
          closePanels()
        }
        body.appendChild(btn)
        if (it.subitems?.length) walk(it.subitems, depth + 1)
      }
    }
    walk(toc, 1)
  }

  // ---------- 书签 ----------
  async function renderBookmarks() {
    const body = $('mn-bookmarks-body')
    body.innerHTML = '<div class="mn-empty">加载中…</div>'
    const list = await window.mook.reader.annotations(bookId)
    if (!list.length) {
      body.innerHTML = '<div class="mn-empty">还没有书签，阅读时点右上角 🔖 添加</div>'
      return
    }
    body.innerHTML = ''
    list
      .slice()
      .reverse()
      .forEach((a) => {
        const item = document.createElement('div')
        item.className = 'mn-bm-item'
        item.innerHTML =
          `<div class="mn-bm-chapter">${escapeHtml(a.chapter || '')}
             <span class="mn-bm-del" data-del="${a.value}">删除</span></div>
           <div class="mn-bm-text">${escapeHtml(a.note || '')}</div>`
        item.onclick = (e) => {
          if (e.target.dataset.del) return
          window.goToCfi(a.value)
          closePanels()
        }
        item.querySelector('[data-del]').onclick = async (e) => {
          e.stopPropagation()
          await window.mook.reader.removeBookmark(bookId, a.value)
          window.removeAnnotation(a.value)
          await renderBookmarks()
        }
        body.appendChild(item)
      })
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  }

  // ---------- 进度 ----------
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!lastLocation?.cfi) return
      const pct = Number.isFinite(lastLocation.percentage) ? lastLocation.percentage : 0
      void window.mook.reader.saveProgress({
        bookId,
        cfi: lastLocation.cfi,
        percentage: pct,
        chapterTitle: currentChapter || null
      })
    }, 1200)
  }

  // ---------- foliate-js 事件 ----------
  window.mook.reader.onHostEvent(async (name, data) => {
    if (name === 'onRelocated') {
      // foliate 回传字段：cfi / percentage / chapterTitle / tocItem ...
      lastLocation = data
      currentChapter = data.chapterTitle || currentChapter
      const pct = Number.isFinite(data.percentage) ? Math.round(data.percentage * 100) : 0
      $('mn-chapter').textContent = `${currentChapter || ''}　${pct}%`
      scheduleSave()
    } else if (name === 'onSetToc') {
      toc = data || []
    } else if (name === 'onLoadEnd') {
      loadFired = true
      if (!hasInitialCfi) window.goToPercent(0)
      // 回灌书签（foliate 用它识别当前页是否已加书签）
      const list = await window.mook.reader.annotations(bookId)
      list.forEach((a) =>
        window.addAnnotation({ id: a.id, value: a.value, type: a.type, color: a.color, note: a.note })
      )
    } else if (name === 'handleBookmark') {
      const res = await window.mook.reader.toggleBookmark(bookId, {
        remove: data.remove,
        detail: data.detail,
        chapterTitle: currentChapter || null
      })
      if (res.action === 'added') {
        window.addAnnotation({
          id: res.id, value: data.detail.cfi, type: 'bookmark', color: '#e8a33d', note: data.detail.content
        })
      } else {
        window.removeAnnotation(data.detail.cfi)
      }
    } else if (name === 'onClick') {
      // 三分区：左/右翻页，中部切换工具栏（仅分页模式自动翻页）
      if (local.pageTurnStyle === 'scroll') {
        toggleBar()
        return
      }
      if (data.x < 0.32) window.prevPage()
      else if (data.x > 0.68) window.nextPage()
      else toggleBar()
    }
  })

  // foliate 打开失败时给出可见提示
  window.addEventListener('error', (e) => {
    if (!loadFired && String(e.message).includes('book')) {
      const d = document.createElement('div')
      d.textContent = '书籍打开失败：' + e.message
      d.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#a33;font-family:sans-serif;'
      document.body.appendChild(d)
    }
  })

  let barVisible = true
  function toggleBar() {
    barVisible = !barVisible
    $('mn-bar').classList.toggle('hidden', !barVisible)
    if (!barVisible) closePanels()
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') window.prevPage()
    else if (e.key === 'ArrowRight' || e.key === ' ') window.nextPage()
    else if (e.key === 'Escape') closePanels()
  })
})()
