<script setup lang="ts">
import { computed } from 'vue'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{ covers: (string | null)[] }>()

// 2x2 拼贴：取前 4 张非空封面
const cells = computed(() => {
  const valid = props.covers.filter((c): c is string => !!c).slice(0, 4)
  return [0, 1, 2, 3].map((i) => valid[i] ?? null)
})
</script>

<template>
  <div class="pl-cover" :class="{ single: cells.filter(Boolean).length === 1 }">
    <template v-if="cells.some(Boolean)">
      <img v-for="(c, i) in cells" :key="i" :src="c ? toImgUrl(c) : ''" v-show="!!c" />
    </template>
    <div v-else class="empty">片单</div>
  </div>
</template>

<style scoped>
.pl-cover {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;
  background: #e2e5ee;
  border-radius: 10px;
  overflow: hidden;
}
.pl-cover.single {
  display: block;
}
.pl-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty {
  grid-column: 1 / 3;
  grid-row: 1 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 14px;
}
</style>
