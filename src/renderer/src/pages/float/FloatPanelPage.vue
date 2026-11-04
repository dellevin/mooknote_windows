<script setup lang="ts">
// 悬浮球功能面板：同一个小窗在「菜单 / OCR 结果」两种模式间由主进程切换尺寸与内容。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { OcrLine, PickedColor } from '@shared/types'

const mode = ref<'menu' | 'result' | 'color'>('menu')
const lines = ref<OcrLine[]>([])
const capturing = ref(false)
const shooting = ref(false)
const picking = ref(false)
const errorMsg = ref('')
const cloudReady = ref(false)
const shotEnabled = ref(true)
const ocrMenuEnabled = ref(true)
const colorEnabled = ref(true)
const picked = ref<PickedColor | null>(null)
// 主进程每次展示前都会先推送 mode；首个 mode 到达前保持透明，避免先画上一种模式再切换（闪烁）
const shown = ref(false)
const menuEl = ref<HTMLElement | null>(null)

const cloudLabel = computed(() => 'OCR')

const resultText = computed(() => lines.value.map((l) => l.text).join('\n'))

// 结果面板里「重新截取」要回到对应的入口（OCR 识别 / 截屏）
const lastSource = ref<'ocr' | 'shot'>('ocr')

async function startOcr(): Promise<void> {
  if (capturing.value || !cloudReady.value) return
  capturing.value = true
  errorMsg.value = ''
  try {
    // 主进程会先隐藏本面板并让球转圈，选区结束后再以结果模式打开
    const res = await window.mook.ocr.capture()
    if (res === null) {
      // 用户取消：面板保持收起
      window.mook.float.hide()
      return
    }
    lastSource.value = 'ocr'
    lines.value = res
    await window.mook.float.setMode('result')
  } catch (e) {
    lines.value = []
    errorMsg.value = '识别失败：' + String(e)
    await window.mook.float.setMode('result')
  } finally {
    capturing.value = false
  }
}

async function startShot(): Promise<void> {
  if (shooting.value) return
  shooting.value = true
  try {
    // 截屏是独立会话：主进程隐藏面板、球转圈；
    // 点「提取文字」会带回识别行并弹出结果面板；保存/钉住/取消则面板保持收起
    const res = await window.mook.shot.capture()
    if (res.canceled || !res.lines) {
      window.mook.float.hide()
      return
    }
    lastSource.value = 'shot'
    errorMsg.value = ''
    lines.value = res.lines
    await window.mook.float.setMode('result')
  } finally {
    shooting.value = false
  }
}

async function startPick(): Promise<void> {
  if (picking.value) return
  picking.value = true
  try {
    // 主进程隐藏面板、球转圈；点击像素后带颜色返回，Esc/右键则取消
    const res = await window.mook.color.capture()
    if (res.canceled || !res.color) {
      window.mook.float.hide()
      return
    }
    picked.value = res.color
    await window.mook.float.setMode('color')
  } finally {
    picking.value = false
  }
}
function repick(): void {
  void startPick()
}

function recapture(): void {
  void (lastSource.value === 'shot' ? startShot() : startOcr())
}

