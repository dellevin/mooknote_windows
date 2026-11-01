<script setup lang="ts">
// 桌面悬浮球本体：独立透明置顶窗。按住拖动改变位置（主进程按全局光标移动窗口），
// 单击（未发生拖动）切换功能面板。识别期间显示转圈。
import { onBeforeUnmount, onMounted, ref } from 'vue'

const busy = ref(false)
let dragging = false
let moved = false
let downX = 0
let downY = 0
const MOVE_TOL = 5

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  moved = false
  downX = e.screenX
  downY = e.screenY
  window.mook.float.dragStart()
}
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  if (!moved && Math.abs(e.screenX - downX) < MOVE_TOL && Math.abs(e.screenY - downY) < MOVE_TOL) {
    return
  }
  moved = true
  window.mook.float.dragMove()
}
function onPointerUp(): void {
  if (!dragging) return
  dragging = false
  window.mook.float.dragEnd()
  // 未发生拖动视为点击：显示/隐藏面板
  if (!moved) void window.mook.float.toggleMenu()
}

let offBusy: (() => void) | null = null
onMounted(() => {
  offBusy = window.mook.float.onBusy((b) => {
    busy.value = b
  })
})
onBeforeUnmount(() => {
  offBusy?.()
})
</script>

<template>
  <div
    class="ball"
    :class="{ busy }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <span v-if="!busy" class="glyph">M</span>
    <span v-else class="spin" />
  </div>
</template>

<style scoped>
.ball {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: var(--ball-ink, #1f2329);
  background: var(--ball-bg, #ffffff);
  border: 1px solid rgba(17, 17, 17, 0.12);
  transition:
    transform 0.12s ease,
    filter 0.12s ease;
  -webkit-app-region: no-drag;
  touch-action: none;
}
.ball:hover {
  filter: brightness(1.08);
  transform: scale(1.05);
}
.ball:active {
  cursor: grabbing;
}
.ball.busy {
  pointer-events: none;
}
.glyph {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--ball-ink, #1f2329);
  user-select: none;
}
.spin {
  width: 22px;
  height: 22px;
  border: 2.5px solid color-mix(in srgb, var(--ball-ink, #1f2329) 35%, transparent);
  border-top-color: var(--ball-ink, #1f2329);
  border-radius: 50%;
  animation: rotate 0.7s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
