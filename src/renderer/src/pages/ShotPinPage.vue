<script setup lang="ts">
// 钉在桌面的截图小窗：整窗可拖动，右上角 × 关闭。图片由主进程 shot:pin-init 下发。
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const dataUrl = ref('')
const failed = ref(false)

onMounted(async () => {
  const id = String(route.query.id ?? '')
  const url = await window.mook.shot.pinInit(id)
  if (url) dataUrl.value = url
  else failed.value = true
})

function close(): void {
  window.mook.shot.pinClose()
}
</script>

<template>
  <div class="pin-root">
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
  /* 整窗可拖动 */
  -webkit-app-region: drag;
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
  -webkit-app-region: no-drag;
}
.pin-x:hover {
  background: rgba(220, 60, 60, 0.9);
}
.pin-err {
  width: 100%;
  height: 100%;
}
</style>
