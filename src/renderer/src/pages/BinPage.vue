<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NSpace, NPopconfirm, NEmpty, NSpin, NTag, NCheckbox } from 'naive-ui'
import { formatDate } from '@/utils/image'
import { plainPreview } from '@/utils/markdown'

type BinKind = 'movie' | 'book' | 'game' | 'playlist' | 'note' | 'custom'

interface BinRow {
  id: string
  kind: BinKind
  title: string
  sub: string
  updatedAt: string
}

const KIND_LABEL: Record<BinKind, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏',
  playlist: '片单',
  note: '笔记',
  custom: '自定义'
}
const KIND_ORDER: BinKind[] = ['movie', 'book', 'game', 'playlist', 'note', 'custom']

const rows = ref<BinRow[]>([])
const loading = ref(false)
const filter = ref<BinKind | 'all'>('all')
const selected = ref<Set<string>>(new Set())
const keyOf = (r: BinRow): string => r.kind + ':' + r.id

const countOf = (k: BinKind): number => rows.value.filter((r) => r.kind === k).length

const filtered = computed(() =>
  filter.value === 'all' ? rows.value : rows.value.filter((r) => r.kind === filter.value)
)
const allSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((r) => selected.value.has(keyOf(r)))
)

function toggle(r: BinRow): void {
  const next = new Set(selected.value)
  const k = keyOf(r)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selected.value = next
}
function toggleAll(): void {
  const next = new Set(selected.value)
  if (allSelected.value) filtered.value.forEach((r) => next.delete(keyOf(r)))
  else filtered.value.forEach((r) => next.add(keyOf(r)))
  selected.value = next
}
async function restoreOne(r: BinRow): Promise<void> {
  if (r.kind === 'custom') await window.mook.customItem.restore(r.id)
  else if (r.kind === 'note') await window.mook.note.restore(r.id)
  else if (r.kind === 'playlist') await window.mook.playlist.restore(r.id)
  else await window.mook[r.kind].restore(r.id)
}
async function batchRestore(): Promise<void> {
  const want = filtered.value.filter((r) => selected.value.has(keyOf(r)))
  if (!want.length) return
  await Promise.all(want.map((r) => restoreOne(r)))
  selected.value = new Set()
  await load()
}
async function purgeOne(r: BinRow): Promise<void> {
  if (r.kind === 'custom') await window.mook.customItem.purge(r.id)
  else if (r.kind === 'note') await window.mook.note.purge(r.id)
  else if (r.kind === 'playlist') await window.mook.playlist.purge(r.id)
  else await window.mook[r.kind].purge(r.id)
}
async function batchPurge(): Promise<void> {
  const want = filtered.value.filter((r) => selected.value.has(keyOf(r)))
  if (!want.length) return
  await Promise.all(want.map((r) => purgeOne(r)))
  selected.value = new Set()
  await load()
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [movies, books, games, playlists, notes, customs] = await Promise.all([
      window.mook.movie.list({ includeDeleted: true }),
      window.mook.book.list({ includeDeleted: true }),
      window.mook.game.list({ includeDeleted: true }),
      window.mook.playlist.list(true),
      window.mook.note.list({ includeDeleted: true }),
      window.mook.customItem.deleted()
    ])
    const all: BinRow[] = [
      ...playlists
        .filter((p) => p.isDeleted)
        .map((p) => ({
          id: p.id,
          kind: 'playlist' as BinKind,
          title: p.name,
          sub: p.description || '',
          updatedAt: p.updatedAt
        })),
      ...movies.map((m) => ({
        id: m.id,
        kind: 'movie' as BinKind,
        title: m.title,
        sub: '',
        updatedAt: m.updatedAt
      })),
      ...books.map((b) => ({
        id: b.id,
        kind: 'book' as BinKind,
        title: b.title,
        sub: '',
        updatedAt: b.updatedAt
      })),
      ...games.map((g) => ({
        id: g.id,
        kind: 'game' as BinKind,
        title: g.title,
        sub: '',
        updatedAt: g.updatedAt
      })),
      ...notes.map((n) => ({
        id: n.id,
        kind: 'note' as BinKind,
        title: n.title || '无标题笔记',
        sub: plainPreview(n.content, 60),
        updatedAt: n.updatedAt
      })),
      ...customs.map((c) => ({
        id: c.id,
        kind: 'custom' as BinKind,
        title: c.title || '未命名',
        sub: '',
        updatedAt: c.updatedAt
      }))
    ]
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    rows.value = all
  } finally {
    loading.value = false
  }
}

