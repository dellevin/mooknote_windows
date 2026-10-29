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
import type { Book, Game, Movie } from '@shared/types'
import {
  BOOK_CATEGORY_LABELS,
  GAME_CATEGORY_LABELS,
  MOVIE_CATEGORY_LABELS
} from '@shared/types'
import { yearOf } from '@/utils/image'

type MediaKind = 'movie' | 'book' | 'game'
type Media = Movie | Book | Game
const dateField: Record<MediaKind, 'releaseDate' | 'publishDate' | 'releaseDate'> = {
  movie: 'releaseDate',
  book: 'publishDate',
  game: 'releaseDate'
}
const categoryLabels: Record<MediaKind, Record<string, string>> = {
  movie: MOVIE_CATEGORY_LABELS,
  book: BOOK_CATEGORY_LABELS,
  game: GAME_CATEGORY_LABELS
}
const titles: Record<MediaKind, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏'
}

const props = defineProps<{ show: boolean; kind: MediaKind }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
}>()

const items = ref<Media[]>([])
const loading = ref(false)
const selected = ref<Set<string>>(new Set())
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = (await window.mook[props.kind].list({ includeDeleted: true })) as Media[]
  } finally {
    loading.value = false
  }
}

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
  await Promise.all(ids.map((id) => window.mook[props.kind].restore(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}
async function batchPurge(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook[props.kind].purge(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}

async function restore(id: string): Promise<void> {
  await window.mook[props.kind].restore(id)
  await load()
  emit('changed')
}
async function purge(id: string): Promise<void> {
  await window.mook[props.kind].purge(id)
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
        <h3>回收站 · {{ titles[kind] }}</h3>
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
          选中的 {{ selected.size }} 项及其评价、图片等全部数据将被彻底删除，不可恢复。确定？
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
                {{ categoryLabels[kind][m.category] ?? m.category }}
              </NTag>
              <span class="y">
                {{ yearOf((m as unknown as Record<string, string | null>)[dateField[kind]]) }}
              </span>
            </div>
            <NSpace :size="8">
              <NButton size="tiny" @click="restore(m.id)">恢复</NButton>
              <NPopconfirm @positive-click="purge(m.id)">
                <template #trigger>
                  <NButton size="tiny" type="error" ghost>彻底删除</NButton>
                </template>
                将同时删除其评价、图片等全部数据，且不可恢复。确定？
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
  background: #fff;
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
.t {
  font-size: 14px;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.y {
  font-size: 12px;
  color: #9aa0ac;
}
.empty {
  padding: 40px 0;
}
</style>
