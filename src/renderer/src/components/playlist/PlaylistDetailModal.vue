<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NTag,
  NEmpty,
  NSpin,
  NInput,
  NPopconfirm,
  useDialog
} from 'naive-ui'
import type {
  Playlist,
  PlaylistItemView,
  Movie,
  Book,
  Game
} from '@shared/types'
import {
  PLAYLIST_TYPE_LABELS,
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { toImgUrl } from '@/utils/image'
import PlaylistCover from './PlaylistCover.vue'
import PlaylistFormModal from './PlaylistFormModal.vue'

const props = defineProps<{ show: boolean; id: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
}>()

const dialog = useDialog()
const playlist = ref<Playlist | null>(null)
const items = ref<PlaylistItemView[]>([])
const loading = ref(false)
const editShow = ref(false)
const pickerShow = ref(false)
const pickKeyword = ref('')
const candidates = ref<(Movie | Book | Game)[]>([])

async function load(): Promise<void> {
  if (!props.id) return
  loading.value = true
  try {
    playlist.value = await window.mook.playlist.get(props.id)
    items.value = playlist.value
      ? (await window.mook.playlist.items(props.id)).filter((i) => !i.isDeleted)
      : []
  } finally {
    loading.value = false
  }
}
watch(
  () => [props.show, props.id],
  ([s]) => {
    if (s) void load()
  }
)

const covers = computed(() => items.value.map((i) => i.coverPath))

function coverOf(m: Movie | Book | Game): string | null {
  return playlist.value?.type === 'movie'
    ? (m as Movie).posterPath
    : (m as Book | Game).coverPath
}

const statusLabel = (status: string): string => {
  if (!playlist.value) return status
  const maps: Record<string, Record<string, string>> = {
    movie: MOVIE_STATUS_LABELS,
    book: BOOK_STATUS_LABELS,
    game: GAME_STATUS_LABELS
  }
  return maps[playlist.value.type]?.[status] ?? status
}

async function openPicker(): Promise<void> {
  if (!playlist.value) return
  pickKeyword.value = ''
  pickerShow.value = true
  await refreshCandidates()
}

async function refreshCandidates(): Promise<void> {
  if (!playlist.value) return
  const q = { keyword: pickKeyword.value || undefined }
  if (playlist.value.type === 'movie') candidates.value = await window.mook.movie.list(q)
  else if (playlist.value.type === 'book') candidates.value = await window.mook.book.list(q)
  else candidates.value = await window.mook.game.list(q)
}

const existingIds = computed(() => new Set(items.value.map((i) => i.itemId)))

async function addItem(itemId: string): Promise<void> {
  if (!props.id) return
  await window.mook.playlist.addItem(props.id, itemId)
  await Promise.all([load(), refreshCandidates()])
  emit('changed')
}

async function removeItem(row: PlaylistItemView): Promise<void> {
  if (!props.id) return
  await window.mook.playlist.removeItem(props.id, row.id)
  await load()
  emit('changed')
}

function askDelete(): void {
  if (!playlist.value) return
  const p = playlist.value
  dialog.warning({
    title: '删除片单',
    content: `确定删除片单「${p.name}」吗？片单内条目关联会一并清除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.playlist.softDelete(p.id)
      emit('changed')
      emit('update:show', false)
    }
  })
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-root">
    <div class="detail-card">
      <NSpin :show="loading">
        <NEmpty v-if="!playlist && !loading" description="片单不存在或已删除" />
        <template v-else-if="playlist">
          <div class="hero">
            <div class="cover">
              <PlaylistCover :covers="covers" />
            </div>
            <div class="head-info">
              <h2 class="title">{{ playlist.name }}</h2>
              <div class="badges">
                <NTag size="small" type="primary" :bordered="false">
                  {{ PLAYLIST_TYPE_LABELS[playlist.type] }}
                </NTag>
                <NTag size="small" :bordered="false">{{ items.length }} 部</NTag>
              </div>
              <p v-if="playlist.description" class="desc">{{ playlist.description }}</p>
            </div>
          </div>

          <div class="body">
            <div class="list-head">
              <span class="section-title">条目（{{ items.length }}）</span>
              <NButton size="tiny" type="primary" ghost @click="openPicker">＋ 添加条目</NButton>
            </div>
            <NEmpty v-if="!items.length" description="片单还是空的" size="small" />
            <div v-else class="item-list">
              <div v-for="(it, idx) in items" :key="it.id" class="item-row">
                <div class="item-cover">
                  <img v-if="it.coverPath" :src="toImgUrl(it.coverPath)" />
                  <div v-else class="no-cover">无封面</div>
                </div>
                <div class="item-info">
                  <span class="item-title">{{ idx + 1 }}. {{ it.title }}</span>
                  <div class="item-meta">
                    <NTag size="tiny" :bordered="false">{{ statusLabel(it.status) }}</NTag>
                    <span v-if="it.rating != null" class="rate">★ {{ it.rating.toFixed(1) }}</span>
                  </div>
                </div>
                <NPopconfirm @positive-click="removeItem(it)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">移除</NButton>
                  </template>
                  从片单移除？
                </NPopconfirm>
              </div>
            </div>
          </div>

          <div class="footer">
            <NSpace justify="end">
              <NButton type="error" quaternary @click="askDelete">删除片单</NButton>
              <NButton type="primary" @click="editShow = true">编辑</NButton>
            </NSpace>
          </div>
        </template>
      </NSpin>
    </div>

    <PlaylistFormModal
      v-model:show="editShow"
      :playlist="playlist"
      @saved="
        () => {
          emit('changed')
          void load()
        }
      "
    />

    <NModal v-model:show="pickerShow" :auto-focus="false">
      <div class="picker">
        <h3>添加条目</h3>
        <NInput
          v-model:value="pickKeyword"
          placeholder="搜索标题"
          size="small"
          clearable
          class="pick-search"
          @keyup.enter="refreshCandidates"
          @clear="refreshCandidates"
        />
        <div class="pick-list">
          <div
            v-for="m in candidates"
            :key="m.id"
            class="pick-row"
            :class="{ disabled: existingIds.has(m.id) }"
            @click="!existingIds.has(m.id) && addItem(m.id)"
          >
            <div class="pick-cover">
              <img v-if="coverOf(m)" :src="toImgUrl(coverOf(m) ?? '')" />
              <div v-else class="no-cover">无</div>
            </div>
            <span class="pick-title">{{ m.title }}</span>
            <span v-if="existingIds.has(m.id)" class="pick-added">已在片单</span>
          </div>
          <NEmpty v-if="!candidates.length" description="没有匹配的条目" size="small" />
        </div>
        <div class="picker-footer">
          <NSpace justify="end">
            <NButton @click="pickerShow = false">关闭</NButton>
          </NSpace>
        </div>
      </div>
    </NModal>
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 720px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* NSpin 会在卡片与内容之间插入包裹层，需让这条链也保持 flex 列布局，
   否则 .body 的 flex:1 失效、高度被 29 个条目撑开导致无法滚动 */
.detail-card :deep(.n-spin),
.detail-card :deep(.n-spin-container),
.detail-card :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hero {
  display: flex;
  gap: 22px;
  padding: 24px 26px 18px;
  background: linear-gradient(135deg, #f3f5fb, #eef1f8);
}
.cover {
  flex: 0 0 130px;
  width: 130px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.head-info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 22px;
  color: #1f2329;
  margin-bottom: 10px;
}
.badges {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.desc {
  font-size: 13px;
  color: #5b616c;
  line-height: 1.6;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid #f2f3f6;
}
.item-cover {
  flex: 0 0 44px;
  width: 44px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  background: #e2e5ee;
}
.item-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.no-cover {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 11px;
}
.item-info {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-size: 14px;
  font-weight: 500;
  color: #1f2329;
}
.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.rate {
  font-size: 12px;
  color: #f5a623;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
}
.picker {
  width: 560px;
  max-width: 92vw;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
}
.picker h3 {
  font-size: 16px;
  margin-bottom: 12px;
}
.pick-search {
  margin-bottom: 10px;
}
.pick-list {
  max-height: 380px;
  overflow-y: auto;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.pick-row:hover {
  background: #f3f5fb;
}
.pick-row.disabled {
  cursor: default;
  opacity: 0.55;
}
.pick-cover {
  flex: 0 0 36px;
  width: 36px;
  height: 50px;
  border-radius: 5px;
  overflow: hidden;
  background: #e2e5ee;
}
.pick-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pick-title {
  flex: 1;
  font-size: 13.5px;
  color: #1f2329;
}
.pick-added {
  font-size: 12px;
  color: #8a909c;
}
.picker-footer {
  margin-top: 10px;
}
</style>
