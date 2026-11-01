import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import router from './router'
import './styles.css'
import { applyFont } from './utils/theme'

// 独立窗口（悬浮球/面板/选区）也会加载本入口。必须在首帧渲染前把皮肤 data-skin 写上、
// 字体栈应用好，否则悬浮球会先用默认外观画一帧再跳变。设置页改皮肤/字体后主进程会广播。
async function bootstrap(): Promise<void> {
  try {
    const [skin, font] = await Promise.all([
      window.mook.prefs.get<string>('uiSkin', 'default'),
      window.mook.prefs.get<string>('uiFont', 'system')
    ])
    document.documentElement.dataset.skin = skin
    applyFont(font)
    window.mook.prefs.onUiChanged((key, value) => {
      if (key === 'uiSkin') document.documentElement.dataset.skin = String(value)
      else if (key === 'uiFont') applyFont(String(value))
    })
  } catch {
    // prefs 不可用时回退默认外观
  }
  createApp(App).use(createPinia()).use(router).use(naive).mount('#app')
}

void bootstrap()

// 本地图片加载失败（文件缺失/损坏）时，统一替换为灰色占位图，避免出现裂图图标
const BROKEN_IMG_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#e9ebf0"/>
      <path d="M28 70l20-22 13 14 9-10 14 18H28z" fill="#c4cad6"/>
      <circle cx="38" cy="38" r="6" fill="#c4cad6"/>
    </svg>`
  )

document.addEventListener(
  'error',
  (e) => {
    const target = e.target
    if (!(target instanceof HTMLImageElement)) return
    if (!target.src.startsWith('mookimg:')) return
    if (target.dataset.imgFallback === '1') return
    target.dataset.imgFallback = '1'
    target.src = BROKEN_IMG_PLACEHOLDER
  },
  true
)

// naive-ui 图片预览自带的「下载」按钮默认会把顶层页面导航到图片地址，
// 对 mookimg 自定义协议会导致应用外壳被黑底图片替换（看似卡死）。
// 这里在捕获阶段拦截该按钮，改为弹出系统「另存为」复制到用户指定目录。
document.addEventListener(
  'click',
  (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const toolbar = target.closest('.n-image-preview-toolbar')
    if (!toolbar) return
    const icons = [...toolbar.querySelectorAll('.n-base-icon')]
    // 工具栏顺序固定：…、下载（倒数第二个）、关闭（最后一个）
    const downloadIcon = icons[icons.length - 2]
    if (!downloadIcon || !downloadIcon.contains(target)) return

    const box = document.querySelector('.n-image-preview-container')
    const img = box ? box.querySelector('img[src^="mookimg:"]') : null
    const src = img?.getAttribute('src') ?? ''
    if (!src) return

    e.preventDefault()
    e.stopImmediatePropagation()
    const name = decodeURIComponent(src.split('/').pop() || 'image.jpg')
    void window.mook.image.saveAs(src, name)
  },
  true
)
