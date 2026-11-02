<script setup lang="ts">
// 独立全屏透明窗口：微信式截屏 —— 框选 / 移动 / 缩放选区，矩形、椭圆、箭头、画笔、马赛克标注，
// 提取文字（云端 OCR）、保存图片、钉到桌面、关闭。与 OCR 识别页完全独立（shot:* IPC）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type Tool = 'select' | 'rect' | 'ellipse' | 'arrow' | 'brush' | 'mosaic'
interface BaseShape {
  id: number
  tool: Tool
  color: string
  sw: number
}
interface BoxShape extends BaseShape {
  tool: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
}
interface ArrowShape extends BaseShape {
  tool: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}
interface BrushShape extends BaseShape {
  tool: 'brush'
  pts: { x: number; y: number }[]
}
type Shape = BoxShape | ArrowShape | BrushShape

const route = useRoute()
const displayId = String(route.query.id ?? '')

const bg = ref('')
const scaleFactor = ref(1)
const pixels = ref<{ width: number; height: number } | null>(null)
const failed = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

// ---------------- 选区（与 OCR 页一致：框选 / 内部拖动 / 八向缩放） ----------------
const start = ref<{ x: number; y: number } | null>(null)
const current = ref<{ x: number; y: number } | null>(null)
const rect = ref<Rect | null>(null)
const dragging = ref(false)
const moving = ref(false)
let moveOff = { x: 0, y: 0 }
type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
const resizing = ref<{ edge: Edge; r0: Rect } | null>(null)
const MIN_SIZE = 10
const EDGE_HANDLES: Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const EDGE_PX = 8

const busy = ref(false)
const tool = ref<Tool>('select')
const color = ref('#fa5151')
const COLORS = ['#fa5151', '#ff9900', '#19be6b', '#2b6ef3', '#ffffff', '#1a1a1a']
let shapeSeq = 1
const shapes = ref<Shape[]>([])
const draft = ref<Shape | null>(null)
// 撤销栈：普通图形只记标记；马赛克记笔画开始前的整屏位图快照
type HistEntry = { kind: 'shape' } | { kind: 'mosaic'; data: ImageData }
const history: HistEntry[] = []

// 马赛克层：覆盖整块屏幕的后备画布，放进选框容器靠 overflow:hidden 裁掉选框外部分
const mosaicEl = ref<HTMLCanvasElement | null>(null)
let mosaicCtx: CanvasRenderingContext2D | null = null
let mSnapshot: ImageData | null = null

// 工具条固定显示全部工具
const colorRowVisible = computed(() => true)
const toolbarVisible = computed(() => true)

function pointInRect(x: number, y: number, r: Rect | null): boolean {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}
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

