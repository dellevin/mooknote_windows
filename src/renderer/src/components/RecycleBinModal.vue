<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NPopconfirm,
  NEmpty,
  NSpin,
  NTag,
  NCheckbox
} from 'naive-ui'
import type { Movie } from '@shared/types'
import { MOVIE_CATEGORY_LABELS } from '@shared/types'
import { yearOf } from '@/utils/image'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
}>()

const items = ref<Movie[]>([])
const loading = ref(false)
const selected = ref<Set<string>>(new Set())
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

watch(
  () => props.show,
  (s) => {
    if (s) {
      selected.value = new Set()
      void load()
    }
  }
)

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((m) => m.id))
}
async function batchRestore(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.movie.restore(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}
async function batchPurge(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.movie.purge(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.movie.list({ includeDeleted: true })
  } finally {
    loading.value = false
  }
}

async function restore(id: string): Promise<void> {
  await window.mook.movie.restore(id)
  await load()
  emit('changed')
}

async function purge(id: string): Promise<void> {
  await window.mook.movie.purge(id)
  await load()
  emit('changed')
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
    <div class="bin-card">
      <div class="head">
        <h3>回收站 · 影视</h3>
        <NButton size="small" quaternary @click="emit('update:show', false)">关闭</NButton>
      </div>
      <div v-if="items.length" class="bulk">
        <NCheckbox :checked="allSelected" @update:checked="toggleAll">全选</NCheckbox>
        <NButton size="tiny" :disabled="!selected.size" @click="batchRestore">
          批量恢复<span v-if="selected.size">（{{ selected.size }}）</span>
        </NButton>
        <NPopconfirm @positive-click="batchPurge">
          <template #trigger>
            <NButton size="tiny" type="error" ghost :disabled="!selected.size">
              批量删除<span v-if="selected.size">（{{ selected.size }}）</span>
            </NButton>
          </template>
          选中的 {{ selected.size }} 项及其评价、海报、分集等全部数据将被彻底删除，不可恢复。确定？
        </NPopconfirm>
      </div>
      <NSpin :show="loading" class="spin">
        <NEmpty v-if="!items.length && !loading" description="回收站是空的" class="empty" />
        <div v-else class="list">
          <div
            v-for="m in items"
            :key="m.id"
            class="row"
            :class="{ picked: selected.has(m.id) }"
          >
            <div class="info">
              <NCheckbox :checked="selected.has(m.id)" @update:checked="toggle(m.id)" />
              <span class="t">{{ m.title }}</span>
              <NTag size="tiny" :bordered="false">
                {{ MOVIE_CATEGORY_LABELS[m.category] ?? m.category }}
              </NTag>
              <span class="y">{{ yearOf(m.releaseDate) }}</span>
            </div>
            <NSpace :size="8">
              <NButton size="tiny" @click="restore(m.id)">恢复</NButton>
              <NPopconfirm @positive-click="purge(m.id)">
                <template #trigger>
                  <NButton size="tiny" type="error" ghost>彻底删除</NButton>
                </template>
                将同时删除其评价、海报、分集等全部数据，且不可恢复。确定？
              </NPopconfirm>
            </NSpace>
          </div>
        </div>
      </NSpin>
    </div>
  </NModal>
</template>

<style scoped>
.bin-card {
  width: 600px;
  max-width: 92vw;
  height: 66vh;
  background: var(--surface);
  border-radius: 14px;
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
}
.head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.head h3 {
  font-size: 16px;
}
.bulk {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.spin {
  flex: 1;
  min-height: 0;
  display: flex;
}
.spin :deep(.n-spin-container),
.spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 6px;
  border-radius: 8px;
  border-bottom: 1px solid #f2f3f6;
}
.row.picked {
  background: rgba(31, 35, 41, 0.05);
}
.info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.info .t {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t {
  font-size: 14px;
  color: var(--text-strong);
}
.y {
  font-size: 12px;
  color: #9aa0ac;
}
.empty {
  padding: 40px 0;
}
</style>
