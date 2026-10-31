<script setup lang="ts">
import { computed } from 'vue'
import {
  NInput,
  NInputNumber,
  NRate,
  NDynamicTags,
  NDatePicker,
  NButton,
  NImage,
  NSpace
} from 'naive-ui'
import type { CustomFieldDef, CustomFieldValue } from '@shared/types'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{
  field: CustomFieldDef
  modelValue: CustomFieldValue
  moduleId: string
  itemId: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: CustomFieldValue): void }>()

function set(v: CustomFieldValue): void {
  emit('update:modelValue', v)
}

const statusVal = computed<string | null>({
  get: () => (typeof props.modelValue === 'string' ? props.modelValue : null),
  set: (v) => set(v)
})
function toggleStatus(o: string): void {
  statusVal.value = statusVal.value === o ? null : o
}

// 日期：存储 ISO 字符串，控件用毫秒时间戳
const dateTs = computed<number | null>({
  get: () => {
    const v = props.modelValue
    return typeof v === 'string' && v ? new Date(v).getTime() : null
  },
  set: (ts) => set(ts ? new Date(ts).toISOString() : null)
})

const rangeTs = computed<[number, number] | null>({
  get: () => {
    const v = props.modelValue as { start: string | null; end: string | null } | null
    if (!v || !v.start || !v.end) return null
    return [new Date(v.start).getTime(), new Date(v.end).getTime()] as [number, number]
  },
  set: (val: [number, number] | null) => {
    if (!val) set({ start: null, end: null })
    else set({ start: new Date(val[0]).toISOString(), end: new Date(val[1]).toISOString() })
  }
})

const numVal = computed<number | null>({
  get: () => (typeof props.modelValue === 'number' ? props.modelValue : null),
  set: (v) => set(v ?? null)
})

const progress = computed<{ current: number; total: number }>({
  get: () => {
    const v = props.modelValue as { current: number; total: number } | null
    return { current: v?.current ?? 0, total: v?.total ?? 0 }
  },
  set: (v) => set(v)
})

const tags = computed<string[]>({
  get: () => (Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []),
  set: (v) => set(v)
})

const images = computed<string[]>({
  get: () => (Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []),
  set: (v) => set(v)
})

const poster = computed<string | null>({
  get: () => (typeof props.modelValue === 'string' ? props.modelValue : null),
  set: (v) => set(v)
})

async function pickPoster(): Promise<void> {
  const p = await window.mook.customItem.pickPoster(props.moduleId, props.itemId)
  if (p) poster.value = p
}
async function pickImages(): Promise<void> {
  const paths = await window.mook.customItem.pickImages(props.moduleId, props.itemId)
  images.value = [...images.value, ...paths]
}
</script>

<template>
  <div class="field-editor">
    <NInput
      v-if="field.type === 'text'"
      :value="(modelValue as string) ?? ''"
      :placeholder="field.label"
      @update:value="set"
    />
    <NInput
      v-else-if="field.type === 'longText'"
      type="textarea"
      :value="(modelValue as string) ?? ''"
      :placeholder="field.label"
      :autosize="{ minRows: 3, maxRows: 10 }"
      @update:value="set"
    />
    <NDynamicTags v-else-if="field.type === 'multiText'" v-model:value="tags" />
    <div v-else-if="field.type === 'status'" class="status-chips">
      <button
        v-for="o in field.options"
        :key="o"
        type="button"
        class="status-chip"
        :class="{ on: statusVal === o }"
        @click="toggleStatus(o)"
      >
        {{ o }}
      </button>
    </div>
    <NRate
      v-else-if="field.type === 'rating'"
      :value="numVal ?? 0"
      allow-half
      @update:value="(v: number) => set(v)"
    />
    <NInputNumber
      v-else-if="field.type === 'count'"
      v-model:value="numVal"
      :min="0"
      show-button
      class="num"
    />
    <NDatePicker
      v-else-if="field.type === 'date'"
      v-model:value="dateTs"
      type="date"
      clearable
      class="date"
    />
    <div v-else-if="field.type === 'duration'" class="dur">
      <NInputNumber v-model:value="numVal" :min="0" show-button class="num" />
      <span class="unit">分钟</span>
    </div>
    <div v-else-if="field.type === 'progress'" class="progress">
      <NInputNumber
        :value="progress.current"
        :min="0"
        placeholder="当前"
        class="num"
        @update:value="(v: number | null) => (progress = { ...progress, current: v ?? 0 })"
      />
      <span class="sep">/</span>
      <NInputNumber
        :value="progress.total"
        :min="0"
        placeholder="总量"
        class="num"
        @update:value="(v: number | null) => (progress = { ...progress, total: v ?? 0 })"
      />
    </div>
    <NDatePicker
      v-else-if="field.type === 'dateRange'"
      v-model:value="rangeTs"
      type="daterange"
      clearable
      class="range"
    />
    <div v-else-if="field.type === 'poster'" class="poster">
      <NImage v-if="poster" :src="toImgUrl(poster)" object-fit="cover" class="thumb" />
      <NButton size="small" @click="pickPoster">{{ poster ? '更换封面' : '选择封面' }}</NButton>
    </div>
    <div v-else-if="field.type === 'multiImage'" class="multi-img">
      <NSpace :size="6">
        <div v-for="(img, i) in images" :key="img" class="img-cell">
          <NImage :src="toImgUrl(img)" object-fit="cover" class="thumb" />
          <button class="img-del" @click="images.splice(i, 1)">✕</button>
        </div>
        <NButton size="small" @click="pickImages">＋ 图片</NButton>
      </NSpace>
    </div>
  </div>
</template>

<style scoped>
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.status-chip {
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid #eceef2;
  background: #f4f5f8;
  color: #4b5563;
  cursor: pointer;
  transition:
    color 0.15s,
    background-color 0.15s,
    border-color 0.15s;
}
.status-chip:hover {
  border-color: color-mix(in srgb, var(--accent-ink) 40%, var(--surface));
}
.status-chip.on {
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent-ink);
  font-weight: 500;
}
.num {
  width: 160px;
}
.date {
  width: 200px;
}
.range {
  width: 320px;
}
.dur {
  display: flex;
  align-items: center;
  gap: 8px;
}
.unit {
  font-size: 13px;
  color: #6b7280;
}
.progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sep {
  color: #9aa0ac;
}
.poster {
  display: flex;
  align-items: center;
  gap: 12px;
}
.thumb {
  width: 72px;
  height: 72px;
  border-radius: 8px;
}
.img-cell {
  position: relative;
  width: 72px;
  height: 72px;
}
.img-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
}
</style>
