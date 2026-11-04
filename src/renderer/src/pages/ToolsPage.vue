<script setup lang="ts">
// 「探索 - 功能」：在主窗口内直接发起 OCR / 截屏 / 取色，结果在本页展示。
import { computed, onMounted, ref } from 'vue'
import { NModal } from 'naive-ui'
import type { OcrLine, PickedColor } from '@shared/types'

function closeResult(): void {
  resultKind.value = ''
}

const busy = ref<'' | 'ocr' | 'shot' | 'color' | 'reader'>('')
const resultKind = ref<'' | 'ocr' | 'color'>('')
const lines = ref<OcrLine[]>([])
const errorMsg = ref('')
const picked = ref<PickedColor | null>(null)
const cloudReady = ref(false)
const toast = ref('')
const savingNote = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

// ─── 取色历史调色板（prefs 持久化） ───
const COLOR_HISTORY_KEY = 'colorPickerHistory'
const COLOR_HISTORY_MAX = 24
const colorHistory = ref<PickedColor[]>([])

async function loadColorHistory(): Promise<void> {
  try {
    const list = await window.mook.prefs.get<PickedColor[]>(COLOR_HISTORY_KEY, [])
    colorHistory.value = Array.isArray(list) ? list : []
  } catch {
    colorHistory.value = []
  }
}
// IPC 结构化克隆无法传递 Vue reactive Proxy，写入前转成普通对象数组
function plainHistory(): PickedColor[] {
  return colorHistory.value.map((x) => ({ r: x.r, g: x.g, b: x.b, hex: x.hex }))
}
async function pushColorHistory(c: PickedColor): Promise<void> {
  const rest = colorHistory.value.filter((x) => x.hex.toLowerCase() !== c.hex.toLowerCase())
  colorHistory.value = [c, ...rest].slice(0, COLOR_HISTORY_MAX)
  void window.mook.prefs.set(COLOR_HISTORY_KEY, plainHistory())
}
async function removeColor(c: PickedColor, e: MouseEvent): Promise<void> {
  e.stopPropagation()
  colorHistory.value = colorHistory.value.filter((x) => x.hex !== c.hex)
  await window.mook.prefs.set(COLOR_HISTORY_KEY, plainHistory())
}
async function clearColors(): Promise<void> {
  colorHistory.value = []
  await window.mook.prefs.set(COLOR_HISTORY_KEY, [])
}

// 发起各工具时是否先隐藏主窗口（避免把应用自身拍进冻结画面）
const hideOcr = ref(true)
const hideShot = ref(true)
const hideColor = ref(true)
async function bindHide(key: string, refV: { value: boolean }): Promise<void> {
  refV.value = (await window.mook.prefs.get<boolean>(key, true)) !== false
}
function onHideToggle(key: string, v: boolean): void {
  void window.mook.prefs.set(key, v)
}

const resultText = computed(() => lines.value.map((l) => l.text).join('\n'))

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1600)
}

async function startOcr(): Promise<void> {
  if (busy.value || !cloudReady.value) return
  busy.value = 'ocr'
  errorMsg.value = ''
  try {
    const res = await window.mook.ocr.capture()
    if (res === null) return
    lines.value = res
    resultKind.value = 'ocr'
  } catch (e) {
    lines.value = []
    errorMsg.value = '识别失败：' + String(e)
    resultKind.value = 'ocr'
  } finally {
    busy.value = ''
  }
}

async function startShot(): Promise<void> {
  if (busy.value) return
  busy.value = 'shot'
  try {
    // 保存 / 钉住 / 取消都不会带回文字；只有点「提取文字」才在本页显示结果
    const res = await window.mook.shot.capture()
    if (!res.canceled && res.lines) {
      errorMsg.value = ''
      lines.value = res.lines
      resultKind.value = 'ocr'
    }
  } finally {
    busy.value = ''
  }
}

async function startColor(): Promise<void> {
  if (busy.value) return
  busy.value = 'color'
  try {
    const res = await window.mook.color.capture()
    if (!res.canceled && res.color) {
      // 先显示结果，再写历史；历史持久化失败不应阻断结果卡片
      picked.value = res.color
      resultKind.value = 'color'
      await pushColorHistory(res.color).catch(() => {})
    }
  } finally {
    busy.value = ''
  }
}

async function openReader(): Promise<void> {
  if (busy.value) return
  busy.value = 'reader'
  try {
    await window.mook.reader.open()
  } finally {
    busy.value = ''
  }
}

