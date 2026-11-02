<script setup lang="ts">
// 屏幕取色覆盖窗：显示冻结的屏幕画面，鼠标移动时在光标处画放大镜与十字准星，
// 单击取光标正下方像素的颜色；Esc / 右键取消。像素从原图（物理分辨率）采样，保证取色准确。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface PickedColor {
  r: number
  g: number
  b: number
  hex: string
}

const route = useRoute()
const ready = ref(false)
const lensSize = 132 // 放大镜直径（CSS px，偶数）
const srcRadius = 6 // 以光标为中心，采样 ±6 个物理像素（13x13 格）

let img: HTMLImageElement | null = null
let srcCanvas: HTMLCanvasElement | null = null
let srcCtx: CanvasRenderingContext2D | null = null
let kx = 1
let ky = 1
let lensEl: HTMLCanvasElement | null = null
let lensCtx: CanvasRenderingContext2D | null = null
let crossH: HTMLDivElement | null = null
let crossV: HTMLDivElement | null = null
let labelEl: HTMLDivElement | null = null
let lastX = -1
let lastY = -1
let cur: PickedColor | null = null
let raf = 0

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase()
}

function sampleAt(cssX: number, cssY: number): PickedColor | null {
  if (!srcCtx || !img) return null
  const px = Math.round(cssX * kx)
  const py = Math.round(cssY * ky)
  if (px < 0 || py < 0 || px >= img.naturalWidth || py >= img.naturalHeight) return null
  const d = srcCtx.getImageData(px, py, 1, 1).data
  return { r: d[0], g: d[1], b: d[2], hex: '#' + toHex(d[0]) + toHex(d[1]) + toHex(d[2]) }
}