const cursorClass = ref('')
function updateCursor(e: PointerEvent): void {
  const r = rect.value
  if (!r || busy.value) {
    cursorClass.value = ''
    return
  }
  if (tool.value !== 'select' && pointInRect(e.clientX, e.clientY, r)) {
    cursorClass.value = 'cur-draw'
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
  return {
    x: Math.min(Math.max(r.x, 0), W - r.w),
    y: Math.min(Math.max(r.y, 0), H - r.h),
    w: r.w,
    h: r.h
  }
}

// ---------------- 标注 ----------------
let drawing = false
function relPos(e: PointerEvent): { x: number; y: number } {
  const r = rect.value!
  return { x: e.clientX - r.x, y: e.clientY - r.y }
}

// 在马赛克画布上以 (cx,cy)（相对选区的 CSS 坐标）为中心盖一块像素化方块。
// (ox,oy) 是选区原点在屏幕中的坐标，用于换算回原图取像素。
const MOSAIC_BLOCK = 16
function stampMosaic(
  cx: number,
  cy: number,
  img: HTMLImageElement,
  kx: number,
  ky: number,
  ox: number,
  oy: number
): void {
  mosaicCtx = mosaicEl.value?.getContext('2d') ?? null
  if (!mosaicCtx) return
  const x0 = cx - MOSAIC_BLOCK / 2
  const y0 = cy - MOSAIC_BLOCK / 2
  // 先把对应原图块缩到 5×5 再放大回来（关闭平滑），得到粗马赛格子
  const tmp = document.createElement('canvas')
  tmp.width = 5
  tmp.height = 5
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.imageSmoothingEnabled = true
  tctx.drawImage(
    img,
    Math.max(0, (ox + x0) * kx),
    Math.max(0, (oy + y0) * ky),
    MOSAIC_BLOCK * kx,
    MOSAIC_BLOCK * ky,
    0,
    0,
    5,
    5
  )
  mosaicCtx.imageSmoothingEnabled = false
  mosaicCtx.drawImage(tmp, 0, 0, 5, 5, x0, y0, MOSAIC_BLOCK, MOSAIC_BLOCK)
}
let lastStamp = { x: 0, y: 0 }
function strokeMosaicTo(
  x: number,
  y: number,
  img: HTMLImageElement,
  kx: number,
  ky: number,
  ox: number,
  oy: number
): void {
  const dx = x - lastStamp.x
  const dy = y - lastStamp.y
  const dist = Math.hypot(dx, dy)
  const step = MOSAIC_BLOCK / 2
  if (dist < step) {
    stampMosaic(x, y, img, kx, ky, ox, oy)
    return
  }
  const n = Math.ceil(dist / step)
  for (let i = 1; i <= n; i++) {
    stampMosaic(lastStamp.x + (dx * i) / n, lastStamp.y + (dy * i) / n, img, kx, ky, ox, oy)
  }
  lastStamp = { x, y }
}

async function startAnnotation(e: PointerEvent): Promise<boolean> {
  const r = rect.value
  const t = tool.value
  if (!r || t === 'select' || !pointInRect(e.clientX, e.clientY, r)) return false
  const p = relPos(e)
  drawing = true
  const id = shapeSeq++
  const lineSw = t === 'brush' ? 3 : 2
  if (t === 'rect' || t === 'ellipse') {
    draft.value = { id, tool: t, color: color.value, sw: lineSw, x: p.x, y: p.y, w: 0, h: 0 }
  } else if (t === 'arrow') {
    draft.value = { id, tool: t, color: color.value, sw: lineSw, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  } else if (t === 'brush') {
    draft.value = { id, tool: t, color: color.value, sw: lineSw, pts: [p] }
  } else if (t === 'mosaic') {
    const img = new Image()
    img.src = bg.value
    await img.decode()
    const pxW = pixels.value?.width || Math.round(window.innerWidth * scaleFactor.value)
    const pxH = pixels.value?.height || Math.round(window.innerHeight * scaleFactor.value)
    mosaicCtx = mosaicEl.value?.getContext('2d') ?? null
    mSnapshot = mosaicCtx?.getImageData(0, 0, Math.ceil(r.w), Math.ceil(r.h)) ?? null
    lastStamp = { x: p.x, y: p.y }
    stampMosaic(p.x, p.y, img, pxW / window.innerWidth, pxH / window.innerHeight, r.x, r.y)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    // 把 img/kx/ky 与选区原点挂到闭包变量上
    mosaicPaint = { img, kx: pxW / window.innerWidth, ky: pxH / window.innerHeight, ox: r.x, oy: r.y }
  }
  return true
}
let mosaicPaint: { img: HTMLImageElement; kx: number; ky: number; ox: number; oy: number } | null = null

function updateAnnotation(e: PointerEvent): void {
  if (!drawing || !rect.value) return
  const p = relPos(e)
  const d = draft.value
  if (d?.tool === 'rect' || d?.tool === 'ellipse') {
    const sx = (d as BoxShape).x
    const sy = (d as BoxShape).y
    d.x = Math.min(sx, p.x)
    d.y = Math.min(sy, p.y)
    d.w = Math.abs(p.x - sx)
    d.h = Math.abs(p.y - sy)
    draft.value = { ...d }
  } else if (d?.tool === 'arrow') {
    d.x2 = p.x
    d.y2 = p.y
    draft.value = { ...d }
  } else if (d?.tool === 'brush') {
    d.pts.push(p)
    draft.value = { ...d }
  }
}
function finishAnnotation(): void {
  if (!drawing) return
  drawing = false
  const t = tool.value
  if (t === 'mosaic') {
    if (mSnapshot) history.push({ kind: 'mosaic', data: mSnapshot })
    mSnapshot = null
    mosaicPaint = null
    return
  }
  const d = draft.value
  draft.value = null
  if (!d) return
  // 过滤几乎为零的误画图形
  if (
    (d.tool === 'rect' || d.tool === 'ellipse') &&
    (d as BoxShape).w < 3 &&
    (d as BoxShape).h < 3
  )
    return
  if (d.tool === 'arrow') {
    const a = d as ArrowShape
    if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 4) return
  }
  if (d.tool === 'brush' && (d as BrushShape).pts.length < 2) return
  shapes.value.push(d)
  history.push({ kind: 'shape' })
}

function undo(): void {
  const last = history.pop()
  if (!last) return
  if (last.kind === 'shape') shapes.value.pop()
  else mosaicEl.value?.getContext('2d')?.putImageData(last.data, 0, 0)
}

// ---------------- 指针主流程 ----------------
async function onPointerDown(e: PointerEvent): Promise<void> {
  if (busy.value || e.button !== 0) return
  const r = rect.value
  if (r && pointInRect(e.clientX, e.clientY, r) && tool.value !== 'select') {
    if (await startAnnotation(e)) return
  }
  if (r) {
    const edge = edgeAt(e.clientX, e.clientY, r)
    if (edge) {
      resizing.value = { edge, r0: { ...r } }
      return
    }
    if (pointInRect(e.clientX, e.clientY, r)) {
      moving.value = true
      moveOff = { x: e.clientX - r.x, y: e.clientY - r.y }
      return
    }
  }
  // 选区外 → 重新框选：清空已有标注
  moving.value = false
  dragging.value = true
  start.value = { x: e.clientX, y: e.clientY }
  current.value = { x: e.clientX, y: e.clientY }
  rect.value = null
  shapes.value = []
  draft.value = null
  history.length = 0
  if (mosaicEl.value) {
    const c = mosaicEl.value.getContext('2d')
    c?.clearRect(0, 0, mosaicEl.value.width, mosaicEl.value.height)
  }
  failed.value = ''
  tool.value = 'select'
}
function onPointerMove(e: PointerEvent): void {
  if (drawing && tool.value === 'mosaic' && mosaicPaint) {
    const p = relPos(e)
    strokeMosaicTo(p.x, p.y, mosaicPaint.img, mosaicPaint.kx, mosaicPaint.ky, mosaicPaint.ox, mosaicPaint.oy)
    return
  }
  if (drawing) {
    updateAnnotation(e)
    return
  }
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
    updateCursor(e)
    return
  }
  current.value = { x: e.clientX, y: e.clientY }
  rect.value = normalize()
  updateAnnotation(e)
}
function onPointerUp(): void {
  if (drawing) {
    finishAnnotation()
    return
  }
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
function stopDrag(e: Event): void {
  e.stopPropagation()
}

// ---------------- 导出 / OCR / 保存 / 钉住 ----------------
async function loadImg(): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = bg.value
  await img.decode()
  return img
}
// 以选区裁剪生成画布；withAnnotations 时合成标注
async function composite(withAnnotations: boolean): Promise<HTMLCanvasElement> {
  const r = rect.value
  if (!r) throw new Error('没有选区')
  const img = await loadImg()
  const pxW = pixels.value?.width || Math.round(window.innerWidth * scaleFactor.value)
  const pxH = pixels.value?.height || Math.round(window.innerHeight * scaleFactor.value)
  const kx = pxW / window.innerWidth
  const ky = pxH / window.innerHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(r.w * kx))
  canvas.height = Math.max(1, Math.round(r.h * ky))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.drawImage(
    img,
    Math.round(r.x * kx),
    Math.round(r.y * ky),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  if (withAnnotations && mosaicEl.value) {
    // 马赛克层画布与选区等大、坐标已是选区相对坐标，直接整张铺满
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(mosaicEl.value, 0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    const all = draft.value ? [...shapes.value, draft.value] : shapes.value
    const k = (kx + ky) / 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of all) {
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = Math.max(1, s.sw * k)
      if (s.tool === 'rect') {
        ctx.strokeRect(s.x * kx, s.y * ky, s.w * kx, s.h * ky)
      } else if (s.tool === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(
          (s.x + s.w / 2) * kx,
          (s.y + s.h / 2) * ky,
          Math.abs(s.w * kx) / 2,
          Math.abs(s.h * ky) / 2,
          0,
          0,
          Math.PI * 2
        )
        ctx.stroke()
      } else if (s.tool === 'arrow') {
        const x1 = s.x1 * kx
        const y1 = s.y1 * ky
        const x2 = s.x2 * kx
        const y2 = s.y2 * ky
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        const ang = Math.atan2(y2 - y1, x2 - x1)
        const head = 10 * k
        for (const a of [ang + Math.PI - Math.PI / 6, ang + Math.PI + Math.PI / 6]) {
          ctx.beginPath()
          ctx.moveTo(x2, y2)
          ctx.lineTo(x2 + head * Math.cos(a), y2 + head * Math.sin(a))
          ctx.stroke()
        }
      } else if (s.tool === 'brush') {
        ctx.beginPath()
        s.pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * kx, p.y * ky)
          else ctx.lineTo(p.x * kx, p.y * ky)
        })
        ctx.stroke()
      }
    }
  }
  return canvas
}