async function copyText(text: string): Promise<void> {
  const { ok } = await window.mook.ocr.copyText(text)
  showToast(ok ? '复制成功' : '复制失败')
}

// OCR 识别结果一键转存为笔记
async function saveAsNote(): Promise<void> {
  const text = resultText.value
  if (!text.trim() || savingNote.value) return
  savingNote.value = true
  try {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
      now.getHours()
    )}:${pad(now.getMinutes())}`
    await window.mook.note.create({
      id: await window.mook.note.newId(),
      title: `OCR 识别 ${stamp}`,
      content: text,
      contentType: 'markdown',
      tags: ['OCR'],
      images: [],
      isPinned: false
    })
    showToast('已转存为笔记')
  } catch (e) {
    showToast('转存失败：' + String(e))
  } finally {
    savingNote.value = false
  }
}

function useHistoryColor(c: PickedColor): void {
  picked.value = c
  resultKind.value = 'color'
}

const colorRgb = computed(() => {
  const c = picked.value
  return c ? `RGB(${c.r}, ${c.g}, ${c.b})` : ''
})
const colorHsl = computed(() => {
  const c = picked.value
  if (!c) return ''
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return `HSL(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
})

onMounted(async () => {
  await bindHide('hideMainOnOcr', hideOcr)
  await bindHide('hideMainOnShot', hideShot)
  await bindHide('hideMainOnColor', hideColor)
  await loadColorHistory()
  try {
    const cfg = await window.mook.ocr.cloudConfig()
    cloudReady.value = !!cfg.configured
  } catch {
    cloudReady.value = false
  }
})
</script>

