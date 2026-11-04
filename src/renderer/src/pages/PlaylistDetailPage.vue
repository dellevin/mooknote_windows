<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton,
  NEmpty,
  NSpin,
  NModal,
  NInput,
  NPopconfirm,
  useDialog
} from 'naive-ui'
import type { Playlist, PlaylistItemView, Movie, Book, Game } from '@shared/types'
import {
  PLAYLIST_TYPE_LABELS,
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { toImgUrl } from '@/utils/image'
import PlaylistCover from '@/components/playlist/PlaylistCover.vue'
import PlaylistFormModal from '@/components/playlist/PlaylistFormModal.vue'

const route = useRoute()
const router = useRouter()
const dialog = useDialog()

const playlistId = String(route.params.id)
const playlist = ref<Playlist | null>(null)
const items = ref<PlaylistItemView[]>([])
const loading = ref(false)
const editShow = ref(false)

// 添加条目弹层
const pickerShow = ref(false)
const pickKeyword = ref('')
const candidates = ref<(Movie | Book | Game)[]>([])

async function load(): Promise<void> {
  loading.value = true
  try {
    playlist.value = await window.mook.playlist.get(playlistId)
    items.value = playlist.value
      ? (await window.mook.playlist.items(playlistId)).filter((i) => !i.isDeleted)
      : []
  } finally {
    loading.value = false
  }
}
onMounted(load)

const covers = computed(() => items.value.map((i) => i.coverPath))

// 头图海报墙：6 列 × 8 行 = 48 格，封面不足时循环填充
const wallCells = computed(() => {
  const imgs = covers.value.filter((c): c is string => !!c)
  if (!imgs.length) return [] as string[]
  return Array.from({ length: 48 }, (_, i) => imgs[i % imgs.length])
})

function statusLabel(status: string): string {
  if (!playlist.value) return status
  const maps: Record<string, Record<string, string>> = {
    movie: MOVIE_STATUS_LABELS,
    book: BOOK_STATUS_LABELS,
    game: GAME_STATUS_LABELS
  }
  return maps[playlist.value.type]?.[status] ?? status
}

function coverOf(m: Movie | Book | Game): string | null {
  return playlist.value?.type === 'movie'
    ? (m as Movie).posterPath
    : (m as Book | Game).coverPath
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
  await window.mook.playlist.addItem(playlistId, itemId)
  await Promise.all([load(), refreshCandidates()])
}
async function removeItem(row: PlaylistItemView): Promise<void> {
  await window.mook.playlist.removeItem(playlistId, row.id)
  await load()
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
      router.replace('/playlists')
    }
  })
}

const updatedText = computed(() => {
  if (!playlist.value) return ''
  return playlist.value.updatedAt.slice(0, 10).replace(/-/g, '.')
})
</script>