// OCR 输入分辨率归一化到讯飞 [50×50, 6000×6000]
function normalizeForOcr(src: HTMLCanvasElement): HTMLCanvasElement {
  let out: HTMLCanvasElement = src
  if (out.width < 50 || out.height < 50) {
    const padded = document.createElement('canvas')
    padded.width = Math.max(50, out.width)
    padded.height = Math.max(50, out.height)
    const pctx = padded.getContext('2d')!
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
    scaled.getContext('2d')!.drawImage(out, 0, 0, scaled.width, scaled.height)
    out = scaled
  }
  return out
}

async function doOcr(): Promise<void> {
  const r = rect.value
  if (!r || busy.value) return
  busy.value = true
  try {
    const raw = await composite(false)
    const out = normalizeForOcr(raw)
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
    if (!blob) throw new Error('截图生成失败')
    // 识别成功后主进程结束选区会话，悬浮球面板会弹出 OCR 结果
    await window.mook.shot.overlayOcr(await blob.arrayBuffer())
  } catch (e) {
    // 失败时保留选区，提示后可重试
    busy.value = false
    showToast('提取文字失败：' + String(e))
  }
}

async function doSave(): Promise<void> {
  if (!rect.value || busy.value) return
  busy.value = true
  try {
    const canvas = await composite(true)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('截图生成失败')
    const r = await window.mook.shot.overlaySave(await blob.arrayBuffer())
    if (!r.ok && !r.canceled) throw new Error('保存失败')
    // 保存成功后窗口由主进程销毁
  } catch (e) {
    busy.value = false
    showToast('保存失败：' + String(e))
  }
}

