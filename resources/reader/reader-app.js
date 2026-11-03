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
  // Apple Books 风格：顶栏与面板颜色全部跟随当前阅读主题（--mn-page / --mn-ink），
  // 夜间主题下自动反色；使用 color-mix 派生半透明层。
  const css = `
  :root {
    --mn-page: #f5f1e8;
    --mn-ink: #26231d;
    --mn-accent: #d1622a;
  }
  #mn-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 900;
    display: flex; align-items: center; gap: 4px;
    height: 48px; padding: 0 10px 0 10px;
    /* 栏整体不接收事件，空白处落到下层 #mn-dragstrip（拖拽带）；
       不能直接在 #mn-bar 上开 drag——它有 transform 隐藏动画，
       Chromium 的拖拽区计算忽略 transform，会把整栏按钮一起吞掉 */
    pointer-events: none;
    background: color-mix(in srgb, var(--mn-page) 80%, transparent);
    -webkit-backdrop-filter: blur(20px) saturate(1.6);
    backdrop-filter: blur(20px) saturate(1.6);
    color: var(--mn-ink);
    font-family: -apple-system, system-ui, 'Microsoft YaHei', sans-serif;
    font-size: 14px; user-select: none;
    transition: transform .28s cubic-bezier(.32,.72,.3,1), opacity .28s;
  }
  #mn-bar.hidden { transform: translateY(-100%); pointer-events: none; }
  .mn-btn {
    border: none; background: transparent; border-radius: 9px;
    width: 36px; height: 34px;
    display: inline-flex; align-items: center; justify-content: center;
    color: color-mix(in srgb, var(--mn-ink) 82%, transparent);
    cursor: pointer; transition: background .15s;
    pointer-events: auto;
    -webkit-app-region: no-drag;
  }
  .mn-btn:hover { background: color-mix(in srgb, var(--mn-ink) 8%, transparent); }
  .mn-btn:active { background: color-mix(in srgb, var(--mn-ink) 14%, transparent); }
  .mn-btn svg { width: 21px; height: 21px; }
  #mn-back { width: auto; padding: 0 10px 0 6px; gap: 2px; font-size: 15px;
    color: var(--mn-accent); }
  #mn-back svg { width: 23px; height: 23px; }
  #mn-back .back-label { font-weight: 500; }
  #mn-chapter { flex: 1; text-align: center;
    color: color-mix(in srgb, var(--mn-ink) 55%, transparent);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding: 0 10px; font-size: 13px; font-weight: 500; }
  #mn-bookmark-btn.on { color: var(--mn-accent); }
  #mn-settings-btn { width: auto; padding: 0 12px; font-size: 15px; font-weight: 600;
    color: var(--mn-accent); letter-spacing: .5px; }
  #mn-bar { padding-right: 148px; }

  /* 自绘窗口控件：层级高于侧层面板，任何时候都能点 */
  #mn-winbtns {
    position: fixed; top: 0; right: 0; z-index: 1000; height: 48px;
    display: flex; align-items: stretch;
  }
  #mn-winbtns button {
    width: 46px; border: none; background: transparent; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    color: color-mix(in srgb, var(--mn-ink) 72%, transparent);
    transition: background .12s, color .12s;
    -webkit-app-region: no-drag;
  }
  #mn-winbtns button:hover {
    background: color-mix(in srgb, var(--mn-ink) 10%, transparent);
    color: var(--mn-ink);
  }
  #mn-winbtns button:active { background: color-mix(in srgb, var(--mn-ink) 16%, transparent); }
  #mn-winbtns #mn-win-close:hover { background: #e81123; color: #fff; }
  #mn-winbtns #mn-win-close:active { background: #c40f1e; }
  #mn-winbtns svg { width: 12px; height: 12px; }
  /* 拖拽带：只在顶栏可见时存在，不做 transform 动画，避免拖拽区残留。
     左右两端必须避开返回键和右侧按钮——app-region 的命中测试按矩形走，
     几何上被压住的按钮即使 z-index 更高也收不到点击 */
  #mn-dragstrip {
    position: fixed; top: 0; left: 110px; right: 292px; height: 48px;
    z-index: 800; -webkit-app-region: drag;
  }
  #mn-dragstrip.hidden { display: none; }

  /* ---- 侧层面板 ---- */
  .mn-panel {
    position: fixed; top: 0; bottom: 0; z-index: 950;
    background: color-mix(in srgb, var(--mn-page) 86%, transparent);
    -webkit-backdrop-filter: blur(28px) saturate(1.5);
    backdrop-filter: blur(28px) saturate(1.5);
    font-family: -apple-system, system-ui, 'Microsoft YaHei', sans-serif; font-size: 14px;
    color: var(--mn-ink); display: flex; flex-direction: column;
    transition: transform .3s cubic-bezier(.32,.72,.3,1);
  }
  .mn-panel.from-left { left: 0; width: 320px;
    box-shadow: 1px 0 0 color-mix(in srgb, var(--mn-ink) 8%, transparent),
                18px 0 40px rgba(0,0,0,.18); }
  .mn-panel.from-right { right: 0; width: 340px;
    box-shadow: -1px 0 0 color-mix(in srgb, var(--mn-ink) 8%, transparent),
                -18px 0 40px rgba(0,0,0,.18); }
  .mn-panel.hidden { transform: translateX(calc(-100% - 30px)); }
  .mn-panel.from-right.hidden { transform: translateX(calc(100% + 30px)); }
  .mn-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 6px; font-weight: 700; font-size: 19px;
  }
  .mn-panel.from-right .mn-panel-head { font-size: 17px; }
  .mn-x { border: none; background: transparent; cursor: pointer;
    color: color-mix(in srgb, var(--mn-ink) 55%, transparent);
    width: 30px; height: 30px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center; }
  .mn-x svg { width: 17px; height: 17px; }
  .mn-x:hover { background: color-mix(in srgb, var(--mn-ink) 8%, transparent); }

  /* iOS 分段控件（目录 / 书签） */
  .mn-seg-bar { display: flex; margin: 10px 16px 4px; padding: 2.5px;
    background: color-mix(in srgb, var(--mn-ink) 9%, transparent);
    border-radius: 10px; }
  .mn-seg-bar button {
    flex: 1; border: none; background: transparent; border-radius: 8px;
    padding: 6px 0; font-size: 13.5px; font-weight: 600; font-family: inherit;
    color: color-mix(in srgb, var(--mn-ink) 60%, transparent); cursor: pointer;
    transition: background .2s, color .2s, box-shadow .2s;
  }
  .mn-seg-bar button.on {
    background: var(--mn-page); color: var(--mn-ink);
    box-shadow: 0 1px 4px rgba(0,0,0,.12);
  }
  .mn-panel-body { flex: 1; overflow-y: auto; padding: 8px 12px 20px; }

  .mn-current {
    margin: 10px 16px 2px; padding: 9px 12px;
    border-radius: 10px; font-size: 12.5px; line-height: 1.4;
    background: color-mix(in srgb, var(--mn-accent) 12%, transparent);
    color: color-mix(in srgb, var(--mn-accent) 88%, var(--mn-ink));
    display: none;
  }
  .mn-current.show { display: block; }
  .mn-current .cur-label {
    font-size: 11px; font-weight: 600; opacity: .75; display: block; margin-bottom: 2px;
  }
  .mn-current .cur-name {
    font-weight: 600; font-size: 13.5px;
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .mn-toc-item {
    position: relative;
    display: block; width: 100%; text-align: left; border: none; background: transparent;
    padding: 10px 12px 10px 20px; border-radius: 10px; cursor: pointer; font-family: inherit;
    font-size: 14px; font-weight: 400;
    color: color-mix(in srgb, var(--mn-ink) 85%, transparent);
    line-height: 1.4;
  }
  .mn-toc-item:hover { background: color-mix(in srgb, var(--mn-ink) 6%, transparent); }
  .mn-toc-item.active {
    color: var(--mn-accent); font-weight: 600;
    background: color-mix(in srgb, var(--mn-accent) 10%, transparent);
  }
  .mn-toc-item.active::before {
    content: ''; position: absolute; left: 8px; top: 50%;
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--mn-accent); transform: translateY(-50%);
  }

  /* ---- 设置：iOS 分组卡片 ---- */
  .mn-group {
    background: color-mix(in srgb, var(--mn-ink) 5%, transparent);
    border-radius: 13px; margin: 14px 4px 0; overflow: hidden;
  }
  .mn-group-title {
    font-size: 12px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .4px; color: color-mix(in srgb, var(--mn-ink) 45%, transparent);
    padding: 0 14px; margin: 18px 0 7px;
  }
  .mn-set-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
  .mn-set-row + .mn-set-row {
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--mn-ink) 7%, transparent);
  }
  .mn-set-label { flex: 1; color: var(--mn-ink); font-size: 14.5px; }
  .mn-stepper { display: flex; align-items: center; gap: 14px; }
  .mn-stepper button {
    width: 30px; height: 30px; border-radius: 50%; border: none;
    background: color-mix(in srgb, var(--mn-ink) 9%, transparent);
    color: var(--mn-ink); font-size: 19px; line-height: 1; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .mn-stepper button:hover { background: color-mix(in srgb, var(--mn-ink) 15%, transparent); }
  .mn-stepper button:active { background: color-mix(in srgb, var(--mn-ink) 22%, transparent); }
  .mn-stepper .val { min-width: 52px; text-align: center;
    font-variant-numeric: tabular-nums; font-size: 14px; font-weight: 600; }
  .mn-seg { display: flex; gap: 3px; padding: 2.5px;
    background: color-mix(in srgb, var(--mn-ink) 9%, transparent);
    border-radius: 9px; }
  .mn-seg button {
    border: none; border-radius: 7px; padding: 6px 12px;
    background: transparent; font-size: 13px; font-weight: 500; font-family: inherit;
    color: color-mix(in srgb, var(--mn-ink) 60%, transparent); cursor: pointer;
    transition: background .2s, color .2s, box-shadow .2s;
  }
  .mn-seg button.on {
    background: var(--mn-page); color: var(--mn-ink); font-weight: 600;
    box-shadow: 0 1px 4px rgba(0,0,0,.12);
  }
  .mn-themes { display: flex; gap: 14px; padding: 4px 0; }
  .mn-theme { width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
    border: 2.5px solid transparent;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mn-ink) 14%, transparent),
               0 2px 6px rgba(0,0,0,.12);
    transition: transform .15s; position: relative;
  }
  .mn-theme:hover { transform: scale(1.08); }
  .mn-theme.on { border-color: var(--mn-accent); }
  .mn-theme.on::after {
    content: ''; position: absolute; inset: 0; margin: auto;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--mn-accent);
  }

  .mn-mask { position: fixed; inset: 0; z-index: 920;
    background: rgba(0,0,0,.18);
    animation: mn-fade .25s ease; }
  @keyframes mn-fade { from { opacity: 0; } to { opacity: 1; } }

  /* ---- 书签列表 ---- */
  .mn-bm-item { width: 100%; text-align: left; border: none; background: transparent; cursor: pointer;
    padding: 11px 12px; border-radius: 10px; font-family: inherit; display: block;
    transition: background .15s; }
  .mn-bm-item:hover { background: color-mix(in srgb, var(--mn-ink) 6%, transparent); }
  .mn-bm-chapter { font-size: 12px; color: color-mix(in srgb, var(--mn-ink) 50%, transparent);
    margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
  .mn-bm-text { font-size: 14px; line-height: 1.45;
    color: color-mix(in srgb, var(--mn-ink) 85%, transparent);
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .mn-bm-del {
    margin-left: auto; border: none; background: transparent; cursor: pointer;
    color: color-mix(in srgb, var(--mn-accent) 80%, transparent);
    font-size: 12.5px; font-family: inherit; padding: 2px 4px; border-radius: 6px; }
  .mn-bm-del:hover { background: color-mix(in srgb, var(--mn-accent) 14%, transparent); }
  .mn-empty {
    color: color-mix(in srgb, var(--mn-ink) 40%, transparent);
    text-align: center; padding: 56px 24px; font-size: 13.5px; line-height: 1.7; }
  *::-webkit-scrollbar { width: 8px; }
  *::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--mn-ink) 18%, transparent);
    border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
  *::-webkit-scrollbar-track { background: transparent; }
  `
  const styleEl = document.createElement('style')
  styleEl.textContent = css
  document.head.appendChild(styleEl)

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    bookmarkFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    winMin: '<svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor"/></svg>',
    winMax: '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    winRestore: '<svg viewBox="0 0 12 12"><rect x="3.5" y="2" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5 2.5V4H2.5v5.5H7V8" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>',
    winClose: '<svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>'
  }

  const ui = document.createElement('div')
  ui.innerHTML = `
  <div id="mn-bar">
    <button class="mn-btn" id="mn-back" title="返回书架">${ICON.back}<span class="back-label">书库</span></button>
    <div id="mn-chapter"></div>
    <button class="mn-btn" id="mn-bookmark-btn" title="添加/移除本页书签">${ICON.bookmark}</button>
    <button class="mn-btn" id="mn-toc-btn" title="目录与书签">${ICON.list}</button>
    <button class="mn-btn" id="mn-settings-btn" title="阅读设置">Aa</button>
  </div>

  <div id="mn-dragstrip"></div>
  <div id="mn-winbtns">
    <button id="mn-win-min" title="最小化">${ICON.winMin}</button>
    <button id="mn-win-max" title="最大化/还原">${ICON.winMax}</button>
    <button id="mn-win-close" title="关闭">${ICON.winClose}</button>
  </div>

  <div class="mn-panel from-left hidden" id="mn-toc-panel">
    <div class="mn-panel-head"><span id="mn-toc-title">目录</span><button class="mn-x" data-close="toc">${ICON.close}</button></div>
    <div class="mn-seg-bar">
      <button data-tab="toc" class="on">目录</button>
      <button data-tab="bookmarks">书签</button>
    </div>
    <div class="mn-current" id="mn-current-chapter"></div>
    <div class="mn-panel-body" id="mn-toc-body"></div>
    <div class="mn-panel-body hidden" id="mn-bookmarks-body" style="display:none"></div>
  </div>

  <div class="mn-panel from-right hidden" id="mn-settings-panel">
    <div class="mn-panel-head"><span>阅读设置</span><button class="mn-x" data-close="settings">${ICON.close}</button></div>
    <div class="mn-panel-body" style="padding-top:0">
      <div class="mn-group-title">文字排版</div>
      <div class="mn-group">
        <div class="mn-set-row">
          <span class="mn-set-label">字号</span>
          <div class="mn-stepper">
            <button data-step="fontSize" data-d="-0.1">${ICON.minus}</button>
            <span class="val" id="mn-val-fontSize"></span>
            <button data-step="fontSize" data-d="0.1">${ICON.plus}</button>
          </div>
        </div>
        <div class="mn-set-row">
          <span class="mn-set-label">行距</span>
          <div class="mn-stepper">
            <button data-step="spacing" data-d="-0.1">${ICON.minus}</button>
            <span class="val" id="mn-val-spacing"></span>
            <button data-step="spacing" data-d="0.1">${ICON.plus}</button>
          </div>
        </div>
        <div class="mn-set-row">
          <span class="mn-set-label">左右边距</span>
          <div class="mn-stepper">
            <button data-step="sideMargin" data-d="-1">${ICON.minus}</button>
            <span class="val" id="mn-val-sideMargin"></span>
            <button data-step="sideMargin" data-d="1">${ICON.plus}</button>
          </div>
        </div>
      </div>

      <div class="mn-group">
        <div class="mn-set-row">
          <span class="mn-set-label">翻页方式</span>
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
      </div>

      <div class="mn-group-title">主题</div>
      <div class="mn-group">
        <div class="mn-set-row">
          <div class="mn-themes" id="mn-themes"></div>
        </div>
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
    const root = document.documentElement.style
    root.setProperty('--mn-page', local.backgroundColor)
    root.setProperty('--mn-ink', local.fontColor)
    // 深色阅读主题用亮橙强调色，浅色用纸黄系橙色
    root.setProperty('--mn-accent', isDark(local.backgroundColor) ? '#e8873d' : '#d1622a')
    refreshSettingsUI()
    // foliate 运行时尚未就绪时（prefs 早于 onLoadEnd 回灌）只更新宿主 UI 状态，
    // 等书籍加载完成后由 foliate 自行读取，避免 changeStyle 未定义导致整次回灌中断
    if (typeof window.changeStyle === 'function') {
      window.changeStyle({
        fontSize: round(local.fontSize),
        spacing: round(local.spacing),
        sideMargin: local.sideMargin,
        pageTurnStyle: local.pageTurnStyle,
        fontColor: local.fontColor,
        backgroundColor: local.backgroundColor,
        maxColumnCount: local.maxColumnCount
      })
      if (local.pageTurnStyle === 'scroll') window.setScroll?.()
      else if (local.pageTurnStyle === 'noAnimation') window.setNoAnimation?.()
      else window.setPaginated?.()
    }
    void window.mook.prefs.set('readerStyle', local)
  }
  const round = (n) => Math.round(n * 100) / 100

  // 用感知亮度判断深色主题（sRGB 近似）
  function isDark(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
    if (!m) return false
    const n = parseInt(m[1], 16)
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
    return lum < 0.5
  }

  function refreshSettingsUI() {
    $('mn-val-fontSize').textContent = Math.round(local.fontSize * 100) + '%'
    $('mn-val-spacing').textContent = local.spacing.toFixed(1)
    $('mn-val-sideMargin').textContent = local.sideMargin + '%'
    document.querySelectorAll('#mn-turn button').forEach((b) =>
      b.classList.toggle('on', b.dataset.turn === local.pageTurnStyle)
    )
    document.querySelectorAll('#mn-cols button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.cols) === local.maxColumnCount)
    )
    document.querySelectorAll('.mn-theme').forEach((el) =>
      el.classList.toggle('on', el.dataset.bg === local.backgroundColor)
    )
  }

  // 主题色点
  const THEME_NAMES = ['纸张', '纯白', '护眼', '夜间']
  const themesBox = $('mn-themes')
  THEMES.forEach((t, i) => {
    const el = document.createElement('div')
    el.className = 'mn-theme'
    el.dataset.bg = t.bg
    el.style.background = t.bg
    el.title = THEME_NAMES[i] || t.bg
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
  const panels = { toc: $('mn-toc-panel'), settings: $('mn-settings-panel') }
  const tocBody = $('mn-toc-body')
  const bmBody = $('mn-bookmarks-body')
  let leftTab = 'toc'

  function switchTab(tab) {
    leftTab = tab
    tocBody.style.display = tab === 'toc' ? '' : 'none'
    bmBody.style.display = tab === 'bookmarks' ? '' : 'none'
    ui.querySelectorAll('.mn-seg-bar button').forEach((b) =>
      b.classList.toggle('on', b.dataset.tab === tab)
    )
    $('mn-toc-title').textContent = tab === 'toc' ? '目录' : '书签'
    if (tab === 'toc') renderToc()
    else void renderBookmarks()
    updateCurrentHint()
  }
  function updateCurrentHint() {
    const el = $('mn-current-chapter')
    if (!el) return
    if (leftTab !== 'toc') {
      el.classList.remove('show')
      return
    }
    const name = currentChapter || lastLocation?.tocItem?.label || ''
    if (name) {
      el.classList.add('show')
      el.innerHTML =
        '<span class="cur-label">正在阅读</span><span class="cur-name"></span>'
      el.querySelector('.cur-name').textContent = name
    } else {
      el.classList.remove('show')
    }
  }
  ui.querySelectorAll('.mn-seg-bar button').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab)
  })

  function syncDragstrip() {
    // 拖拽带只在「顶栏可见且没有打开面板」时存在：
    // 面板头部与拖拽带几何重叠，会被 app-region 吞掉点击
    const anyPanel = Object.values(panels).some((p) => !p.classList.contains('hidden'))
    $('mn-dragstrip').classList.toggle('hidden', !barVisible || anyPanel)
  }
  function closePanels() {
    Object.values(panels).forEach((p) => p.classList.add('hidden'))
    document.querySelectorAll('.mn-mask').forEach((m) => m.remove())
    syncDragstrip()
  }
  function openPanel(name) {
    const isOpen = !panels[name].classList.contains('hidden')
    closePanels()
    if (isOpen) return
    const p = panels[name]
    p.classList.remove('hidden')
    syncDragstrip()
    const mask = document.createElement('div')
    mask.className = 'mn-mask'
    mask.onclick = closePanels
    document.body.appendChild(mask)
    if (name === 'toc') switchTab(leftTab)
  }
  $('mn-toc-btn').onclick = () => openPanel('toc')
  $('mn-settings-btn').onclick = () => openPanel('settings')
  ui.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => closePanels()
  })
  $('mn-back').onclick = () => window.mook.reader.backShelf()

  // 自绘窗口控件（无边框窗口）
  $('mn-win-min').onclick = () => window.mook.window.minimize()
  $('mn-win-max').onclick = () => window.mook.window.toggleMaximize()
  $('mn-win-close').onclick = () => window.mook.window.close()
  window.mook.window.onMaximizedChange((max) => {
    $('mn-win-max').innerHTML = max ? ICON.winRestore : ICON.winMax
  })
  $('mn-bookmark-btn').onclick = async () => {
    // foliate 在每次 relocate 时给出当前页是否已有书签（CFI 精确到页）
    const cfi = lastLocation?.bookmark?.cfi
    if (cfi) {
      // 删除当前页这一条书签；书签面板打开时同步刷新列表
      await window.mook.reader.removeBookmark(bookId, cfi)
      window.removeAnnotation(cfi)
      if (!panels.toc.classList.contains('hidden') && leftTab === 'bookmarks') {
        void renderBookmarks()
      }
    } else {
      window.addBookmarkHere()
    }
  }

  // ---------- 目录 ----------
  // 去掉锚点只比较文档部分（OEBPS/text/ch1.xhtml）
  const docPart = (href) => (href || '').split('#')[0]
  // 判断某目录项是否为当前章节：优先 tocItem 精确/文档匹配，
  // 拿不到 tocItem 时退回用章节标题比对 label
  function isCurrentChapter(it) {
    const cur = lastLocation?.tocItem
    if (cur?.href && it.href) {
      if (cur.href === it.href) return true
      if (docPart(cur.href) && docPart(cur.href) === docPart(it.href)) return true
    }
    if (currentChapter && it.label && currentChapter.trim() === String(it.label).trim()) return true
    return false
  }

  function renderToc() {
    const body = $('mn-toc-body')
    body.innerHTML = ''
    if (!toc.length) {
      body.innerHTML = '<div class="mn-empty">本书没有目录</div>'
      return
    }
    let activeEl = null
    const walk = (items, depth) => {
      for (const it of items) {
        const btn = document.createElement('button')
        btn.className = 'mn-toc-item'
        btn.style.paddingLeft = 20 + (depth - 1) * 14 + 'px'
        btn.textContent = it.label
        // 深层子项的 active 优先级更高（更精确），后命中的覆盖
        if (isCurrentChapter(it)) {
          btn.classList.add('active')
          activeEl = btn
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
    // 打开目录时自动定位到当前章节：等进场动画结束后只滚列表自身
    // （动画进行中触碰滚动会打断 transform 过渡，让面板卡在隐藏位置；
    // scrollIntoView 还会连带滚动所有祖先，同样不能用）
    if (activeEl) {
      setTimeout(() => {
        if (!body.isConnected) return
        const b = body.getBoundingClientRect()
        const a = activeEl.getBoundingClientRect()
        body.scrollTop += a.top - b.top - b.height / 2 + a.height / 2
      }, 340)
    }
  }

  // ---------- 书签 ----------
  // 按钮高亮直接用 foliate 回传的当前页书签状态（lastLocation.bookmark），
  // 精确到渲染页而非整个章节文档
  function refreshBookmarkBtn() {
    const on = !!lastLocation?.bookmark?.exists
    $('mn-bookmark-btn').classList.toggle('on', on)
    $('mn-bookmark-btn').innerHTML = on ? ICON.bookmarkFill : ICON.bookmark
  }

  async function renderBookmarks() {
    const body = $('mn-bookmarks-body')
    body.innerHTML = '<div class="mn-empty">加载中…</div>'
    const list = await window.mook.reader.annotations(bookId)
    refreshBookmarkBtn()
    if (!list.length) {
      body.innerHTML = '<div class="mn-empty">还没有书签<br>阅读时点顶部的书签图标即可添加</div>'
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
      refreshBookmarkBtn()
      updateCurrentHint()
      scheduleSave()
    } else if (name === 'onSetToc') {
      toc = data || []
    } else if (name === 'onLoadEnd') {
      loadFired = true
      if (!hasInitialCfi) window.goToPercent(0)
      // 回灌书签（foliate 用它识别当前页是否已加书签）
      const list = await window.mook.reader.annotations(bookId)
      list.forEach((a) => {
        window.addAnnotation({ id: a.id, value: a.value, type: a.type, color: a.color, note: a.note })
      })
      refreshBookmarkBtn()
    } else if (name === 'handleBookmark') {
      const res = await window.mook.reader.toggleBookmark(bookId, {
        remove: data.remove,
        detail: data.detail,
        chapterTitle: currentChapter || null
      })
      if (res.action === 'added') {
        if (lastLocation) {
          lastLocation.bookmark = { exists: true, cfi: data.detail.cfi, id: res.id }
        }
        window.addAnnotation({
          id: res.id, value: data.detail.cfi, type: 'bookmark', color: '#e8a33d', note: data.detail.content
        })
      } else {
        if (lastLocation) {
          lastLocation.bookmark = { exists: false, cfi: null, id: null }
        }
        window.removeAnnotation(data.detail.cfi)
      }
      refreshBookmarkBtn()
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
    syncDragstrip()
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') window.prevPage()
    else if (e.key === 'ArrowRight' || e.key === ' ') window.nextPage()
    else if (e.key === 'Escape') closePanels()
  })
})()
