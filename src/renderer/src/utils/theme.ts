import { ref } from 'vue'

// 内置字体与图标资源（src/assets），由 Vite 打包成可访问 URL
import oppoUrl from '../../../assets/fonts/OPPO Sans 4.0.ttf'
import fangUrl from '../../../assets/fonts/AlimamaFangYuanTiVF-Thin-2.ttf'
import smileyUrl from '../../../assets/fonts/SmileySans-Oblique.ttf'

const SYSTEM_FONT_STACK =
  "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"

interface FontOption {
  key: string
  label: string
  /** 一句话风格描述 */
  desc: string
  /** @font-face 注册名（系统默认项为完整字体栈） */
  family: string
  url: string | null
}

export const FONT_OPTIONS: FontOption[] = [
  {
    key: 'system',
    label: '系统默认',
    desc: '跟随系统，清爽耐看',
    family: SYSTEM_FONT_STACK,
    url: null
  },
  {
    key: 'oppo',
    label: 'OPPO Sans',
    desc: '现代黑体，简洁通用',
    family: "'MookFontOPPO'",
    url: oppoUrl
  },
  {
    key: 'fangyuan',
    label: '阿里妈妈方圆体',
    desc: '方圆结合，圆润可爱',
    family: "'MookFontFangYuan'",
    url: fangUrl
  },
  {
    key: 'smiley',
    label: '得意黑 Smiley Sans',
    desc: '倾斜有力，个性醒目',
    family: "'MookFontSmiley'",
    url: smileyUrl
  }
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