async function doPin(): Promise<void> {
  const r = rect.value
  if (!r || busy.value) return
  busy.value = true
  try {
    const canvas = await composite(true)
    const dataUrl = canvas.toDataURL('image/png')
    await window.mook.shot.overlayPin({
      dataUrl,
      width: Math.round(r.w),
      height: Math.round(r.h),
      x: Math.round(r.x),
      y: Math.round(r.y)
    })
  } catch (e) {
    busy.value = false
    showToast('钉图失败：' + String(e))
  }
}

async function cancel(): Promise<void> {
  try {
    await window.mook.shot.overlayCancel()
  } catch {
    // 窗口销毁等情况下忽略
  }
}
function onKey(e: KeyboardEvent): void {
  if (busy.value) return
  if (e.key === 'Escape') void cancel()
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undo()
}

// ---------------- 视图绑定 ----------------
const TOOLBAR_W = 690
const TOOLBAR_H = 40
const toolbarStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  const W = window.innerWidth
  const H = window.innerHeight
  let top: number
  if (r.y + r.h + TOOLBAR_H < H - 4) top = r.y + r.h + 8
  else if (r.y - TOOLBAR_H > 4) top = r.y - TOOLBAR_H + 4
  else top = r.y + 8
  const x = Math.min(Math.max(r.x, 8), W - TOOLBAR_W - 8)
  return { left: x + 'px', top: top + 'px' }
})
const selStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }
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
const svgStyle = computed(() => {
  const r = rect.value
  if (!r) return {}
  return { width: r.w + 'px', height: r.h + 'px' }
})
// 模板用的扁平化、带判别字段的图形视图（避免模板里写 TS as 断言）
type ViewShape =
  | { id: number; kind: 'rect' | 'ellipse'; color: string; sw: number; x: number; y: number; w: number; h: number }
  | { id: number; kind: 'arrow'; color: string; sw: number; x1: number; y1: number; x2: number; y2: number; ax1: number; ay1: number; ax2: number; ay2: number }
  | { id: number; kind: 'brush'; color: string; sw: number; points: string }