<template>
  <div class="pdl">
    <NSpin :show="loading">
      <NEmpty v-if="!playlist && !loading" description="片单不存在或已删除" class="gone" />
      <template v-else-if="playlist">
        <!-- 顶部头图区 -->
        <header class="hero">
          <!-- 海报墙：旋转 -30° 的多封面无缝纵向滚动 -->
          <div v-if="wallCells.length" class="wall" aria-hidden="true">
            <div class="wall-roll">
              <div class="wall-seg">
                <img
                  v-for="(c, i) in wallCells"
                  :key="'a' + i"
                  :src="toImgUrl(c)"
                  draggable="false"
                />
              </div>
              <div class="wall-seg">
                <img
                  v-for="(c, i) in wallCells"
                  :key="'b' + i"
                  :src="toImgUrl(c)"
                  draggable="false"
                />
              </div>
            </div>
          </div>
          <div class="hero-mask"></div>
          <div class="hero-inner">
            <button class="back" type="button" @click="router.push('/playlists')">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              片单
            </button>

            <div class="hero-main">
              <div class="cover">
                <PlaylistCover :covers="covers" />
              </div>
              <div class="meta">
                <h1 class="title">{{ playlist.name }}</h1>
                <div class="badges">
                  <span class="type-chip">{{ PLAYLIST_TYPE_LABELS[playlist.type] }}</span>
                  <span class="cnt">{{ items.length }} 部</span>
                  <span v-if="updatedText" class="updated">更新于 {{ updatedText }}</span>
                </div>
                <p v-if="playlist.description" class="desc">{{ playlist.description }}</p>
                <p v-else class="desc desc-empty">这位用户很懒，还没有写简介</p>
                <div class="actions">
                  <NButton type="primary" size="small" @click="openPicker">＋ 添加条目</NButton>
                  <button class="hbtn edit" type="button" @click="editShow = true">编辑片单</button>
                  <button class="hbtn del" type="button" @click="askDelete">删除</button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <!-- 条目网格 -->
        <section class="body">
          <div class="section-head">
            <h2 class="section-title">
              <span class="bar"></span>片单内容
              <span class="section-cnt">{{ items.length }}</span>
            </h2>
          </div>

          <NEmpty v-if="!items.length" description="片单还是空的，快去添加吧" class="empty" />
          <div v-else class="grid">
            <div v-for="(it, idx) in items" :key="it.id" class="card">
              <div class="poster">
                <img v-if="it.coverPath" :src="toImgUrl(it.coverPath)" :alt="it.title" />
                <div v-else class="no-cover">
                  <span>{{ it.title.slice(0, 1) }}</span>
                </div>
                <span class="rank">{{ String(idx + 1).padStart(2, '0') }}</span>
                <NPopconfirm to="body" @positive-click="removeItem(it)">
                  <template #trigger>
                    <button class="rm" type="button" title="移出片单">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
                        stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </template>
                  从片单移除？
                </NPopconfirm>
                <span class="status-chip">{{ statusLabel(it.status) }}</span>
              </div>
              <div class="card-info">
                <div class="name" :title="it.title">{{ it.title }}</div>
                <div class="card-meta">
                  <span v-if="it.rating != null" class="rate">
                    <span class="star">★</span>{{ it.rating.toFixed(1) }}
                  </span>
                  <span v-else class="rate rate-none">尚未评分</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </NSpin>

    <PlaylistFormModal
      v-model:show="editShow"
      :playlist="playlist"
      @saved="
        () => {
          void load()
        }
      "
    />

    <!-- 添加条目 -->
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
              <div v-else class="pick-none">无</div>
            </div>
            <span class="pick-title">{{ m.title }}</span>
            <span v-if="existingIds.has(m.id)" class="pick-added">已在片单</span>
          </div>
          <NEmpty v-if="!candidates.length" description="没有匹配的条目" size="small" />
        </div>
        <div class="picker-footer">
          <NButton size="small" @click="pickerShow = false">关闭</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.pdl {
  height: 100%;
  overflow-y: auto;
  background: var(--bg, #f6f7f9);
}
.gone {
  margin-top: 120px;
}

/* ===== 顶部头图 ===== */
.hero {
  position: relative;
  background: #2b2b36;
  padding: 18px 32px 30px;
  overflow: hidden;
}
.hero-inner {
  position: relative;
  z-index: 2;
  max-width: 1080px;
  margin: 0 auto;
}

/* 海报墙 */
.wall {
  position: absolute;
  inset: -35%;
  z-index: 0;
  transform: rotate(-30deg);
  pointer-events: none;
}
.wall-roll {
  display: flex;
  flex-direction: column;
  animation: wall-scroll 160s linear infinite;
}
.wall-seg {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
  flex-shrink: 0;
}
.wall-seg img {
  width: 100%;
  aspect-ratio: 0.7;
  object-fit: cover;
  display: block;
}
@keyframes wall-scroll {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-50%);
  }
}
.hero-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    to bottom,
    rgba(20, 20, 28, 0.72) 0%,
    rgba(20, 20, 28, 0.62) 45%,
    rgba(18, 18, 24, 0.9) 100%
  );
  pointer-events: none;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  cursor: pointer;
  padding: 0 0 14px;
}
.back:hover {
  color: #fff;
}
.hero-main {
  display: flex;
  gap: 28px;
}
.cover {
  flex: 0 0 150px;
  width: 150px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.meta {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}
.title {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
  margin-bottom: 12px;
}
.badges {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.cnt,
.updated {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.78);
}
.type-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  color: #fff;
  background: rgba(45, 140, 240, 0.92);
  box-shadow: 0 2px 8px rgba(45, 140, 240, 0.4);
}
.desc {
  font-size: 13.5px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.85);
  margin: 0 0 18px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.desc-empty {
  color: rgba(255, 255, 255, 0.5);
  font-style: italic;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hbtn {
  height: 28px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.45);
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(4px);
  transition: background-color 0.15s, border-color 0.15s;
}
.hbtn:hover {
  background: rgba(255, 255, 255, 0.28);
  border-color: rgba(255, 255, 255, 0.75);
}
.hbtn.del {
  border-color: rgba(255, 99, 99, 0.6);
  color: #ff8a8a;
  background: rgba(232, 17, 35, 0.18);
}
.hbtn.del:hover {
  background: #e81123;
  border-color: #e81123;
  color: #fff;
}

/* ===== 内容区 ===== */
.body {
  max-width: 1080px;
  margin: 0 auto;
  padding: 26px 32px 60px;
}
.section-head {
  margin-bottom: 18px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-strong, #1f2329);
}
.bar {
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: #2d8cf0;
}
.section-cnt {
  font-size: 13px;
  font-weight: 500;
  color: #9aa0ac;
}
.empty {
  margin-top: 70px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 26px 18px;
}
.card {
  cursor: default;
}
.poster {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: #e2e5ee;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s;
}
.card:hover .poster img {
  transform: scale(1.04);
}
.no-cover {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #c8cedb, #aab3c4);
}
.no-cover span {
  font-size: 40px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
}
.rank {
  position: absolute;
  left: 0;
  top: 0;
  padding: 3px 8px 4px;
  font-size: 13px;
  font-weight: 700;
  font-style: italic;
  color: #fff;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  border-bottom-right-radius: 10px;
}
.rm {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background-color 0.15s;
}
.card:hover .rm {
  opacity: 1;
}
.rm:hover {
  background: #e81123;
}
.status-chip {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 7px;
  font-size: 11px;
  border-radius: 4px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
}
.card-info {
  padding: 8px 2px 0;
}
.name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
  line-height: 1.4;
  min-height: 1.4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-meta {
  margin-top: 3px;
}
.rate {
  font-size: 12.5px;
  color: #e09015;
  font-weight: 600;
}
.rate .star {
  color: #f5a623;
  margin-right: 2px;
}
.rate-none {
  color: #b0b5bf;
  font-weight: 400;
}

/* ===== 添加条目弹层 ===== */
.picker {
  width: 560px;
  max-width: 92vw;
  background: var(--surface, #fff);
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
.pick-none {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 11px;
}
.pick-title {
  flex: 1;
  font-size: 13.5px;
  color: var(--text-strong, #1f2329);
}
.pick-added {
  font-size: 12px;
  color: #8a909c;
}
.picker-footer {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
</style>
