<script setup lang="ts">
import { CUSTOM_MODULE_ICONS, iconValue } from '@/utils/customIcons'
import ModuleIcon from './ModuleIcon.vue'

const props = defineProps<{ value: string }>()
const emit = defineEmits<{
  (e: 'update:value', v: string): void
}>()

function pick(v: string): void {
  // 再次点击已选中的图标 = 取消选择
  emit('update:value', props.value === v ? '' : v)
}
</script>

<template>
  <div class="picker">
    <button
      v-for="d in CUSTOM_MODULE_ICONS"
      :key="d.iconName"
      type="button"
      class="cell"
      :class="{ on: value === iconValue(d) }"
      :title="d.iconName"
      @click="pick(iconValue(d))"
    >
      <ModuleIcon :icon="iconValue(d)" :size="17" />
    </button>
  </div>
</template>

<style scoped>
.picker {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
  max-height: 188px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fafbfc;
}
.cell {
  aspect-ratio: 1;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(31, 35, 41, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}
.cell:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-strong);
}
.cell.on {
  background: var(--accent);
  color: var(--on-accent);
}
</style>
