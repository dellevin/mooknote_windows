<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { NButton, NInput, NSelect, NSpin, useDialog } from 'naive-ui'
import { createMediaStore } from '@/stores/media'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import {
  BOOK_STATUS_LABELS,
  BOOK_SORT_LABELS,
  BOOK_CATEGORY_LABELS,
  type Book,
  type BookStatus
} from '@shared/types'
import CoverCard from '@/components/CoverCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import MediaBinModal from '@/components/MediaBinModal.vue'
import BookFormModal from '@/components/book/BookFormModal.vue'
import BookDetailModal from '@/components/book/BookDetailModal.vue'

const store = createMediaStore('book')()
const dialog = useDialog()
const { items, loading, loadingMore, hasMore, status, sortMode, counts } = storeToRefs(store)
const books = computed<Book[]>(() => items.value as Book[])
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
  () => books.value.length > 0 && selectedIds.value.size === books.value.length
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
    : new Set(books.value.map((b) => b.id))
}
function batchDelete(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定将选中的 ${n} 本书移入回收站吗？可在回收站恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.book.softDelete(id))
      )
      exitSelect()
      await onChanged()
    }
  })
}

const tabs: { key: '' | BookStatus; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'want_to_read', label: BOOK_STATUS_LABELS.want_to_read },
  { key: 'reading', label: BOOK_STATUS_LABELS.reading },
  { key: 'read', label: BOOK_STATUS_LABELS.read },
  { key: 'abandoned', label: BOOK_STATUS_LABELS.abandoned }
]
const sortOptions = Object.entries(BOOK_SORT_LABELS).map(([value, label]) => ({
  label,
  value: Number(value)
}))
const categoryOptions = [
  { label: '全部分类', value: '' },
  ...Object.entries(BOOK_CATEGORY_LABELS).map(([value, label]) => ({ label, value }))
]

const formShow = ref(false)
const formEditId = ref<string | null>(null)
const detailShow = ref(false)
const detailId = ref<string | null>(null)
const binShow = ref(false)
const formRef = ref<InstanceType<typeof BookFormModal> | null>(null)

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
const refreshing = ref(false)
async function onRefresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await onChanged()
  } finally {
    refreshing.value = false
  }
}
onMounted(() => void onChanged())
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-row">
        <div class="filters">
          <NInput
            :value="store.keyword"
            placeholder="搜索书名 / 作者 / 别名"
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
            :value="store.category"
            :options="categoryOptions"
            class="category"
            :consistent-menu-width="false"
            @update:value="store.setCategory"
          />
          <NSelect
            :value="sortMode"
            :options="sortOptions"
            class="sort"
            :consistent-menu-width="false"
            @update:value="store.setSort"
          />
          <NButton v-if="!selectMode && books.length" size="small" class="multi-btn" @click="enterSelect">
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
      <div class="tool-actions">
        <button
          type="button"
          class="icon-btn"
          :disabled="refreshing"
          @click="onRefresh"
        >
          <svg class="ic" :class="{ spinning: refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          <span>刷新</span>
        </button>
        <button type="button" class="icon-btn" @click="binShow = true">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
          </svg>
          <span>回收站</span>
        </button>
      </div>
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
      <EmptyState v-if="!books.length && !loading" kind="book" description="还没有书籍，点右下角按钮添加" />
      <div v-else class="grid">
        <CoverCard
          v-for="b in books"
          :key="b.id"
          :title="b.title"
          :cover-path="b.coverPath"
          :rating="b.rating"
          :status-label="BOOK_STATUS_LABELS[b.status]"
          :date="b.publishDate"
          ratio="3 / 4"
          :select-mode="selectMode"
          :selected="selectedIds.has(b.id)"
          @open="openCard(b.id)"
          @toggle="toggleSelect(b.id)"
        />
      </div>
      <div v-if="hasMore" ref="sentinel" class="load-more">
        {{ loadingMore ? '加载中…' : '向下滚动加载更多' }}
      </div>
    </NSpin>

    <BookFormModal ref="formRef" v-model:show="formShow" :edit-id="formEditId" @saved="onChanged" />
    <BookDetailModal
      v-model:show="detailShow"
      :id="detailId"
      @edit="openEdit"
      @changed="onChanged"
    />
    <MediaBinModal v-model:show="binShow" kind="book" @changed="onChanged" />

    <Teleport to="body">
      <div v-if="selectMode" class="select-bar">
        <NButton size="small" quaternary @click="toggleSelectAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </NButton>
        <span class="sel-count">已选 {{ selectedIds.size }}</span>
        <NButton size="small" type="error" secondary :disabled="!selectedIds.size" @click="batchDelete">
          删除
        </NButton>
        <NButton size="small" quaternary @click="exitSelect">取消</NButton>
      </div>
      <button v-else type="button" class="fab-add fab-book" title="添加书籍" @click="openCreate">＋</button>
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
.tab-want_to_read.active {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
.tab-reading.active {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}
.tab-read.active {
  background: rgba(22, 163, 74, 0.12);
  color: #16a34a;
}
.tab-abandoned.active {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
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
.category {
  width: 124px;
  flex-shrink: 0;
}
.sort :deep(.n-base-selection),
.category :deep(.n-base-selection) {
  border-radius: 999px;
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
}
.tool-actions {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  flex-shrink: 0;
}
.icon-btn {
  height: 34px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
  border: 1px solid rgba(17, 17, 17, 0.09);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-strong);
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
  transition: all 0.14s ease;
}
.icon-btn:hover {
  background: #f5f6f8;
  color: #000;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.1);
}
.icon-btn:active {
  background: #eceef1;
}
.icon-btn:disabled {
  cursor: default;
  opacity: 0.6;
}
.icon-btn .ic {
  width: 15px;
  height: 15px;
  color: #5b616c;
}
.icon-btn .spinning {
  animation: ic-spin 0.8s linear infinite;
}
@keyframes ic-spin {
  to {
    transform: rotate(360deg);
  }
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
