<script setup lang="ts">
// 桌面悬浮球本体：独立透明置顶窗。按住拖动改变位置（主进程按全局光标移动窗口），
// 单击（未发生拖动）切换功能面板，双击显示/隐藏主界面。识别期间显示转圈。
import { onBeforeUnmount, onMounted, ref } from 'vue'

const busy = ref(false)
// pressed：鼠标按下未松开；dragging：已超过容差、真正进入拖动（此刻才启动主进程移动）
let pressed = false
let dragging = false
let downX = 0
let downY = 0
const MOVE_TOL = 5
// 区分单击/双击：单击延迟 DBL_MS 再开菜单，期间第二次点击到来则改为切换主界面
let clickTimer: ReturnType<typeof setTimeout> | null = null
const DBL_MS = 240

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  pressed = true
  dragging = false
  downX = e.screenX
  downY = e.screenY
  // 捕获指针，快速移出/松手也能收到 move/up
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent): void {
  if (!pressed) return
  if (!dragging) {
    // 纯点击：未超过容差前绝不启动主进程，避免按下就反复 setPosition 抢焦、点不动
    if (Math.abs(e.screenX - downX) < MOVE_TOL && Math.abs(e.screenY - downY) < MOVE_TOL) {
      return
    }
    dragging = true
    window.mook.float.dragStart()
  }
  window.mook.float.dragMove()
}
function onPointerUp(): void {
  if (!pressed) return
  pressed = false
  const wasDragging = dragging
  dragging = false
  if (wasDragging) {
    window.mook.float.dragEnd()
    return
  }
  // 未发生拖动：等待 DBL_MS，第二次点击在窗口内到达即判为双击
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    void window.mook.float.toggleMain()
  } else {
    clickTimer = setTimeout(() => {
      clickTimer = null
      void window.mook.float.toggleMenu()
    }, DBL_MS)
  }
}

let offBusy: (() => void) | null = null
onMounted(() => {
  offBusy = window.mook.float.onBusy((b) => {
    busy.value = b
  })
})
onBeforeUnmount(() => {
  offBusy?.()
  if (clickTimer) clearTimeout(clickTimer)
})
</script>

<template>
  <!-- 外层固定 56x56 命中区（= 窗口尺寸），事件绑在这层，缩放不影响命中 -->
  <div
    class="ball-hit"
    :class="{ busy }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <!-- 内层小圆：hover 在 56 内放大，不超出窗口边界被裁 -->
    <div class="ball">
      <span v-if="!busy" class="glyph">
        <span class="flip">
          <span class="flip-m">M</span>
          <span class="flip-w">W</span>
        </span>
      </span>
      <span v-else class="spin" />
    </div>
  </div>
</template>

<style scoped>
/* 外层命中区：占满整个透明窗口，保证点击热区稳定，不做任何缩放 */
.ball-hit {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  -webkit-app-region: no-drag;
  touch-action: none;
}
.ball-hit:active {
  cursor: grabbing;
}
.ball-hit.busy {
  pointer-events: none;
}
/* 内层圆：基础 50px，四周留白，hover 放大到 ~54px 仍在 56 窗口内，不被裁切 */
.ball {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ball-ink, #1f2329);
  background: var(--ball-bg, #ffffff);
  border: 1px solid rgba(17, 17, 17, 0.12);
  transition:
    transform 0.12s ease,
    filter 0.12s ease;
}
.ball-hit:hover .ball {
  filter: brightness(1.06);
  transform: scale(1.08);
}
.glyph {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: var(--ball-ink, #1f2329);
  user-select: none;
  /* 3D 翻转容器：hover 时转两圈半（900deg），M/W 分别在正/背面，停止时刚好翻面 */
  perspective: 200px;
}
.flip {
  position: relative;
  display: inline-block;
  transform-style: preserve-3d;
  transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
}
.flip-m,
.flip-w {
  display: inline-block;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.flip-w {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
}
.ball-hit:hover .flip {
  transform: rotateY(900deg);
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