<template>
  <div class="page">
    <h2 class="title">工具栏</h2>

    <div class="grid">
      <div class="tool-card" :class="{ disabled: !!busy }">
        <button class="tc-main" :disabled="!!busy" @click="openReader">
          <span class="tc-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 5a2 2 0 0 1 2-2h7v16H4a2 2 0 0 0-2 2z" />
              <path d="M22 5a2 2 0 0 0-2-2h-7v16h7a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span class="tc-text">
            <span class="tc-name">阅读器</span>
            <span class="tc-desc">{{ busy === 'reader' ? '正在打开…' : '阅读 EPUB / PDF / TXT 等书籍' }}</span>
          </span>
        </button>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy || !cloudReady }">
        <button class="tc-main" :disabled="!!busy || !cloudReady" @click="startOcr">
          <span class="tc-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z" />
            </svg>
          </span>
          <span class="tc-text">
            <span class="tc-name">OCR</span>
            <span class="tc-desc">{{ busy === 'ocr' ? '正在截屏…' : '框选屏幕区域识别文字' }}</span>
          </span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>识别时隐藏主窗口</span>
          <span class="switch">
            <input type="checkbox" v-model="hideOcr" @change="onHideToggle('hideMainOnOcr', hideOcr)" />
            <span class="track"></span>
          </span>
        </label>
        <div v-if="!cloudReady" class="tc-warn">当前 OCR 配置暂不可用，请重新尝试</div>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy }">
        <button class="tc-main" :disabled="!!busy" @click="startShot">
          <span class="tc-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
          </span>
          <span class="tc-text">
            <span class="tc-name">截屏</span>
            <span class="tc-desc">{{ busy === 'shot' ? '正在截屏…' : '截屏标注、保存或钉在桌面' }}</span>
          </span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>截屏时隐藏主窗口</span>
          <span class="switch">
            <input type="checkbox" v-model="hideShot" @change="onHideToggle('hideMainOnShot', hideShot)" />
            <span class="track"></span>
          </span>
        </label>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy }">
        <button class="tc-main" :disabled="!!busy" @click="startColor">
          <span class="tc-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a7 7 0 0 0-7 7c0 4 7 11 7 11s7-7 7-11a7 7 0 0 0-7-7z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
          </span>
          <span class="tc-text">
            <span class="tc-name">取色</span>
            <span class="tc-desc">{{ busy === 'color' ? '正在取色…' : '拾取屏幕任意像素颜色' }}</span>
          </span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>取色时隐藏主窗口</span>
          <span class="switch">
            <input type="checkbox" v-model="hideColor" @change="onHideToggle('hideMainOnColor', hideColor)" />
            <span class="track"></span>
          </span>
        </label>
      </div>
    </div>

    <!-- OCR 结果弹窗 -->
    <NModal
      :show="resultKind === 'ocr'"
      :auto-focus="false"
      @update:show="(v: boolean) => { if (!v) closeResult() }"
    >
      <div class="dlg dlg-ocr">
        <div class="dlg-head">
          <span class="dlg-ic">文</span>
          <span class="dlg-title">OCR 识别结果</span>
          <button class="dlg-close" @click="closeResult">✕</button>
        </div>
        <div class="dlg-body">
          <div v-if="errorMsg" class="r-error">{{ errorMsg }}</div>
          <div v-else-if="!lines.length" class="r-empty">选区内没有识别到文字</div>
          <textarea v-else class="r-text" readonly :value="resultText"
            @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
        </div>
        <div class="dlg-foot">
          <button
            class="btn btn-ghost"
            :disabled="!lines.length || savingNote"
            @click="saveAsNote"
          >
            {{ savingNote ? '保存中…' : '转存为笔记' }}
          </button>
          <button class="btn" :disabled="!lines.length" @click="copyText(resultText)">复制全部</button>
        </div>
      </div>
    </NModal>

    <!-- 取色结果弹窗 -->
    <NModal
      :show="resultKind === 'color' && !!picked"
      :auto-focus="false"
      @update:show="(v: boolean) => { if (!v) closeResult() }"
    >
      <div v-if="picked" class="dlg dlg-color">
        <div class="dlg-head">
          <span class="dlg-ic dlg-ic-dot" :style="{ background: picked.hex }"></span>
          <span class="dlg-title">取色结果</span>
          <button class="dlg-close" @click="closeResult">✕</button>
        </div>
        <div class="dlg-body">
          <div class="color-body">
            <div class="swatch" :style="{ background: picked.hex }"></div>
            <div class="color-rows">
              <button class="color-row" @click="copyText(picked.hex)">
                <span class="cr-label">HEX</span>
                <span class="cr-val">{{ picked.hex }}</span>
              </button>
              <button class="color-row" @click="copyText(colorRgb)">
                <span class="cr-label">RGB</span>
                <span class="cr-val">{{ colorRgb }}</span>
              </button>
              <button class="color-row" @click="copyText(colorHsl)">
                <span class="cr-label">HSL</span>
                <span class="cr-val">{{ colorHsl }}</span>
              </button>
            </div>
          </div>

          <!-- 历史调色板 -->
          <div v-if="colorHistory.length" class="palette">
            <div class="pal-head">
              <span class="pal-title">调色板 · {{ colorHistory.length }}</span>
              <button class="pal-clear" @click="clearColors">清空</button>
            </div>
            <div class="pal-grid">
              <button
                v-for="c in colorHistory"
                :key="c.hex"
                type="button"
                class="pal-cell"
                :class="{ on: picked && picked.hex === c.hex }"
                :title="`${c.hex} · 点击查看并复制`"
                @click="useHistoryColor(c); copyText(c.hex)"
              >
                <span class="pal-swatch" :style="{ background: c.hex }"></span>
                <span class="pal-hex">{{ c.hex }}</span>
                <span class="pal-del" title="移除" @click.stop="removeColor(c, $event)">✕</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </NModal>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  padding: 24px 28px;
}
.title {
  margin: 0 0 20px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-strong, #1f2329);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.tool-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.06));
  background: color-mix(in srgb, var(--surface, #fff) 70%, transparent);
  color: var(--text-strong, #1f2329);
  font-family: inherit;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.tool-card:hover:not(.disabled) {
  background: var(--surface, #fff);
  border-color: color-mix(in srgb, var(--accent-ink) 22%, transparent);
}
.tool-card.disabled {
  opacity: 0.55;
}
.tc-main {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.tc-main:disabled {
  cursor: not-allowed;
}
.tc-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--accent-ink, #1f2329);
  background: color-mix(in srgb, var(--accent-ink) 9%, transparent);
}
.tool-card:hover:not(.disabled) .tc-icon {
  background: color-mix(in srgb, var(--accent-ink) 14%, transparent);
}
.tc-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tc-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.06));
  font-size: 12.5px;
  color: var(--text-dim, #6b7280);
  cursor: pointer;
}
.tc-warn {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.06));
  font-size: 12px;
  line-height: 1.45;
  color: #b06a00;
}
.switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
.switch input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}
.switch .track {
  display: block;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: rgba(240, 160, 32, 0.25);
  transition: background 0.18s ease;
}
.switch .track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #f0a020;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease, background 0.18s ease;
}
.switch input:checked + .track {
  background: rgba(24, 160, 88, 0.25);
}
.switch input:checked + .track::after {
  background: #18a058;
}
.switch input:checked + .track::after {
  transform: translateX(14px);
}
.switch input:focus-visible + .track {
  outline: 2px solid var(--accent, #2563eb);
  outline-offset: 2px;
}
.tc-name {
  font-size: 14px;
  font-weight: 600;
}
.tc-desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim, #8a909c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 结果弹窗 */
.dlg {
  display: flex;
  flex-direction: column;
  background: var(--surface, #fff);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--fluent-shadow, 0 18px 50px rgba(0, 0, 0, 0.22));
}
.dlg-ocr {
  width: 620px;
  max-width: 92vw;
}
.dlg-color {
  width: 460px;
  max-width: 92vw;
}
.dlg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.08));
}
.dlg-ic {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-strong, #1f2329);
  background: var(--rail-item-hover, rgba(17, 17, 17, 0.06));
}
.dlg-ic-dot {
  border: 1px solid rgba(17, 17, 17, 0.14);
}
.dlg-title {
  flex: 1;
  font-size: 15.5px;
  font-weight: 700;
  color: var(--text-strong, #1f2329);
}
.dlg-close {
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-dim, #8a909c);
  cursor: pointer;
  padding: 5px 9px;
  border-radius: 7px;
  transition: background 0.14s ease, color 0.14s ease;
}
.dlg-close:hover {
  background: rgba(17, 17, 17, 0.06);
  color: var(--text-strong, #1f2329);
}
.dlg-body {
  padding: 18px 20px;
}
.r-text {
  width: 100%;
  height: 300px;
  box-sizing: border-box;
  border: 1px solid rgba(17, 17, 17, 0.14);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13.5px;
  line-height: 1.7;
  font-family: inherit;
  color: #2b3038;
  resize: vertical;
  outline: none;
}
.r-text:focus {
  border-color: var(--accent, #2563eb);
}
.r-empty,
.r-error {
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  color: #8a909c;
}
.r-error {
  color: #d12f2f;
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 13px 20px 16px;
  border-top: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.08));
}
.btn.btn-ghost {
  background: transparent;
  color: var(--text-strong, #1f2329);
  border: 1px solid rgba(17, 17, 17, 0.16);
}
.btn.btn-ghost:hover:not(:disabled) {
  background: rgba(17, 17, 17, 0.06);
  color: var(--text-strong, #1f2329);
  border-color: rgba(17, 17, 17, 0.24);
}

/* 历史调色板 */
.palette {
  margin-top: 16px;
  border-top: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.08));
  padding-top: 14px;
}
.pal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.pal-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-dim, #8a909c);
}
.pal-clear {
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-dim, #8a909c);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
}
.pal-clear:hover {
  color: #d12f2f;
  background: rgba(209, 47, 47, 0.08);
}
.pal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}
.pal-cell {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid rgba(17, 17, 17, 0.12);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}
.pal-cell:hover {
  border-color: color-mix(in srgb, var(--accent-ink) 45%, transparent);
  background: rgba(17, 17, 17, 0.03);
}
.pal-cell.on {
  border-color: var(--accent-ink, #1f2329);
  box-shadow: 0 0 0 1px var(--accent-ink, #1f2329);
}
.pal-swatch {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(17, 17, 17, 0.14);
}
.pal-hex {
  font-size: 11.5px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: var(--text, #555);
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pal-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 9px;
  line-height: 1;
}
.pal-cell:hover .pal-del {
  display: flex;
}
.pal-del:hover {
  background: #d12f2f;
}
.color-body {
  display: flex;
  gap: 16px;
}
.swatch {
  flex: 0 0 104px;
  height: 104px;
  border-radius: 12px;
  border: 1px solid rgba(17, 17, 17, 0.14);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.color-rows {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(17, 17, 17, 0.12);
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.color-row:hover {
  background: rgba(17, 17, 17, 0.05);
}
.cr-label {
  flex: 0 0 38px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dim, #9aa0ac);
}
.cr-val {
  font-size: 14px;
  color: var(--text-strong, #1f2329);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.btn {
  padding: 7px 18px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid rgba(17, 17, 17, 0.14);
  background: var(--accent, #2563eb);
  color: #fff;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  color: #fff;
  background: rgba(20, 22, 26, 0.88);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
  pointer-events: none;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>
