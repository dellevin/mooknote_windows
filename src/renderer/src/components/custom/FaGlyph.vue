<script setup lang="ts">
import { computed } from 'vue'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

const props = withDefaults(
  defineProps<{ def: IconDefinition; size?: number }>(),
  { size: 18 }
)
const w = computed(() => props.def.icon[0] as number)
const h = computed(() => props.def.icon[1] as number)
const d = computed(() => props.def.icon[4] as string)
</script>

<template>
  <svg
    :viewBox="`0 0 ${w} ${h}`"
    :width="size"
    :height="size"
    fill="currentColor"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>