async function restore(row: BinRow): Promise<void> {
  await restoreOne(row)
  await load()
}

async function purge(row: BinRow): Promise<void> {
  if (row.kind === 'custom') await window.mook.customItem.purge(row.id)
  else if (row.kind === 'note') await window.mook.note.purge(row.id)
  else if (row.kind === 'playlist') await window.mook.playlist.purge(row.id)
  else await window.mook[row.kind].purge(row.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="title">回收站</h2>
      <NButton size="small" quaternary :loading="loading" @click="load">刷新</NButton>
    </div>

    <div class="pills">
      <button
        type="button"
        class="pill"
        :class="{ on: filter === 'all' }"
        @click="filter = 'all'"
      >
        全部 {{ rows.length }}
      </button>
      <button
        v-for="k in KIND_ORDER"
        :key="k"
        type="button"
        class="pill"
        :class="{ on: filter === k }"
        @click="filter = k"
      >
        {{ KIND_LABEL[k] }} {{ countOf(k) }}
      </button>
    </div>

    <div v-if="filtered.length" class="bulk">
      <NCheckbox :checked="allSelected" @update:checked="toggleAll">全选</NCheckbox>
      <NButton size="small" :disabled="!selected.size" @click="batchRestore">
        批量恢复<span v-if="selected.size">（{{ selected.size }}）</span>
      </NButton>
      <NPopconfirm @positive-click="batchPurge">
        <template #trigger>
          <NButton size="small" type="error" ghost :disabled="!selected.size">
            批量删除<span v-if="selected.size">（{{ selected.size }}）</span>
          </NButton>
        </template>
        选中的 {{ selected.size }} 项及其评价、图片等全部数据将被彻底删除，不可恢复。确定？
      </NPopconfirm>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!filtered.length && !loading" description="回收站是空的" class="empty" />
      <div v-else class="list">
        <div
          v-for="r in filtered"
          :key="r.kind + r.id"
          class="row"
          :class="{ picked: selected.has(r.kind + ':' + r.id) }"
        >
          <div class="info">
            <NCheckbox
              :checked="selected.has(r.kind + ':' + r.id)"
              @update:checked="toggle(r)"
            />
            <NTag size="small" :bordered="false" type="primary">{{ KIND_LABEL[r.kind] }}</NTag>
            <div class="text">
              <span class="t">{{ r.title }}</span>
              <span v-if="r.sub" class="sub">{{ r.sub }}</span>
            </div>
            <span class="d">{{ formatDate(r.updatedAt) }}</span>
          </div>
          <NSpace :size="8">
            <NButton size="small" @click="restore(r)">恢复</NButton>
            <NPopconfirm @positive-click="purge(r)">
              <template #trigger>
                <NButton size="small" type="error" ghost>彻底删除</NButton>
              </template>
              将同时删除其评价、图片等全部数据，且不可恢复。确定？
            </NPopconfirm>
          </NSpace>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.page {
  padding: 20px 26px 32px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2329;
}
.pills {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.pill {
  font-size: 12.5px;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid #e6e8ee;
  background: rgba(255, 255, 255, 0.7);
  color: #555;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease);
}
.pill:hover {
  border-color: var(--accent);
}
.pill.on {
  background: color-mix(in srgb, var(--accent) 12%, #fff);
  border-color: color-mix(in srgb, var(--accent) 40%, #fff);
  color: var(--accent);
  font-weight: 600;
}
.bulk {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid #eef0f4;
  border-radius: 12px;
  transition:
    border-color var(--d2) var(--fluent-ease),
    box-shadow var(--d2) var(--fluent-ease);
}
.row:hover {
  border-color: #dfe3ee;
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.07);
}
.row.picked {
  border-color: color-mix(in srgb, var(--accent) 40%, #fff);
  background: color-mix(in srgb, var(--accent) 5%, #fff);
}
.info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.t {
  font-size: 14px;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
.sub {
  font-size: 11.5px;
  color: #9aa0ac;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
.d {
  font-size: 11px;
  color: #b0b5c0;
  flex-shrink: 0;
}
.empty {
  padding: 60px 0;
}
</style>