function drawLens(cssX: number, cssY: number): void {
  if (!lensCtx || !srcCtx || !lensEl || !crossH || !crossV || !labelEl) return
  const W = window.innerWidth
  const H = window.innerHeight
  const cx = Math.round(cssX * kx)
  const cy = Math.round(cssY * ky)
  const cells = srcRadius * 2 + 1
  const cell = lensSize / cells

  lensCtx.imageSmoothingEnabled = false
  lensCtx.clearRect(0, 0, lensSize, lensSize)
  // 放大周围像素
  for (let oy = -srcRadius; oy <= srcRadius; oy++) {
    for (let ox = -srcRadius; ox <= srcRadius; ox++) {
      const d = srcCtx.getImageData(cx + ox, cy + oy, 1, 1).data
      lensCtx.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`
      lensCtx.fillRect(
        (ox + srcRadius) * cell,
        (oy + srcRadius) * cell,
        Math.ceil(cell),
        Math.ceil(cell)
      )
    }
  }
  // 中心格高亮描边
  lensCtx.lineWidth = 1.5
  lensCtx.strokeStyle = 'rgba(255,255,255,0.9)'
  lensCtx.strokeRect(srcRadius * cell, srcRadius * cell, cell, cell)
  lensCtx.strokeStyle = 'rgba(0,0,0,0.55)'
  lensCtx.strokeRect(srcRadius * cell + 1, srcRadius * cell + 1, cell - 2, cell - 2)
  // 圆形裁剪遮罩边框
  lensCtx.beginPath()
  lensCtx.arc(lensSize / 2, lensSize / 2, lensSize / 2 - 1, 0, Math.PI * 2)
  lensCtx.lineWidth = 3
  lensCtx.strokeStyle = 'rgba(255,255,255,0.95)'
  lensCtx.stroke()

  // 放大镜位置：优先右下，靠近边缘时翻到另一侧
  let lx = cssX + 14
  let ly = cssY + 14
  if (lx + lensSize > W - 4) lx = cssX - lensSize - 14
  if (ly + lensSize > H - 4) ly = cssY - lensSize - 14
  lx = Math.max(4, Math.min(lx, W - lensSize - 4))
  ly = Math.max(4, Math.min(ly, H - lensSize - 4))
  lensEl.style.transform = `translate(${lx}px, ${ly}px)`

  if (cur) labelEl.textContent = cur.hex
  labelEl.style.transform = `translate(${lx}px, ${ly - 22}px)`
  labelEl.style.opacity = cur ? '1' : '0'

  // 十字准星（贯穿全屏的细线）
  crossH.style.transform = `translateY(${cssY}px)`
  crossV.style.transform = `translateX(${cssX}px)`
}

function scheduleDraw(): void {
  if (raf) return
  raf = window.requestAnimationFrame(() => {
    raf = 0
    if (lastX >= 0) drawLens(lastX, lastY)
  })
}

// 把采样点移动到指定 CSS 坐标（鼠标与键盘微调共用）
function moveTo(cssX: number, cssY: number): void {
  lastX = cssX
  lastY = cssY
  cur = sampleAt(cssX, cssY)
  scheduleDraw()
}

function onPointerMove(e: PointerEvent): void {
  moveTo(e.clientX, e.clientY)
}

async function confirmPick(): Promise<void> {
  if (lastX < 0) return
  const c = sampleAt(lastX, lastY)
  if (!c) return
  await window.mook.color.overlayPick(c)
}

async function onPointerDown(e: PointerEvent): Promise<void> {
  if (e.button === 2) return // 右键走 contextmenu 取消
  const c = sampleAt(e.clientX, e.clientY)
  if (!c) return
  await window.mook.color.overlayPick(c)
}

async function cancel(): Promise<void> {
  await window.mook.color.overlayCancel()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    void cancel()
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    void confirmPick()
    return
  }
  // 方向键逐物理像素微调（Shift = 10 像素）；1 CSS px 在高 DPI 下对应多个物理像素，
  // 故步长取 1/kx、1/ky，保证放大镜里每次只挪一格
  const dirs: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }
  const d = dirs[e.key]
  if (!d) return
  e.preventDefault()
  const step = e.shiftKey ? 10 : 1
  const baseX = lastX >= 0 ? lastX : window.innerWidth / 2
  const baseY = lastY >= 0 ? lastY : window.innerHeight / 2
  moveTo(
    Math.min(Math.max(baseX + (d[0] * step) / kx, 0), window.innerWidth - 1),
    Math.min(Math.max(baseY + (d[1] * step) / ky, 0), window.innerHeight - 1)
  )
}
function onContext(e: MouseEvent): void {
  e.preventDefault()
  void cancel()
}

onMounted(async () => {
  const id = String(route.query.id ?? '')
  const init = await window.mook.color.overlayInit(id)
  if (!init) {
    void cancel()
    return
  }
  img = new Image()
  await new Promise<void>((resolve, reject) => {
    img!.onload = () => resolve()
    img!.onerror = reject
    img!.src = init.dataUrl
  })
  srcCanvas = document.createElement('canvas')
  srcCanvas.width = img.naturalWidth
  srcCanvas.height = img.naturalHeight
  srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  srcCtx?.drawImage(img, 0, 0)
  kx = img.naturalWidth / window.innerWidth
  ky = img.naturalHeight / window.innerHeight

  lensEl = document.getElementById('lens') as HTMLCanvasElement
  lensEl.width = lensSize
  lensEl.height = lensSize
  lensCtx = lensEl.getContext('2d')
  crossH = document.getElementById('cross-h') as HTMLDivElement
  crossV = document.getElementById('cross-v') as HTMLDivElement
  labelEl = document.getElementById('hex-label') as HTMLDivElement

  ready.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKey)
  window.addEventListener('contextmenu', onContext)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('contextmenu', onContext)
})
</script>

<template>
  <div class="cp-root">
    <!-- 冻结的屏幕画面 -->
    <img v-if="ready" class="cp-bg" :src="img?.src" alt="" draggable="false" />

    <!-- 全屏十字线 -->
    <div id="cross-h" class="cross cross-h"></div>
    <div id="cross-v" class="cross cross-v"></div>

    <!-- HEX 标签 -->
    <div id="hex-label" class="hex-label"></div>

    <!-- 放大镜 -->
    <canvas id="lens" class="lens" :width="lensSize" :height="lensSize"></canvas>
  </div>
</template>

<style scoped>
.cp-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
}
.cp-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  -webkit-user-drag: none;
}
.cross {
  position: absolute;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.45);
}
.cross-h {
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
}
.cross-v {
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
}
.lens {
  position: absolute;
  left: 0;
  top: 0;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.hex-label {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 12px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: 0.5px;
  opacity: 0;
  white-space: nowrap;
}
</style>
