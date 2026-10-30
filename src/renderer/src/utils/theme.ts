import { ref } from 'vue'

// 内置字体与图标资源（src/assets），由 Vite 打包成可访问 URL
import oppoUrl from '../../../assets/fonts/OPPO Sans 4.0.ttf'
import fangUrl from '../../../assets/fonts/AlimamaFangYuanTiVF-Thin-2.ttf'
import smileyUrl from '../../../assets/fonts/SmileySans-Oblique.ttf'
import icon1Url from '../../../assets/icon/app_icon.webp'
import icon2Url from '../../../assets/icon/app_icon2.webp'
import iconMUrl from '../../../assets/icon/app_icon_m.png'
import defaultIconUrl from '../../../../build/icon.png'

const SYSTEM_FONT_STACK =
  "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"

interface FontOption {
  key: string
  label: string
  /** @font-face 注册名（系统默认项为完整字体栈） */
  family: string
  url: string | null
  /**
   * 预览方块的垂直补偿（em）：各字体 win 度量上下留白不对称，
   * 字形在 em 方框内的视觉位置不一致，用 translateY 拉齐到系统字体基准。
   */
  yOffset: number
}

export const FONT_OPTIONS: FontOption[] = [
  { key: 'system', label: '系统默认', family: SYSTEM_FONT_STACK, url: null, yOffset: 0 },
  { key: 'oppo', label: 'OPPO Sans', family: "'MookFontOPPO'", url: oppoUrl, yOffset: 0.04 },
  { key: 'fangyuan', label: '阿里妈妈方圆体', family: "'MookFontFangYuan'", url: fangUrl, yOffset: -0.025 },
  { key: 'smiley', label: '得意黑 Smiley Sans', family: "'MookFontSmiley'", url: smileyUrl, yOffset: 0.06 }
]

function fontOption(key: string | null | undefined): FontOption {
  return FONT_OPTIONS.find((f) => f.key === key) ?? FONT_OPTIONS[0]
}

/** 当前生效的完整字体栈，供 naive-ui themeOverrides 使用 */
export const currentFontStack = ref(SYSTEM_FONT_STACK)

function ensureStyle(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  return el
}

/** 注入 @font-face 并把字体栈写到 body 与 --app-font，返回完整字体栈 */
export function applyFont(key: string | null | undefined): string {
  const opt = fontOption(key)
  const stack = opt.url ? `${opt.family}, ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK

  ensureStyle('mook-font-face').textContent = opt.url
    ? `@font-face{font-family:${opt.family};src:url('${opt.url}') format('truetype');font-display:swap;}`
    : ''
  // styles.css 把系统字体栈声明在了 html/body/#app 三个选择器上；
  // 只覆盖 body 时，#app 仍用自身声明值（不继承 body），应用内文字不会变。
  // 必须连同 #app 一起覆盖。
  ensureStyle('mook-font-body').textContent =
    `html, body, #app{font-family:${stack} !important;}`
  document.documentElement.style.setProperty('--app-font', stack)
  currentFontStack.value = stack
  return stack
}

/**
 * 预注册全部内置字体的 @font-face，使设置页的字体方块预览在未选中时也能按各自字形渲染。
 * 独立于 applyFont（后者只注入当前选中字体并覆盖全局字体栈）。
 */
export function preloadFontFaces(): void {
  const css = FONT_OPTIONS.filter((f) => f.url)
    .map(
      (f) =>
        `@font-face{font-family:${f.family};src:url('${f.url}') format('truetype');font-display:swap;}`
    )
    .join('\n')
  ensureStyle('mook-font-faces-all').textContent = css
}

/** 字体预览方块使用的字体栈：内置字体回退到系统栈，避免生僻字缺字 */
export function fontPreviewStack(opt: FontOption): string {
  return opt.url ? `${opt.family}, ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK
}

interface IconOption {
  key: string
  label: string
  url: string
}

export const ICON_OPTIONS: IconOption[] = [
  { key: 'default', label: '默认图标', url: defaultIconUrl },
  { key: 'app_icon', label: '图标一', url: icon1Url },
  { key: 'app_icon2', label: '图标二', url: icon2Url },
  { key: 'app_icon_m', label: '图标 M', url: iconMUrl }
]

function iconOption(key: string | null | undefined): IconOption {
  return ICON_OPTIONS.find((i) => i.key === key) ?? ICON_OPTIONS[0]
}

/** 读取图片并栅格化为 256×256 PNG（webp 等格式主进程 nativeImage 无法可靠解码） */
function rasterizePng(url: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 不可用'))
        return
      }
      // 等比缩放居中，铺满画布（图标素材均为方形近似，cover 裁切可接受）
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('图标加载失败'))
    img.src = url
  })
}

/** 设置窗口/任务栏图标 */
export async function applyIcon(key: string | null | undefined): Promise<void> {
  const opt = iconOption(key)
  const png = await rasterizePng(new URL(opt.url, window.location.href).href)
  await window.mook.window.setIcon(png)
}
