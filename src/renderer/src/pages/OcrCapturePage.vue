<script setup lang="ts">
// 独立全屏透明窗口：显示冻结的屏幕截图，拖拽框选区域后裁剪 PNG 交主进程 OCR
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const route = useRoute()
const displayId = String(route.query.id ?? '')

const bg = ref('')
const scaleFactor = ref(1)
const pixels = ref<{ width: number; height: number } | null>(null)
const failed = ref('')

const start = ref<{ x: number; y: number } | null>(null)
const current = ref<{ x: number; y: number } | null>(null)
const rect = ref<Rect | null>(null)
const dragging = ref(false)
// 在已有选区内部按下时为"移动选区"，否则为重新框选
const moving = ref(false)
const hoverInside = ref(false)
let moveOff = { x: 0, y: 0 }
// 边缘/角落缩放
type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
const resizing = ref<{ edge: Edge; sx: number; sy: number; r0: Rect } | null>(null)
const MIN_SIZE = 10
const EDGE_HANDLES: Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const recognizing = ref(false)

function pointInRect(x: number, y: number, r: Rect | null): boolean {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

const EDGE_PX = 8
// 返回光标所在的缩放边/角；不在边缘返回 null
function edgeAt(x: number, y: number, r: Rect): Edge | null {
  const nearL = Math.abs(x - r.x) <= EDGE_PX
  const nearR = Math.abs(x - (r.x + r.w)) <= EDGE_PX
  const nearT = Math.abs(y - r.y) <= EDGE_PX
  const nearB = Math.abs(y - (r.y + r.h)) <= EDGE_PX
  const inX = x >= r.x - EDGE_PX && x <= r.x + r.w + EDGE_PX
  const inY = y >= r.y - EDGE_PX && y <= r.y + r.h + EDGE_PX
  if (nearT && nearL) return 'nw'
  if (nearT && nearR) return 'ne'
  if (nearB && nearL) return 'sw'
  if (nearB && nearR) return 'se'
  if (nearT && inX) return 'n'
  if (nearB && inX) return 's'
  if (nearL && inY) return 'w'
  if (nearR && inY) return 'e'
  return null
}

// 悬停时的光标：缩放优先，其次移动，其余为十字
const cursorClass = ref('')
function updateCursor(e: PointerEvent): void {
  const r = rect.value
  if (!r || recognizing.value) {
    cursorClass.value = ''
    return
  }
  const edge = edgeAt(e.clientX, e.clientY, r)
  if (edge) cursorClass.value = 'cur-' + edge
  else if (pointInRect(e.clientX, e.clientY, r)) cursorClass.value = 'cur-move'
  else cursorClass.value = ''
}

function applyResize(x: number, y: number): void {
  const st = resizing.value
  if (!st) return
  const { edge, r0 } = st
  const W = window.innerWidth
  const H = window.innerHeight
  const nx = Math.min(Math.max(x, 0), W)
  const ny = Math.min(Math.max(y, 0), H)
  let left = r0.x
  let top = r0.y
  let right = r0.x + r0.w
  let bottom = r0.y + r0.h
  if (edge.includes('w')) left = Math.min(nx, right - MIN_SIZE)
  if (edge.includes('e')) right = Math.max(nx, left + MIN_SIZE)
  if (edge.includes('n')) top = Math.min(ny, bottom - MIN_SIZE)
  if (edge.includes('s')) bottom = Math.max(ny, top + MIN_SIZE)
  rect.value = { x: left, y: top, w: right - left, h: bottom - top }
}

// 确认/取消按钮条位置：优先选区下方，其次上方，都放不下（如全屏选框）则贴选框内部顶部
const TOOLBAR_W = 168
const TOOLBAR_H = 40
const toolbarStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  const W = window.innerWidth
  const H = window.innerHeight
  let top: number
  if (r.y + r.h + TOOLBAR_H < H - 4) {
    top = r.y + r.h + 8
  } else if (r.y - TOOLBAR_H > 4) {
    top = r.y - TOOLBAR_H + 4
  } else {
    // 上下都没有空间：放进选框内顶部
    top = r.y + 8
  }
  const x = Math.min(Math.max(r.x, 8), W - TOOLBAR_W - 8)
  return { left: x + 'px', top: top + 'px' }
})

const selStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  return {
    left: r.x + 'px',
    top: r.y + 'px',
    width: r.w + 'px',
    height: r.h + 'px'
  }
})
const brightStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  return {
    width: window.innerWidth + 'px',
    height: window.innerHeight + 'px',
    left: -r.x + 'px',
    top: -r.y + 'px'
  }
})

function normalize(): Rect | null {
  const s = start.value
  const c = current.value
  if (!s || !c) return null
  const x = Math.min(s.x, c.x)
  const y = Math.min(s.y, c.y)
  const w = Math.abs(c.x - s.x)
  const h = Math.abs(c.y - s.y)
  if (w < 4 || h < 4) return null
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    w: Math.min(w, window.innerWidth - x),
    h: Math.min(h, window.innerHeight - y)
  }
}

function clampRect(r: Rect): Rect {
  const W = window.innerWidth
  const H = window.innerHeight
  const x = Math.min(Math.max(r.x, 0), W - r.w)
  const y = Math.min(Math.max(r.y, 0), H - r.h)
  return { x, y, w: r.w, h: r.h }
}

function onPointerDown(e: PointerEvent): void {
  if (recognizing.value) return
  if (e.button !== 0) return
  const r = rect.value
  if (r) {
    // 1) 边缘/角落 → 调整大小
    const edge = edgeAt(e.clientX, e.clientY, r)
    if (edge) {
      resizing.value = { edge, sx: e.clientX, sy: e.clientY, r0: { ...r } }
      return
    }
    // 2) 选区内部 → 整体移动
    if (pointInRect(e.clientX, e.clientY, r)) {
      moving.value = true
      hoverInside.value = true
      moveOff = { x: e.clientX - r.x, y: e.clientY - r.y }
      return
    }
  }
  // 3) 选区外 → 重新框选
  moving.value = false
  dragging.value = true
  start.value = { x: e.clientX, y: e.clientY }
  current.value = { x: e.clientX, y: e.clientY }
  rect.value = null
  failed.value = ''
}
function onPointerMove(e: PointerEvent): void {
  if (resizing.value) {
    applyResize(e.clientX, e.clientY)
    return
  }
  if (moving.value && rect.value) {
    rect.value = clampRect({
      x: e.clientX - moveOff.x,
      y: e.clientY - moveOff.y,
      w: rect.value.w,
      h: rect.value.h
    })
    return
  }
  if (!dragging.value) {
    hoverInside.value = pointInRect(e.clientX, e.clientY, rect.value)
    updateCursor(e)
    return
  }
  current.value = { x: e.clientX, y: e.clientY }
  rect.value = normalize()
}
function onPointerUp(): void {
  if (resizing.value) {
    resizing.value = null
    return
  }
  if (moving.value) {
    moving.value = false
    return
  }
  if (!dragging.value) return
  dragging.value = false
  rect.value = normalize()
}

// 点击工具条按钮时不能触发底层重新框选
function stopDrag(e: Event): void {
  e.stopPropagation()
}

