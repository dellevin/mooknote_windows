<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NEmpty, NSpin, NTag } from 'naive-ui'
import type { Playlist } from '@shared/types'
import { PLAYLIST_TYPE_LABELS } from '@shared/types'
import PlaylistCover from '@/components/playlist/PlaylistCover.vue'
import PlaylistFormModal from '@/components/playlist/PlaylistFormModal.vue'
import PlaylistDetailModal from '@/components/playlist/PlaylistDetailModal.vue'

interface PlaylistCard extends Playlist {
  covers: (string | null)[]
}

const playlists = ref<PlaylistCard[]>([])
const loading = ref(false)
const formShow = ref(false)
const editPlaylist = ref<Playlist | null>(null)
const detailShow = ref(false)
const detailId = ref<string | null>(null)

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
  detailId.value = p.id
  detailShow.value = true
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="page-title">片单</h2>
      <NButton size="small" type="primary" @click="openCreate">＋ 新建片单</NButton>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!playlists.length && !loading" description="还没有片单" class="empty" />
      <div v-else class="grid">
        <div v-for="p in playlists" :key="p.id" class="pl-card" @click="openCard(p)">
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
    <PlaylistDetailModal v-model:show="detailShow" :id="detailId" @changed="load" />
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
  color: #1f2329;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px 16px;
  align-content: start;
}
.pl-card {
  cursor: pointer;
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
.pl-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
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
