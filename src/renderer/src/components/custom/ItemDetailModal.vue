<script setup lang="ts">
import { computed } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NRate,
  NTag,
  NImage,
  NImageGroup,
  NPopconfirm
} from 'naive-ui'
import type { CustomModuleDesign, CustomModuleItem, CustomFieldValue } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'

const props = defineProps<{ show: boolean; design: CustomModuleDesign | null; item: CustomModuleItem | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'edit', item: CustomModuleItem): void
  (e: 'delete', item: CustomModuleItem): void
}>()

function val(key: string): CustomFieldValue {
  return props.item?.data[key] ?? null
}

function isEmpty(f: { type: string; key: string }): boolean {
  const v = val(f.key)
  if (v == null) return true
  if (typeof v === 'string') return !v.trim()
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('current' in o && 'total' in o) return !o.current && !o.total
    if ('start' in o && 'end' in o) return !o.start && !o.end
  }
  return false
}

const visibleFields = computed(() => (props.design?.fields ?? []).filter((f) => !isEmpty(f)))

function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} 小时 ${m} 分` : `${m} 分钟`
}
function isoDate(s: unknown): string {
  return typeof s === 'string' && s ? formatDate(s) : ''
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail" v-if="item">
      <div class="head">
        <h3>{{ item.title || '无标题条目' }}</h3>
        <NSpace :size="8">
          <NButton size="small" @click="emit('edit', item)">编辑</NButton>
          <NPopconfirm @positive-click="emit('delete', item)">
            <template #trigger>
              <NButton size="small" type="error" quaternary>删除</NButton>
            </template>
            移入回收站？
          </NPopconfirm>
        </NSpace>
      </div>

      <div class="body">
        <template v-for="f in visibleFields" :key="f.key">
          <!-- 封面：标题旁大图，单独占块 -->
          <div v-if="f.type === 'poster'" class="block">
            <NImage :src="toImgUrl(val(f.key) as string)" object-fit="cover" class="poster" />
          </div>

          <div v-else-if="f.type === 'longText'" class="block">
            <div class="label">{{ f.label }}</div>
            <div class="longtext">{{ val(f.key) }}</div>
          </div>

          <div v-else-if="f.type === 'multiText'" class="block">
            <div class="label">{{ f.label }}</div>
            <NSpace :size="6">
              <NTag v-for="t in (val(f.key) as string[])" :key="t" size="small" :bordered="false">
                {{ t }}
              </NTag>
            </NSpace>
          </div>

          <div v-else-if="f.type === 'multiImage'" class="block">
            <div class="label">{{ f.label }}</div>
            <NImageGroup>
              <NSpace :size="6">
                <NImage
                  v-for="img in (val(f.key) as string[])"
                  :key="img"
                  :src="toImgUrl(img)"
                  object-fit="cover"
                  class="thumb"
                />
              </NSpace>
            </NImageGroup>
          </div>

          <div v-else-if="f.type === 'rating'" class="row">
            <span class="label">{{ f.label }}</span>
            <NRate :value="(val(f.key) as number) ?? 0" readonly allow-half size="small" />
          </div>

          <div v-else-if="f.type === 'progress'" class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">{{ (val(f.key) as any).current }} / {{ (val(f.key) as any).total }}</span>
          </div>

          <div v-else-if="f.type === 'duration'" class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">{{ durationText(val(f.key) as number) }}</span>
          </div>

          <div v-else-if="f.type === 'dateRange'" class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">
              {{ isoDate((val(f.key) as any).start) }} ~ {{ isoDate((val(f.key) as any).end) }}
            </span>
          </div>

          <div v-else-if="f.type === 'date'" class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">{{ isoDate(val(f.key)) }}</span>
          </div>

          <div v-else-if="f.type === 'count'" class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">{{ val(f.key) }} 次</span>
          </div>

          <div v-else-if="f.type === 'status'" class="row">
            <span class="label">{{ f.label }}</span>
            <NTag size="small" type="info" :bordered="false">{{ val(f.key) }}</NTag>
          </div>

          <div v-else class="row">
            <span class="label">{{ f.label }}</span>
            <span class="value">{{ val(f.key) }}</span>
          </div>
        </template>
      </div>

      <div class="footer">
        <NSpace justify="end">
          <NButton @click="emit('update:show', false)">关闭</NButton>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.detail {
  width: 680px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.head h3 {
  font-size: 17px;
}
.body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.block {
  margin-bottom: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #f5f6f8;
}
.label {
  font-size: 13px;
  color: #9aa0ac;
  width: 84px;
  flex-shrink: 0;
}
.row .label {
  width: 84px;
}
.value {
  font-size: 14px;
  color: #2f3540;
}
.longtext {
  font-size: 14px;
  line-height: 1.8;
  color: #2f3540;
  white-space: pre-wrap;
  margin-top: 4px;
}
.poster {
  max-width: 200px;
  max-height: 280px;
  border-radius: 10px;
}
.thumb {
  width: 84px;
  height: 84px;
  border-radius: 8px;
}
.footer {
  margin-top: 12px;
}
</style>