async function submit(r: Rect): Promise<void> {
  recognizing.value = true
  failed.value = ''
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.src = bg.value
    await img.decode()
    if (!ctx) throw new Error('canvas 不可用')
    // 以截图实际像素为准换算（多屏缩略图可能不等于 尺寸×缩放比）
    const pxW = pixels.value?.width || Math.round(window.innerWidth * scaleFactor.value)
    const pxH = pixels.value?.height || Math.round(window.innerHeight * scaleFactor.value)
    const sx = pxW / window.innerWidth
    const sy = pxH / window.innerHeight
    canvas.width = Math.max(1, Math.round(r.w * sx))
    canvas.height = Math.max(1, Math.round(r.h * sy))
    ctx.drawImage(
      img,
      Math.round(r.x * sx),
      Math.round(r.y * sy),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height
    )

    // 讯飞 OCR 要求分辨率在 [50×50, 6000×6000]：
    // 小于 50 → 白底居中补齐到至少 50×50（不改变框内文字）；大于 6000 → 等比缩小
    let out: HTMLCanvasElement = canvas
    if (out.width < 50 || out.height < 50) {
      const padded = document.createElement('canvas')
      padded.width = Math.max(50, out.width)
      padded.height = Math.max(50, out.height)
      const pctx = padded.getContext('2d')
      if (!pctx) throw new Error('canvas 不可用')
      pctx.fillStyle = '#ffffff'
      pctx.fillRect(0, 0, padded.width, padded.height)
      pctx.drawImage(out, Math.floor((padded.width - out.width) / 2), Math.floor((padded.height - out.height) / 2))
      out = padded
    }
    const maxDim = Math.max(out.width, out.height)
    if (maxDim > 6000) {
      const k = 6000 / maxDim
      const scaled = document.createElement('canvas')
      scaled.width = Math.round(out.width * k)
      scaled.height = Math.round(out.height * k)
      const sctx = scaled.getContext('2d')
      if (!sctx) throw new Error('canvas 不可用')
      sctx.drawImage(out, 0, 0, scaled.width, scaled.height)
      out = scaled
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/png')
    )
    if (!blob) throw new Error('截图生成失败')
    // 窗口会在主进程识别完成后销毁，invoke 可能因窗口销毁而 reject —— 忽略即可
    await window.mook.ocr.overlayRecognize(await blob.arrayBuffer())
  } catch (e) {
    recognizing.value = false
    failed.value = '识别失败：' + String(e)
  }
}

function confirmSelection(): void {
  const r = rect.value
  if (r && !recognizing.value) void submit(r)
}

async function cancel(): Promise<void> {
  try {
    await window.mook.ocr.overlayCancel()
  } catch {
    // 窗口销毁等情况下忽略
  }
}
function onKey(e: KeyboardEvent): void {
  if (recognizing.value) return
  if (e.key === 'Escape') void cancel()
  else if (e.key === 'Enter') confirmSelection()
}

