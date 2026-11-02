<script setup lang="ts">
// 「探索 - 功能」：在主窗口内直接发起 OCR / 截屏 / 取色，结果在本页展示。
import { computed, onMounted, ref } from 'vue'
import type { OcrLine, PickedColor } from '@shared/types'

const busy = ref<'' | 'ocr' | 'shot' | 'color' | 'reader'>('')
const resultKind = ref<'' | 'ocr' | 'color'>('')
const lines = ref<OcrLine[]>([])
const errorMsg = ref('')
const picked = ref<PickedColor | null>(null)
const cloudReady = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

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
      picked.value = res.color
      resultKind.value = 'color'
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
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 5a2 2 0 0 1 2-2h7v16H4a2 2 0 0 0-2 2z" />
            <path d="M22 5a2 2 0 0 0-2-2h-7v16h7a2 2 0 0 1 2 2z" />
          </svg>
          <span class="tc-name">电子书阅读</span>
          <span class="tc-desc">{{ busy === 'reader' ? '正在打开…' : '在独立窗口阅读 EPUB / PDF / TXT 等' }}</span>
        </button>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy || !cloudReady }">
        <button class="tc-main" :disabled="!!busy || !cloudReady" @click="startOcr">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z" />
          </svg>
          <span class="tc-name">OCR</span>
          <span class="tc-desc">{{ busy === 'ocr' ? '正在截屏…' : '框选屏幕区域识别文字' }}</span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>识别时隐藏主窗口</span>
          <input type="checkbox" v-model="hideOcr" @change="onHideToggle('hideMainOnOcr', hideOcr)" />
        </label>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy }">
        <button class="tc-main" :disabled="!!busy" @click="startShot">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
          <span class="tc-name">截屏</span>
          <span class="tc-desc">{{ busy === 'shot' ? '正在截屏…' : '截屏标注、保存或钉在桌面' }}</span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>截屏时隐藏主窗口</span>
          <input type="checkbox" v-model="hideShot" @change="onHideToggle('hideMainOnShot', hideShot)" />
        </label>
      </div>

      <div class="tool-card" :class="{ disabled: !!busy }">
        <button class="tc-main" :disabled="!!busy" @click="startColor">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a7 7 0 0 0-7 7c0 4 7 11 7 11s7-7 7-11a7 7 0 0 0-7-7z" />
            <circle cx="12" cy="10" r="2.6" />
          </svg>
          <span class="tc-name">取色</span>
          <span class="tc-desc">{{ busy === 'color' ? '正在取色…' : '拾取屏幕任意像素颜色' }}</span>
        </button>
        <label class="tc-opt" @click.stop>
          <span>取色时隐藏主窗口</span>
          <input type="checkbox" v-model="hideColor" @change="onHideToggle('hideMainOnColor', hideColor)" />
        </label>
      </div>
    </div>

    <div v-if="!cloudReady" class="hint">云端 OCR 未配置，OCR 暂不可用（可在设置中配置或改用本地 OCR）</div>

    <!-- OCR 结果 -->
    <div v-if="resultKind === 'ocr'" class="result">
      <div class="r-head">
        <span class="r-title">OCR 识别结果</span>
        <button class="r-close" @click="resultKind = ''">✕</button>
      </div>
      <div class="r-body">
        <div v-if="errorMsg" class="r-error">{{ errorMsg }}</div>
        <div v-else-if="!lines.length" class="r-empty">选区内没有识别到文字</div>
        <textarea v-else class="r-text" readonly :value="resultText"
          @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
      </div>
      <div class="r-foot">
        <button class="btn" :disabled="!lines.length" @click="copyText(resultText)">复制全部</button>
      </div>
    </div>

    <!-- 取色结果 -->
    <div v-else-if="resultKind === 'color' && picked" class="result">
      <div class="r-head">
        <span class="r-title">取色结果</span>
        <button class="r-close" @click="resultKind = ''">✕</button>
      </div>
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
    </div>

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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}
.tool-card {
  display: flex;
  flex-direction: column;
  padding: 16px 16px 12px;
  border-radius: 14px;
  border: 1px solid rgba(17, 17, 17, 0.1);
  background: var(--surface, #fff);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  color: var(--text-strong, #1f2329);
  font-family: inherit;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.tool-card:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
}
.tool-card.disabled {
  opacity: 0.6;
}
.tc-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  padding: 4px 4px 8px;
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
.tc-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(17, 17, 17, 0.08);
  font-size: 12.5px;
  color: var(--text-dim, #6b7280);
  cursor: pointer;
}
.tc-opt input {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--accent, #2563eb);
}
.tc-name {
  font-size: 16px;
  font-weight: 600;
}
.tc-desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-dim, #8a909c);
}
.hint {
  margin-top: 14px;
  font-size: 12.5px;
  color: #b06a00;
}
.result {
  margin-top: 22px;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--surface, #fff);
  border: 1px solid rgba(17, 17, 17, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.r-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(17, 17, 17, 0.08);
}
.r-title {
  font-size: 15px;
  font-weight: 600;
}
.r-close {
  border: none;
  background: transparent;
  font-size: 14px;
  color: #8a909c;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.r-close:hover {
  background: rgba(17, 17, 17, 0.06);
  color: #1f2329;
}
.r-body {
  padding: 14px 18px;
  min-height: 180px;
}
.r-text {
  width: 100%;
  height: 220px;
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
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  color: #8a909c;
}
.r-error {
  color: #d12f2f;
}
.r-foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 18px;
  border-top: 1px solid rgba(17, 17, 17, 0.08);
}
.color-body {
  display: flex;
  gap: 16px;
  padding: 18px;
}
.swatch {
  flex: 0 0 110px;
  height: 110px;
  border-radius: 12px;
  border: 1px solid rgba(17, 17, 17, 0.14);
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
