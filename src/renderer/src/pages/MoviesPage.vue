<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  NButton,
  NInput,
  NSelect,
  NSpin,
  useDialog
} from 'naive-ui'
import { useMovieStore } from '@/stores/movie'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import { MOVIE_STATUS_LABELS, MOVIE_SORT_LABELS, type MovieStatus } from '@shared/types'
import PosterCard from '@/components/PosterCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import MovieFormModal from '@/components/MovieFormModal.vue'
import MovieDetailModal from '@/components/MovieDetailModal.vue'
import RecycleBinModal from '@/components/RecycleBinModal.vue'

const store = useMovieStore()
const dialog = useDialog()
const { movies, loading, loadingMore, hasMore, status, sortMode, counts } = storeToRefs(store)
const sentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(
  sentinel,
  () => store.loadMore(),
  {
    root: () => document.querySelector('.content'),
    canLoad: () => hasMore.value && !loadingMore.value
  }
)

const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => movies.value.length > 0 && selectedIds.value.size === movies.value.length
)

function enterSelect(): void {
  selectMode.value = true
  selectedIds.value = new Set()
}
function exitSelect(): void {
  selectMode.value = false
  selectedIds.value = new Set()
}
function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleSelectAll(): void {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(movies.value.map((m) => m.id))
}
function batchDelete(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定将选中的 ${n} 部影视移入回收站吗？可在回收站恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.movie.softDelete(id))
      )
      exitSelect()
      await onChanged()
    }
  })
}

const tabs: { key: '' | MovieStatus; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'want_to_watch', label: MOVIE_STATUS_LABELS.want_to_watch },
  { key: 'watching', label: MOVIE_STATUS_LABELS.watching },
  { key: 'watched', label: MOVIE_STATUS_LABELS.watched }
]

const sortOptions = Object.entries(MOVIE_SORT_LABELS).map(([value, label]) => ({
  label,
  value: Number(value)
}))

const formShow = ref(false)
const formEditId = ref<string | null>(null)
const detailShow = ref(false)
const detailId = ref<string | null>(null)
const binShow = ref(false)
const formRef = ref<InstanceType<typeof MovieFormModal> | null>(null)

function openCreate(): void {
  formEditId.value = null
  formShow.value = true
  void formRef.value?.hydrate()
}

function openCard(id: string): void {
  detailId.value = id
  detailShow.value = true
}

function openEdit(id: string): void {
  detailShow.value = false
  formEditId.value = id
  formShow.value = true
  void formRef.value?.hydrate()
}

async function onChanged(): Promise<void> {
  await Promise.all([store.refresh(), store.refreshCounts()])
}

onMounted(() => {
  void onChanged()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-row">
        <div class="filters">
          <NInput
            :value="store.keyword"
            placeholder="搜索标题 / 别名"
            clearable
            round
            class="search"
            @update:value="store.search"
          >
            <template #prefix>
              <svg class="ic-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </template>
          </NInput>
          <NSelect
            :value="sortMode"
            :options="sortOptions"
            class="sort"
            :consistent-menu-width="false"
            @update:value="store.setSort"
          />
          <NButton v-if="!selectMode && movies.length" size="small" class="multi-btn" @click="enterSelect">
            <template #icon>
              <svg class="ic-multi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 17 2 2 4-4" />
                <path d="m3 7 2 2 4-4" />
                <line x1="13" x2="21" y1="6" y2="6" />
                <line x1="13" x2="21" y1="12" y2="12" />
                <line x1="13" x2="21" y1="18" y2="18" />
              </svg>
            </template>
            多选
          </NButton>
        </div>
      </div>
      <NButton quaternary class="bin-btn" @click="binShow = true">
        <svg class="ic-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" x2="10" y1="11" y2="17" />
          <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
        回收站
      </NButton>
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="['tab-' + (t.key || 'all'), { active: status === t.key }]"
          @click="store.setStatus(t.key)"
        >
          {{ t.label }}
          <span v-if="t.key && counts[t.key]" class="cnt">{{ counts[t.key] }}</span>
        </button>
      </div>
    </div>

    <NSpin :show="loading">
      <EmptyState v-if="!movies.length && !loading" kind="movie" description="还没有影视，点右下角按钮添加" />
      <div v-else class="grid">
        <PosterCard
          v-for="m in movies"
          :key="m.id"
          :movie="m"
          :select-mode="selectMode"
          :selected="selectedIds.has(m.id)"
          @open="openCard"
          @toggle="toggleSelect"
        />
      </div>
      <div v-if="hasMore" ref="sentinel" class="load-more">
        {{ loadingMore ? '加载中…' : '向下滚动加载更多' }}
      </div>
    </NSpin>

    <MovieFormModal
      ref="formRef"
      v-model:show="formShow"
      :edit-id="formEditId"
      @saved="onChanged"
    />
    <MovieDetailModal
      v-model:show="detailShow"
      :id="detailId"
      @edit="openEdit"
      @changed="onChanged"
    />
    <RecycleBinModal v-model:show="binShow" @changed="onChanged" />

    <Teleport to="body">
      <div v-if="selectMode" class="select-bar">
        <NButton size="small" quaternary @click="toggleSelectAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </NButton>
        <span class="sel-count">已选 {{ selectedIds.size }}</span>
        <NButton
          size="small"
          type="error"
          secondary
          :disabled="!selectedIds.size"
          @click="batchDelete"
        >
          删除
        </NButton>
        <NButton size="small" quaternary @click="exitSelect">取消</NButton>
      </div>
      <button v-else type="button" class="fab-add fab-movie" title="添加影视" @click="openCreate">＋</button>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  padding: 18px 24px 28px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 16px;
  row-gap: 12px;
  margin-bottom: 18px;
}
.toolbar-row {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.filters {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tabs {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tab {
  border: none;
  background: transparent;
  padding: 6px 14px;
  border-radius: 18px;
  font-size: 13px;
  color: #5b616c;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab.active {
  font-weight: 600;
}
.tab-all.active {
  background: #eef0f3;
  color: var(--text-strong);
}
.tab-want_to_watch.active {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
.tab-watching.active {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}
.tab-watched.active {
  background: rgba(22, 163, 74, 0.12);
  color: #16a34a;
}
.cnt {
  font-size: 11px;
  opacity: 0.7;
}
.search {
  width: 240px;
  max-width: 46vw;
}
.search :deep(.n-input) {
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
}
.search :deep(.n-input .n-input__border),
.search :deep(.n-input .n-input__state-border) {
  border: none;
}
.ic-search {
  width: 17px;
  height: 17px;
  color: #9aa0ac;
}
.sort {
  width: 140px;
}
.sort :deep(.n-base-selection) {
  border-radius: 999px;
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
}
.bin-btn {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  flex-shrink: 0;
}
.multi-btn {
  flex-shrink: 0;
  border-radius: 999px;
  height: 34px;
  padding: 0 16px;
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
  color: var(--text-strong);
  font-weight: 500;
}
.multi-btn:hover {
  background: #f5f6f8;
  color: #000;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.1);
}
.multi-btn:active {
  background: #eceef1;
}
.multi-btn :deep(.n-icon) {
  font-size: 15px;
  color: #5b616c;
}
.multi-btn:hover :deep(.n-icon) {
  color: var(--text-strong);
}
.ic-multi {
  width: 15px;
  height: 15px;
}
.ic-trash {
  width: 22px !important;
  height: 22px !important;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px 16px;
  align-content: start;
}
.load-more {
  padding: 18px 0 6px;
  text-align: center;
  font-size: 12.5px;
  color: #a8adb8;
}
.empty {
  margin-top: 80px;
}
</style>