onMounted(async () => {
  const info = await window.mook.ocr.overlayInit(displayId)
  if (!info) {
    failed.value = '无法获取屏幕画面'
    return
  }
  bg.value = info.dataUrl
  scaleFactor.value = info.scaleFactor
  pixels.value = info.pixels
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="cap"
    :class="[resizing ? 'cur-' + resizing.edge : cursorClass, { grabbing: moving }]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @contextmenu.prevent="cancel"
  >
    <template v-if="bg">
      <img class="bg-dim" :src="bg" draggable="false" />
      <div v-if="rect" class="sel" :style="selStyle">
        <img class="bg-bright" :src="bg" draggable="false" :style="brightStyle" />
        <span
          v-for="h in EDGE_HANDLES"
          :key="h"
          class="handle"
          :class="'h-' + h"
        />
      </div>
      <div
        v-if="rect && !recognizing"
        class="toolbar"
        :style="toolbarStyle"
        @pointerdown="stopDrag"
        @pointermove.stop
        @pointerup.stop
      >
        <button class="tb-btn cancel" @click="cancel">取消</button>
        <button class="tb-btn ok" @click="confirmSelection">识别</button>
      </div>
      <div v-if="!recognizing" class="hint">
        {{ rect ? '拖内部移动，拖边缘/角调整大小，右键 / Esc 取消，Enter 识别' : '拖拽框选要识别的区域，右键 / Esc 取消，Enter 识别' }}
      </div>
      <div v-if="failed" class="error">{{ failed }}</div>
    </template>
    <div v-else class="loading">{{ failed || '正在准备截屏…' }}</div>
    <div v-if="recognizing" class="loading">正在识别文字…</div>
  </div>
</template>

<style scoped>
.cap {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  user-select: none;
  overflow: hidden;
  background: transparent;
}
.cap.cur-move {
  cursor: move;
}
.cap.grabbing {
  cursor: grabbing;
}
.cap.cur-n,
.cap.cur-s {
  cursor: ns-resize;
}
.cap.cur-e,
.cap.cur-w {
  cursor: ew-resize;
}
.cap.cur-nw,
.cap.cur-se {
  cursor: nwse-resize;
}
.cap.cur-ne,
.cap.cur-sw {
  cursor: nesw-resize;
}
.bg-dim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  filter: brightness(0.45);
  pointer-events: none;
}
.sel {
  position: absolute;
  overflow: hidden;
  border: 1.5px solid var(--accent, #2563eb);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
  pointer-events: none;
}
.bg-bright {
  position: absolute;
  pointer-events: none;
}
/* 手柄为隐形热区：不填充、不遮挡截图内容，仅靠边缘描边和光标提示可拖拽 */
.handle {
  position: absolute;
  width: 14px;
  height: 14px;
  background: transparent;
  border: none;
  pointer-events: none;
  z-index: 2;
}
/* 四角用两条细短线暗示可拖，颜色低透明不抢视野 */
.h-nw,
.h-ne,
.h-sw,
.h-se {
  width: 16px;
  height: 16px;
}
.h-nw::before, .h-nw::after,
.h-ne::before, .h-ne::after,
.h-sw::before, .h-sw::after,
.h-se::before, .h-se::after {
  content: '';
  position: absolute;
  background: rgba(255, 255, 255, 0.85);
}
.h-nw { left: 0; top: 0; }
.h-nw::before { left: 0; top: 0; width: 12px; height: 2px; }
.h-nw::after  { left: 0; top: 0; width: 2px; height: 12px; }
.h-ne { right: 0; top: 0; }
.h-ne::before { right: 0; top: 0; width: 12px; height: 2px; }
.h-ne::after  { right: 0; top: 0; width: 2px; height: 12px; }
.h-sw { left: 0; bottom: 0; }
.h-sw::before { left: 0; bottom: 0; width: 12px; height: 2px; }
.h-sw::after { left: 0; bottom: 0; width: 2px; height: 12px; }
.h-se { right: 0; bottom: 0; }
.h-se::before { right: 0; bottom: 0; width: 12px; height: 2px; }
.h-se::after  { right: 0; bottom: 0; width: 2px; height: 12px; }
.h-n  { left: calc(50% - 7px); top: 0; width: 14px; height: 10px; }
.h-e  { right: 0; top: calc(50% - 7px); width: 10px; height: 14px; }
.h-s  { left: calc(50% - 7px); bottom: 0; width: 14px; height: 10px; }
.h-w  { left: 0; top: calc(50% - 7px); width: 10px; height: 14px; }
.hint {
  position: absolute;
  top: 26px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(17, 17, 17, 0.72);
  color: #fff;
  font-size: 13px;
  pointer-events: none;
  white-space: nowrap;
}
.toolbar {
  position: absolute;
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 10px;
  background: rgba(24, 24, 27, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.tb-btn {
  min-width: 64px;
  padding: 6px 14px;
  border: none;
  border-radius: 7px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.tb-btn.cancel {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.tb-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.24);
}
.tb-btn.ok {
  background: var(--accent, #2563eb);
  color: var(--on-accent, #fff);
}
.tb-btn.ok:hover {
  filter: brightness(1.1);
}
.error {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(200, 30, 30, 0.85);
  color: #fff;
  font-size: 13px;
  pointer-events: none;
  white-space: nowrap;
}
.loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 14px 26px;
  border-radius: 12px;
  background: rgba(17, 17, 17, 0.78);
  color: #fff;
  font-size: 14px;
  pointer-events: none;
}
</style>
