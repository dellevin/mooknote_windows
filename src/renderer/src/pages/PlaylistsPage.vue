<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NSpin, NTag, useDialog } from 'naive-ui'
import type { Playlist } from '@shared/types'
import { PLAYLIST_TYPE_LABELS } from '@shared/types'
import PlaylistCover from '@/components/playlist/PlaylistCover.vue'
import PlaylistFormModal from '@/components/playlist/PlaylistFormModal.vue'

interface PlaylistCard extends Playlist {
  covers: (string | null)[]
}

const router = useRouter()
const playlists = ref<PlaylistCard[]>([])
const loading = ref(false)
const formShow = ref(false)
const editPlaylist = ref<Playlist | null>(null)

const dialog = useDialog()

async function load(): Promise<void> {
  loading.value = true
  try {
    const list = await window.mook.playlist.list()
    playlists.value = await Promise.all(
      list.map(async (p) => {
        const items = await window.mook.playlist.items(p.id)
        return { ...p, covers: items.filter((i) => !i.isDeleted).map((i) => i.coverPath) }
      })
    )
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openCreate(): void {
  editPlaylist.value = null
  formShow.value = true
}
function openCard(p: Playlist): void {
  void router.push(`/playlists/${p.id}`)
}

// 多选批量删除（与影视/书籍/游戏页一致，移入回收站可恢复）
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => playlists.value.length > 0 && selectedIds.value.size === playlists.value.length
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
    : new Set(playlists.value.map((p) => p.id))
}
function batchDelete(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定将选中的 ${n} 个片单移入回收站吗？可在回收站恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.playlist.softDelete(id))
      )
      exitSelect()
      await load()
    }
  })
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="page-title">片单</h2>
      <div class="tools">
        <NButton size="small" quaternary :disabled="!playlists.length" @click="enterSelect">
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
        <NButton size="small" type="primary" @click="openCreate">＋ 新建片单</NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!playlists.length && !loading" description="还没有片单" class="empty" />
      <div v-else class="grid">
        <div
          v-for="p in playlists"
          :key="p.id"
          class="pl-card"
          :class="{ picked: selectMode && selectedIds.has(p.id) }"
          @click="selectMode ? toggleSelect(p.id) : openCard(p)"
        >
          <span v-if="selectMode" class="pick-dot" :class="{ on: selectedIds.has(p.id) }">
            <svg v-if="selectedIds.has(p.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <div class="pl-cover-wrap">
            <PlaylistCover :covers="p.covers" />
          </div>
          <div class="pl-name">{{ p.name }}</div>
          <div class="pl-meta">
            <NTag size="tiny" type="primary" :bordered="false">
              {{ PLAYLIST_TYPE_LABELS[p.type] }}
            </NTag>
            <span class="cnt">{{ p.itemCount }} 部</span>
          </div>
        </div>
      </div>
    </NSpin>

    <PlaylistFormModal v-model:show="formShow" :playlist="editPlaylist" @saved="load" />

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
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.page-title {
  font-size: 18px;
  color: var(--text-strong);
}
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
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
.pl-card {
  cursor: pointer;
  position: relative;
}
.pl-cover-wrap {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  transition: transform 0.15s;
}
.pl-card:hover .pl-cover-wrap {
  transform: translateY(-2px);
}
.pl-card.picked .pl-cover-wrap {
  outline: 2px solid var(--accent-ink);
  outline-offset: 1px;
}
.pick-dot {
  position: absolute;
  top: 7px;
  left: 7px;
  z-index: 2;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: 1.5px solid rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.pick-dot.on {
  background: var(--accent);
  border-color: var(--accent-ink);
  color: var(--on-accent);
}
.pick-dot svg {
  width: 14px;
  height: 14px;
}
.pl-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 8px 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cnt {
  font-size: 12px;
  color: #8a909c;
}
.empty {
  margin-top: 80px;
}
</style>