const viewShapes = computed<ViewShape[]>(() => {
  const all = draft.value ? [...shapes.value, draft.value] : shapes.value
  return all.map((s): ViewShape => {
    if (s.tool === 'rect' || s.tool === 'ellipse') {
      return { id: s.id, kind: s.tool, color: s.color, sw: s.sw, x: s.x, y: s.y, w: s.w, h: s.h }
    }
    if (s.tool === 'arrow') {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const head = Math.max(10, s.sw * 5)
      const wing = Math.PI / 6
      return {
        id: s.id,
        kind: 'arrow',
        color: s.color,
        sw: s.sw,
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        ax1: s.x2 + head * Math.cos(ang + Math.PI - wing),
        ay1: s.y2 + head * Math.sin(ang + Math.PI - wing),
        ax2: s.x2 + head * Math.cos(ang + Math.PI + wing),
        ay2: s.y2 + head * Math.sin(ang + Math.PI + wing)
      }
    }
    return { id: s.id, kind: 'brush', color: s.color, sw: s.sw, points: s.pts.map((p) => `${p.x},${p.y}`).join(' ') }
  })
})

function pickTool(t: Tool): void {
  if (busy.value) return
  tool.value = t
}

onMounted(async () => {
  const info = await window.mook.shot.overlayInit(displayId)
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
    :class="[
      resizing ? 'cur-' + resizing.edge : cursorClass,
      { grabbing: moving }
    ]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @contextmenu.prevent="cancel"
  >
    <template v-if="bg">
      <img class="bg-dim" :src="bg" draggable="false" />
      <div v-if="rect" class="sel" :style="selStyle">
        <img class="bg-bright" :src="bg" draggable="false" :style="brightStyle" />
        <canvas ref="mosaicEl" class="mosaic-layer" :width="Math.ceil(rect.w)" :height="Math.ceil(rect.h)"></canvas>
        <svg class="shape-layer" :style="svgStyle" :viewBox="`0 0 ${rect.w} ${rect.h}`" preserveAspectRatio="none">
          <template v-for="s in viewShapes" :key="s.id">
            <rect
              v-if="s.kind === 'rect'"
              :x="s.x" :y="s.y" :width="s.w" :height="s.h"
              fill="none" :stroke="s.color" :stroke-width="s.sw"
            />
            <ellipse
              v-else-if="s.kind === 'ellipse'"
              :cx="s.x + s.w / 2" :cy="s.y + s.h / 2"
              :rx="Math.abs(s.w) / 2" :ry="Math.abs(s.h) / 2"
              fill="none" :stroke="s.color" :stroke-width="s.sw"
            />
            <g v-else-if="s.kind === 'arrow'" :stroke="s.color" :stroke-width="s.sw"
              stroke-linecap="round" fill="none">
              <line :x1="s.x1" :y1="s.y1" :x2="s.x2" :y2="s.y2" />
              <line :x1="s.x2" :y1="s.y2" :x2="s.ax1" :y2="s.ay1" />
              <line :x1="s.x2" :y1="s.y2" :x2="s.ax2" :y2="s.ay2" />
            </g>
            <polyline
              v-else-if="s.kind === 'brush'"
              :points="s.points"
              fill="none" :stroke="s.color" :stroke-width="s.sw"
              stroke-linecap="round" stroke-linejoin="round"
            />
          </template>
        </svg>
        <span v-for="h in EDGE_HANDLES" :key="h" class="handle" :class="'h-' + h" />
      </div>

      <!-- 标注工具条 -->
      <div
        v-if="rect && !busy && toolbarVisible"
        class="toolbar"
        :style="toolbarStyle"
        @pointerdown="stopDrag"
        @pointermove.stop
        @pointerup.stop
      >
        <button class="t-btn" :class="{ on: tool === 'rect' }" title="矩形" @click="pickTool('rect')">
          <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <button class="t-btn" :class="{ on: tool === 'ellipse' }" title="椭圆" @click="pickTool('ellipse')">
          <svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <button class="t-btn" :class="{ on: tool === 'arrow' }" title="箭头" @click="pickTool('arrow')">
          <svg viewBox="0 0 24 24"><path d="M4 18 L19 5 M11 5h8v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="t-btn" :class="{ on: tool === 'brush' }" title="画笔" @click="pickTool('brush')">
          <svg viewBox="0 0 24 24"><path d="M4 20c3-1 5-3 7-5l5-5-3-3-5 5c-2 2-4 4-5 7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
        <button class="t-btn" :class="{ on: tool === 'mosaic' }" title="马赛克" @click="pickTool('mosaic')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="5" height="5"/><rect x="10" y="4" width="4" height="4" opacity=".55"/><rect x="15" y="4" width="5" height="5"/>
            <rect x="4" y="10" width="4" height="4" opacity=".55"/><rect x="9" y="9" width="6" height="6"/><rect x="16" y="10" width="4" height="4" opacity=".55"/>
            <rect x="4" y="15" width="5" height="5"/><rect x="10" y="16" width="4" height="4" opacity=".55"/><rect x="15" y="15" width="5" height="5"/>
          </svg>
        </button>
        <template v-if="colorRowVisible">
          <span class="t-sep"></span>
          <span class="colors">
            <button
              v-for="c in COLORS" :key="c" class="color-dot"
              :class="{ on: color === c }" :style="{ background: c }"
              @click="color = c"
            ></button>
          </span>
        </template>
        <button class="t-btn" title="撤销" @click="undo">
          <svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="scale(1,-1) translate(0,-24)"/></svg>
        </button>
        <span class="t-sep"></span>
        <button class="t-btn wide" title="提取选区内文字（OCR）" @click="doOcr">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          提取文字
        </button>
        <button class="t-btn wide" title="保存为 PNG" @click="doSave">
          <svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          保存
        </button>
        <button class="t-btn wide" title="钉在桌面上" @click="doPin">
          <svg viewBox="0 0 24 24"><path d="M14 3l7 7-4 1-4 4-1 6-2-2-5-5-2-1 6-1 4-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          钉住
        </button>
        <button class="t-btn close" title="关闭（Esc）" @click="cancel">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div v-if="!busy" class="hint">
        {{ rect ? '拖内部移动，拖边缘/角调整大小；选工具标注，右键 / Esc 退出' : '拖拽框选要截取的区域，右键 / Esc 退出' }}
      </div>
      <div v-if="toast" class="toast">{{ toast }}</div>
      <div v-if="failed" class="error">{{ failed }}</div>
    </template>
    <div v-else class="loading">{{ failed || '正在准备截屏…' }}</div>
    <div v-if="busy" class="loading">处理中…</div>
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
.cap.cur-move { cursor: move; }
.cap.grabbing { cursor: grabbing; }
.cap.cur-draw { cursor: crosshair; }
.cap.cur-n, .cap.cur-s { cursor: ns-resize; }
.cap.cur-e, .cap.cur-w { cursor: ew-resize; }
.cap.cur-nw, .cap.cur-se { cursor: nwse-resize; }
.cap.cur-ne, .cap.cur-sw { cursor: nesw-resize; }
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
.bg-bright { position: absolute; pointer-events: none; }
.mosaic-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}
.shape-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  overflow: visible;
}
/* 隐形热区手柄，仅四角用低透明短线暗示可拖 */
.handle {
  position: absolute;
  width: 14px;
  height: 14px;
  background: transparent;
  border: none;
  pointer-events: none;
  z-index: 5;
}
.h-nw, .h-ne, .h-sw, .h-se { width: 16px; height: 16px; }
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
.h-nw::after { left: 0; top: 0; width: 2px; height: 12px; }
.h-ne { right: 0; top: 0; }
.h-ne::before { right: 0; top: 0; width: 12px; height: 2px; }
.h-ne::after { right: 0; top: 0; width: 2px; height: 12px; }
.h-sw { left: 0; bottom: 0; }
.h-sw::before { left: 0; bottom: 0; width: 12px; height: 2px; }
.h-sw::after { left: 0; bottom: 0; width: 2px; height: 12px; }
.h-se { right: 0; bottom: 0; }
.h-se::before { right: 0; bottom: 0; width: 12px; height: 2px; }
.h-se::after { right: 0; bottom: 0; width: 2px; height: 12px; }
.h-n { left: calc(50% - 7px); top: 0; width: 14px; height: 10px; }
.h-e { right: 0; top: calc(50% - 7px); width: 10px; height: 14px; }
.h-s { left: calc(50% - 7px); bottom: 0; width: 14px; height: 10px; }
.h-w { left: 0; top: calc(50% - 7px); width: 10px; height: 14px; }
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
.toast {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 18px;
  border-radius: 10px;
  background: rgba(17, 17, 17, 0.85);
  color: #fff;
  font-size: 13px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
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
  z-index: 20;
}
/* 工具条 */
.toolbar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 2px;
  height: TOOLBAR_H;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(24, 24, 27, 0.94);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  color: #e8e8ea;
  pointer-events: auto;
}
.t-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  min-width: 30px;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #e8e8ea;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.t-btn svg { width: 17px; height: 17px; }
.t-btn:hover { background: rgba(255, 255, 255, 0.14); }
.t-btn.on { background: rgba(43, 110, 243, 0.85); color: #fff; }
.t-btn.wide { padding: 0 8px; }
.t-btn.close:hover { background: rgba(220, 60, 60, 0.85); }
.t-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.18);
}
.colors { display: flex; align-items: center; gap: 5px; padding: 0 2px; }
.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  cursor: pointer;
  padding: 0;
}
.color-dot.on {
  outline: 2px solid #fff;
  outline-offset: 1px;
}
</style>
