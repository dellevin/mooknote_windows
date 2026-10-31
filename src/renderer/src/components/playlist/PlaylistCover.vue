<script setup lang="ts">
import { computed } from 'vue'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{ covers: (string | null)[] }>()

// 取前 4 张非空封面：1 张独占、2 张左右、3 张上二下一、4 张四角
const imgs = computed(() =>
  props.covers.filter((c: string | null): c is string => !!c).slice(0, 4)
)
</script>

<template>
  <div class="pl-cover" :class="`n${imgs.length}`">
    <img v-for="(c, i) in imgs" :key="i" :src="toImgUrl(c)" />
    <div v-if="!imgs.length" class="empty">片单</div>
  </div>
</template>

<style scoped>
.pl-cover {
  width: 100%;
  height: 100%;
  display: grid;
  gap: 2px;
  background: #e2e5ee;
  border-radius: 10px;
  overflow: hidden;
}
/* 1 张：独占封面 */
.pl-cover.n1 {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}
/* 2 张：左右各半 */
.pl-cover.n2 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr;
}
/* 3 张：上两张、下一张通栏 */
.pl-cover.n3 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.pl-cover.n3 img:nth-child(3) {
  grid-column: 1 / 3;
}
/* 4 张：四角 2x2 */
.pl-cover.n4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.pl-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 14px;
}
</style>
