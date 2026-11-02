<script setup lang="ts">
// 悬浮球功能面板：同一个小窗在「菜单 / OCR 结果」两种模式间由主进程切换尺寸与内容。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { OcrLine } from '@shared/types'

const mode = ref<'menu' | 'result'>('menu')
const lines = ref<OcrLine[]>([])
const capturing = ref(false)
const shooting = ref(false)
const errorMsg = ref('')
const cloudReady = ref(false)
const shotEnabled = ref(true)
const ocrMenuEnabled = ref(true)
// 主进程每次展示前都会先推送 mode；首个 mode 到达前保持透明，避免先画上一种模式再切换（闪烁）
const shown = ref(false)

const cloudLabel = computed(() => 'OCR识别')

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

function recapture(): void {
  void (lastSource.value === 'shot' ? startShot() : startOcr())
}

async function copyAll(): Promise<void> {
  await window.mook.ocr.copyText(resultText.value)
}
function closePanel(): void {
  window.mook.float.hide()
}

let offMode: (() => void) | null = null
let offHidden: (() => void) | null = null
onMounted(async () => {
  offMode = window.mook.float.onMode(async (m) => {
    mode.value = m
    shown.value = true
    // 等正确模式画面渲染上屏后再通知主进程显示窗口，避免先闪旧内容一帧
    await nextTick()
    window.requestAnimationFrame(() => window.mook.float.presented())
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
})
onBeforeUnmount(() => {
  offMode?.()
  offHidden?.()
})
</script>

<template>
  <div v-show="shown" class="panel-root" :class="mode">
    <!-- 功能菜单 -->
    <div v-if="mode === 'menu'" class="menu-card">
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
      <div v-if="ocrMenuEnabled && !cloudReady" class="menu-hint">云端 OCR 未配置，截屏的「提取文字」不可用</div>
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
