<script setup lang="ts">
// 钉在桌面的截图小窗：整窗可拖动，右上角 × 关闭。图片由主进程 shot:pin-init 下发。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const dataUrl = ref('')
const failed = ref(false)

onMounted(async () => {
  const id = String(route.query.id ?? '')
  const url = await window.mook.shot.pinInit(id)
  if (url) dataUrl.value = url
  else failed.value = true
  window.addEventListener('wheel', onWheel, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('wheel', onWheel)
})

// 滚轮上滑放大、下滑缩小；用指数系数让触控板连续滑动也平滑，主进程负责限制最大/最小
function onWheel(e: WheelEvent): void {
  if (!e.deltaY) return
  window.mook.shot.pinZoom(Math.exp(-e.deltaY * 0.0015))
}

// 自定义拖动（窗口未用 app-region:drag，否则会吞掉滚轮）。按下后指针捕获，移动即通知主进程。
let dragging = false
function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.mook.shot.pinDragStart()
}
function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  window.mook.shot.pinDragMove()
}
function onPointerUp(): void {
  dragging = false
}

function close(): void {
  window.mook.shot.pinClose()
}
</script>

<template>
  <div
    class="pin-root"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <img v-if="dataUrl" class="pin-img" :src="dataUrl" draggable="false" />
    <div v-else class="pin-err">{{ failed ? '图片已失效' : '' }}</div>
    <button class="pin-x" title="关闭" @pointerdown.stop @click="close">×</button>
  </div>
</template>

<style scoped>
.pin-root {
  position: fixed;
  inset: 0;
  background: transparent;
  overflow: hidden;
  cursor: move;
  /* 不用 -webkit-app-region:drag：那会吞掉滚轮，缩放由 pointer 事件在主进程实现拖动 */
}
.pin-img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.pin-x {
  position: fixed;
  top: 2px;
  right: 2px;
  z-index: 10;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.pin-x:hover {
  background: rgba(220, 60, 60, 0.9);
}
.pin-err {
  width: 100%;
  height: 100%;
}
</style>
