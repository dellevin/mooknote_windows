import { ref } from 'vue'

export interface SkinDef {
  key: string
  label: string
  /** 预览块背景色 */
  swatch: string
  /** 预览块上 M 水印的颜色 */
  glyph: string
  /** 主按钮/控件强调色 */
  primary: string
  primaryHover: string
  primaryPressed: string
  /** 强调色上的文字/图标色 */
  onPrimary: string
  /** 浅色表面上作为文字/描边使用的强调墨色（黑皮肤下不能用近白，会看不见） */
  ink: string
}

export const SKINS: SkinDef[] = [
  {
    key: 'default',
    label: '简约白',
    swatch: '#ffffff',
    glyph: '#1f2329',
    primary: '#1f2329',
    primaryHover: '#3a3f45',
    primaryPressed: '#000000',
    onPrimary: '#ffffff',
    ink: '#1f2329'
  },
  {
    key: 'black',
    label: '深邃黑',
    swatch: '#1a1a23',
    glyph: '#00b578',
    primary: '#00b578',
    primaryHover: '#1fc98f',
    primaryPressed: '#009a66',
    onPrimary: '#ffffff',
    ink: '#00996a'
  },
  {
    key: 'red',
    label: '网易红',
    swatch: '#ff3a3a',
    glyph: '#ffc2c2',
    primary: '#ff3a3a',
    primaryHover: '#ff6363',
    primaryPressed: '#e02424',
    onPrimary: '#ffffff',
    ink: '#ff3a3a'
  },
  {
    key: 'blue',
    label: '腾讯蓝',
    swatch: '#0052d9',
    glyph: '#a8c4f5',
    primary: '#0052d9',
    primaryHover: '#2e6ee0',
    primaryPressed: '#003fb0',
    onPrimary: '#ffffff',
    ink: '#0052d9'
  }
]

function skinByKey(key: string | null | undefined): SkinDef {
  return SKINS.find((s) => s.key === key) ?? SKINS[0]
}

/** 当前皮肤（设置页选中态共享） */
export const currentSkin = ref<SkinDef>(SKINS[0])

export async function initSkin(): Promise<void> {
  const key = await window.mook.prefs.get<string>('uiSkin', 'default')
  applySkin(key, false)
}

/** 皮肤只改变左侧边栏底色（通过 :root[data-skin] 令牌），不影响内容区与控件主题 */
export async function applySkin(key: string, persist = true): Promise<void> {
  const def = skinByKey(key)
  currentSkin.value = def
  document.documentElement.dataset.skin = def.key
  if (persist) await window.mook.prefs.set('uiSkin', def.key)
}
