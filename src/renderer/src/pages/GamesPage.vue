<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { NButton, NInput, NSelect, NSpin, useDialog } from 'naive-ui'
import { createMediaStore } from '@/stores/media'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import { GAME_STATUS_LABELS, GAME_SORT_LABELS, type Game, type GameStatus } from '@shared/types'
import CoverCard from '@/components/CoverCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import MediaBinModal from '@/components/MediaBinModal.vue'
import GameFormModal from '@/components/game/GameFormModal.vue'
import GameDetailModal from '@/components/game/GameDetailModal.vue'

const store = createMediaStore('game')()
const dialog = useDialog()
const { items, loading, loadingMore, hasMore, status, sortMode, counts } = storeToRefs(store)
const games = computed<Game[]>(() => items.value as Game[])
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
  () => games.value.length > 0 && selectedIds.value.size === games.value.length
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
    : new Set(games.value.map((g) => g.id))
}
function batchDelete(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定将选中的 ${n} 个游戏移入回收站吗？可在回收站恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.game.softDelete(id))
      )
      exitSelect()
      await onChanged()
    }
  })
}

const tabs: { key: '' | GameStatus; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'want_to_play', label: GAME_STATUS_LABELS.want_to_play },
  { key: 'playing', label: GAME_STATUS_LABELS.playing },
  { key: 'completed', label: GAME_STATUS_LABELS.completed },
  { key: 'abandoned', label: GAME_STATUS_LABELS.abandoned }
]
const sortOptions = Object.entries(GAME_SORT_LABELS).map(([value, label]) => ({
  label,
  value: Number(value)
}))

const formShow = ref(false)
const formEditId = ref<string | null>(null)
const detailShow = ref(false)
const detailId = ref<string | null>(null)
const binShow = ref(false)
const formRef = ref<InstanceType<typeof GameFormModal> | null>(null)

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
onMounted(() => void onChanged())
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="toolbar-row">
        <div class="filters">
          <NInput
            :value="store.keyword"
            placeholder="搜索名称 / 开发者"
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
          <NButton v-if="!selectMode && games.length" size="small" class="multi-btn" @click="enterSelect">
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
      <EmptyState v-if="!games.length && !loading" kind="game" description="还没有游戏，点右下角按钮添加" />
      <div v-else class="grid">
        <CoverCard
          v-for="g in games"
          :key="g.id"
          :title="g.title"
          :cover-path="g.coverPath"
          :rating="g.rating"
          :status-label="GAME_STATUS_LABELS[g.status]"
          :date="g.releaseDate"
          ratio="3 / 4"
          :select-mode="selectMode"
          :selected="selectedIds.has(g.id)"
          @open="openCard(g.id)"
          @toggle="toggleSelect(g.id)"
        />
      </div>
      <div v-if="hasMore" ref="sentinel" class="load-more">
        {{ loadingMore ? '加载中…' : '向下滚动加载更多' }}
      </div>
    </NSpin>

    <GameFormModal ref="formRef" v-model:show="formShow" :edit-id="formEditId" @saved="onChanged" />
    <GameDetailModal
      v-model:show="detailShow"
      :id="detailId"
      @edit="openEdit"
      @changed="onChanged"
    />
    <MediaBinModal v-model:show="binShow" kind="game" @changed="onChanged" />

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
      <button v-else type="button" class="fab-add fab-game" title="添加游戏" @click="openCreate">＋</button>
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
  color: #1f2329;
}
.tab-want_to_play.active {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
.tab-playing.active {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}
.tab-completed.active {
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
  background: #fff;
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
  background: #fff;
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
}
.bin-btn {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  flex-shrink: 0;
}
.ic-trash {
  width: 22px !important;
  height: 22px !important;
}
.multi-btn {
  flex-shrink: 0;
  border-radius: 999px;
  height: 34px;
  padding: 0 16px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(17, 17, 17, 0.05);
  color: #1f2329;
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
  color: #1f2329;
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
