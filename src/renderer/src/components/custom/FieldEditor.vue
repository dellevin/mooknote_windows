<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NInput,
  NInputNumber,
  NRate,
  NDynamicTags,
  NDatePicker,
  NButton,
  NImage,
  NSpin
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

const posterLoading = ref(false)
const imagesLoading = ref(false)

async function pickPoster(): Promise<void> {
  if (posterLoading.value) return
  posterLoading.value = true
  try {
    const p = await window.mook.customItem.pickPoster(props.moduleId, props.itemId)
    if (p) poster.value = p
  } finally {
    posterLoading.value = false
  }
}
async function pickImages(): Promise<void> {
  if (imagesLoading.value) return
  imagesLoading.value = true
  try {
    const paths = await window.mook.customItem.pickImages(props.moduleId, props.itemId)
    images.value = [...images.value, ...paths]
  } finally {
    imagesLoading.value = false
  }
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
      class="grow num"
    />
    <NDatePicker
      v-else-if="field.type === 'date'"
      v-model:value="dateTs"
      type="date"
      clearable
      class="grow date"
    />
    <div v-else-if="field.type === 'duration'" class="dur">
      <NInputNumber v-model:value="numVal" :min="0" show-button class="grow num" />
      <span class="unit">分钟</span>
    </div>
    <div v-else-if="field.type === 'progress'" class="progress">
      <NInputNumber
        :value="progress.current"
        :min="0"
        placeholder="当前"
        class="grow num"
        @update:value="(v: number | null) => (progress = { ...progress, current: v ?? 0 })"
      />
      <span class="sep">/</span>
      <NInputNumber
        :value="progress.total"
        :min="0"
        placeholder="总量"
        class="grow num"
        @update:value="(v: number | null) => (progress = { ...progress, total: v ?? 0 })"
      />
    </div>
    <NDatePicker
      v-else-if="field.type === 'dateRange'"
      v-model:value="rangeTs"
      type="daterange"
      clearable
      class="grow range"
    />
    <div v-else-if="field.type === 'poster'" class="poster">
      <button
        type="button"
        class="poster-drop"
        :class="{ loading: posterLoading }"
        :disabled="posterLoading"
        @click="pickPoster"
      >
        <img v-if="poster" :src="toImgUrl(poster)" class="poster-img" alt="封面" />
        <NSpin v-else-if="posterLoading" size="small" />
        <template v-else-if="!poster">
          <span class="poster-plus">＋</span>
          <span class="poster-tx">点击上传封面</span>
          <span class="poster-sub">建议比例 3:4</span>
        </template>
        <div v-if="posterLoading && poster" class="poster-mask"><NSpin size="small" /></div>
      </button>
      <div v-if="poster" class="poster-actions">
        <NButton size="tiny" :loading="posterLoading" @click="pickPoster">更换</NButton>
        <NButton
          size="tiny"
          quaternary
          type="error"
          :disabled="posterLoading"
          @click="poster = null"
        >
          移除
        </NButton>
      </div>
    </div>
    <div v-else-if="field.type === 'multiImage'" class="multi-img">
      <div v-for="(img, i) in images" :key="img" class="img-cell">
        <NImage :src="toImgUrl(img)" object-fit="contain" class="thumb" />
        <button class="img-del" @click="images.splice(i, 1)">✕</button>
      </div>
      <button
        type="button"
        class="img-add"
        :class="{ loading: imagesLoading }"
        :disabled="imagesLoading"
        @click="pickImages"
      >
        <NSpin v-if="imagesLoading" size="small" />
        <template v-else>
          <span class="img-plus">＋</span>
          <span class="img-add-tx">图片</span>
        </template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.field-editor {
  width: 100%;
}
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
/* 控件填满所在格子 */
.grow {
  width: 100%;
}
.num {
  min-width: 0;
}
.dur {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dur .unit {
  flex-shrink: 0;
}
.unit {
  font-size: 13px;
  color: var(--text-dim);
}
.progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
.progress .num {
  flex: 1;
}
.sep {
  flex-shrink: 0;
  color: var(--text-dim);
}

/* 封面：竖版海报占位 */
.poster {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
}
.poster-drop {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  height: auto;
  flex-shrink: 0;
  border: 1.5px dashed var(--stroke-strong);
  border-radius: 8px;
  background: var(--app-bg);
  cursor: pointer;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  transition:
    border-color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.poster-drop:hover:not(:disabled) {
  border-color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
}
.poster-drop:disabled {
  cursor: wait;
}
.poster-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.62);
  border-radius: 6px;
}
.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
}
.poster-plus {
  font-size: 26px;
  line-height: 1;
  color: var(--text-dim);
}
.poster-tx {
  font-size: 12.5px;
  color: var(--text);
}
.poster-sub {
  font-size: 11px;
  color: var(--text-dim);
}
.poster-actions {
  display: flex;
  gap: 6px;
}
.poster-actions :deep(.n-button) {
  flex: 1;
}

/* 多图：方形网格 */
.multi-img {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
}
.img-cell {
  position: relative;
  flex-shrink: 0;
  line-height: 0;
}
.img-cell :deep(.thumb),
.img-cell :deep(.thumb img) {
  height: 96px;
  width: auto;
  max-width: 190px;
  min-width: 72px;
  border-radius: 6px;
  display: block;
}
.img-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-del:hover {
  background: #e04f5f;
}
.img-add {
  width: 76px;
  height: 76px;
  border: 1.5px dashed var(--stroke-strong);
  border-radius: 6px;
  background: var(--app-bg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition:
    border-color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.img-add:hover:not(:disabled) {
  border-color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
}
.img-add:disabled {
  cursor: wait;
}
.img-plus {
  font-size: 20px;
  line-height: 1;
  color: var(--text-dim);
}
.img-add-tx {
  font-size: 11px;
  color: var(--text-dim);
}
</style>
