<script setup lang="ts">
import { computed } from 'vue'
import { resolveModuleIcon, type ResolvedModuleIcon } from '@/utils/customIcons'

const props = withDefaults(
  defineProps<{ icon: string | null | undefined; size?: number }>(),
  { size: 18 }
)

const resolved = computed<ResolvedModuleIcon>(() => resolveModuleIcon(props.icon))
const faPath = computed(() =>
  resolved.value.kind === 'fa' ? resolved.value.def.icon[4] : ''
)
const faW = computed(() =>
  resolved.value.kind === 'fa' ? resolved.value.def.icon[0] : 0
)
const faH = computed(() =>
  resolved.value.kind === 'fa' ? resolved.value.def.icon[1] : 0
)
</script>

<template>
  <span class="mod-ic" :style="{ width: size + 'px', height: size + 'px' }">
    <svg
      v-if="resolved.kind === 'fa'"
      :viewBox="`0 0 ${faW} ${faH}`"
      :width="size"
      :height="size"
      fill="currentColor"
    >
      <path :d="faPath" />
    </svg>
    <span
      v-else-if="resolved.kind === 'text'"
      class="mod-ic-text"
      :style="{ fontSize: Math.round(size * 0.85) + 'px', lineHeight: 1 }"
      >{{ resolved.text }}</span
    >
    <svg
      v-else
      viewBox="0 0 24 24"
      :width="size"
      :height="size"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  </span>
</template>

<style scoped>
.mod-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mod-ic-text {
  display: inline-block;
  white-space: nowrap;
}
</style>