const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1600)
}
async function copyText(text: string): Promise<void> {
  const { ok } = await window.mook.ocr.copyText(text)
  showToast(ok ? '复制成功' : '复制失败')
}
async function copyAll(): Promise<void> {
  await copyText(resultText.value)
}
async function copyColor(text: string): Promise<void> {
  await copyText(text)
}
function closePanel(): void {
  window.mook.float.hide()
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

let offMode: (() => void) | null = null
let offHidden: (() => void) | null = null
onMounted(async () => {
  offMode = window.mook.float.onMode(async (m) => {
    mode.value = m
    // 面板窗常驻复用：每次打开菜单都重读功能开关，否则设置里关闭后仍显示旧状态
    if (m === 'menu') {
      shotEnabled.value = (await window.mook.prefs.get<boolean>('shotEnabled', true)) !== false
      ocrMenuEnabled.value =
        (await window.mook.prefs.get<boolean>('ocrMenuEnabled', true)) !== false
      colorEnabled.value = (await window.mook.prefs.get<boolean>('colorEnabled', true)) !== false
    }
    shown.value = true
    // 等正确模式画面渲染上屏后再通知主进程显示窗口，避免先闪旧内容一帧。
    // 注意：不能用 requestAnimationFrame——面板窗显示前处于隐藏状态，Chromium 会暂停 rAF，
    // 会导致主进程 220ms 后备先以旧高度弹窗、真实高度被丢弃（菜单离球出现空隙）。
    // nextTick 后 offsetHeight 会强制同步布局，可直接拿到准确高度。
    await nextTick()
    window.mook.float.presented(
      mode.value === 'menu' ? menuEl.value?.offsetHeight : undefined
    )
  })
  offHidden = window.mook.float.onHidden(() => {
    shown.value = false
  })
  try {
    const cfg = await window.mook.ocr.cloudConfig()
    cloudReady.value = !!cfg.configured
  } catch {
    cloudReady.value = false
  }
  shotEnabled.value = (await window.mook.prefs.get<boolean>('shotEnabled', true)) !== false
  ocrMenuEnabled.value =
    (await window.mook.prefs.get<boolean>('ocrMenuEnabled', true)) !== false
  colorEnabled.value = (await window.mook.prefs.get<boolean>('colorEnabled', true)) !== false
})
onBeforeUnmount(() => {
  offMode?.()
  offHidden?.()
})
</script>

<template>
  <div v-show="shown" class="panel-root" :class="mode">
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
    <!-- 功能菜单 -->
    <div v-if="mode === 'menu'" ref="menuEl" class="menu-card">
      <button v-if="ocrMenuEnabled" class="menu-item" :disabled="capturing || shooting || !cloudReady" @click="startOcr">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6.5 19z" />
        </svg>
        <span>{{ capturing ? '正在截屏…' : cloudLabel }}</span>
      </button>
      <button v-if="shotEnabled" class="menu-item" :disabled="capturing || shooting" @click="startShot">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
        <span>{{ shooting ? '正在截屏…' : '截屏' }}</span>
      </button>
      <button v-if="colorEnabled" class="menu-item" :disabled="capturing || shooting || picking" @click="startPick">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a7 7 0 0 0-7 7c0 4 7 11 7 11s7-7 7-11a7 7 0 0 0-7-7z" />
          <circle cx="12" cy="10" r="2.6" />
        </svg>
        <span>{{ picking ? '正在取色…' : '取色' }}</span>
      </button>
      <div v-if="ocrMenuEnabled && !cloudReady" class="menu-hint">当前OCR配置暂不可用，请重新尝试</div>
    </div>

    <!-- 取色结果 -->
    <div v-else-if="mode === 'color' && picked" class="result-card color-card">
      <div class="rc-head">
        <span class="rc-title">取色结果</span>
        <button class="rc-close" title="关闭" @click="closePanel">✕</button>
      </div>
      <div class="color-body">
        <div class="swatch" :style="{ background: picked.hex }"></div>
        <div class="color-rows">
          <button class="color-row" title="点击复制" @click="copyColor(picked.hex)">
            <span class="cr-label">HEX</span>
            <span class="cr-val">{{ picked.hex }}</span>
          </button>
          <button class="color-row" title="点击复制" @click="copyColor(colorRgb)">
            <span class="cr-label">RGB</span>
            <span class="cr-val">{{ colorRgb }}</span>
          </button>
          <button class="color-row" title="点击复制" @click="copyColor(colorHsl)">
            <span class="cr-label">HSL</span>
            <span class="cr-val">{{ colorHsl }}</span>
          </button>
        </div>
      </div>
      <div class="rc-foot">
        <button class="btn" @click="closePanel">关闭</button>
        <button class="btn" @click="repick">重新取色</button>
      </div>
    </div>

    <!-- OCR 结果 -->
    <div v-else class="result-card">
      <div class="rc-head">
        <span class="rc-title">OCR 识别结果</span>
        <button class="rc-close" title="关闭" @click="closePanel">✕</button>
      </div>
      <div class="rc-body">
        <div v-if="errorMsg" class="rc-error">{{ errorMsg }}</div>
        <div v-else-if="!lines.length" class="rc-empty">选区内没有识别到文字</div>
        <textarea v-else class="rc-text" readonly :value="resultText" @focus="($event.target as HTMLTextAreaElement).select()"></textarea>
      </div>
      <div class="rc-foot">
        <button class="btn" @click="closePanel">关闭</button>
        <button class="btn" @click="recapture">重新截取</button>
        <button class="btn primary" :disabled="!lines.length" @click="copyAll">复制全部</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  overflow: hidden;
  position: relative;
}
.toast {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 7px 18px;
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
/* 菜单模式：卡片靠右下角（球的上方） */
.menu-card {
  width: 100%;
  padding: 5px;
  border-radius: 12px;
  background: var(--surface, #fff);
  border: 1px solid rgba(17, 17, 17, 0.1);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-strong, #1f2329);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.menu-item:hover:not(:disabled) {
  background: rgba(17, 17, 17, 0.06);
}
.menu-item:disabled {
  color: #9aa0ac;
  cursor: wait;
}
.menu-hint {
  padding: 4px 12px 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #b06a00;
}
/* 结果模式：填满整个面板窗 */
.result-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--surface, #fff);
  border: 1px solid rgba(17, 17, 17, 0.1);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}
.rc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(17, 17, 17, 0.08);
}
.rc-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
}
.rc-close {
  border: none;
  background: transparent;
  font-size: 14px;
  color: #8a909c;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.rc-close:hover {
  background: rgba(17, 17, 17, 0.06);
  color: #1f2329;
}
.rc-body {
  flex: 1;
  min-height: 0;
  padding: 14px 18px;
}
.rc-text {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(17, 17, 17, 0.14);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13.5px;
  line-height: 1.7;
  font-family: inherit;
  color: #2b3038;
  resize: none;
  outline: none;
  user-select: text;
}
.rc-text:focus {
  border-color: var(--accent, #2563eb);
}
.rc-empty,
.rc-error {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  color: #8a909c;
}
.rc-error {
  color: #d12f2f;
}
.rc-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid rgba(17, 17, 17, 0.08);
}
/* 取色结果 */
.color-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
}
.swatch {
  flex: 0 0 120px;
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(17, 17, 17, 0.14);
}
.color-rows {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 14px;
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
  padding: 7px 16px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid rgba(17, 17, 17, 0.14);
  background: var(--surface, #fff);
  color: var(--text-strong, #1f2329);
  cursor: pointer;
}
.btn:hover {
  background: rgba(17, 17, 17, 0.05);
}
.btn.primary {
  background: var(--accent, #2563eb);
  border-color: transparent;
  color: #fff;
}
.btn.primary:hover {
  filter: brightness(1.08);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
