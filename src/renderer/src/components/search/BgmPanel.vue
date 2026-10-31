<script setup lang="ts">
import { ref } from 'vue'
import {
  NInput,
  NButton,
  NSpin,
  NEmpty,
  NModal,
  NSpace,
  NTag,
  NRate,
  useMessage
} from 'naive-ui'
import type {
  BgmSearchItem,
  BgmDetail,
  MovieInput,
  BookInput,
  GameInput
} from '@shared/types'
import {
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { bgmToBook, bgmToGame, bgmToMovie, normalizeTitle } from './importHelper'
import { remoteImg } from '@/utils/image'

const emit = defineEmits<{
  (e: 'imported', kind: 'movie' | 'book' | 'game'): void
}>()

const message = useMessage()
const keyword = ref('')
const loading = ref(false)
const results = ref<BgmSearchItem[]>([])
const total = ref(0)
const offset = ref(0)
const searched = ref(false)
const PAGE = 30
let searchSeq = 0

const detailShow = ref(false)
const detail = ref<BgmDetail | null>(null)
const detailLoading = ref(false)
const importing = ref(false)
const importStatus = ref<string | null>(null)
const choosing = ref(false)
// 已在本地库的标题（归一化后）：分别记录三类，按条目 type 取对应集合
const existing = ref<{ movie: Set<string>; book: Set<string>; game: Set<string> }>({
  movie: new Set(),
  book: new Set(),
  game: new Set()
})

function itemExists(item: { type: number; title: string }): boolean {
  const t = normalizeTitle(item.title)
  if (item.type === 1) return existing.value.book.has(t)
  if (item.type === 4) return existing.value.game.has(t)
  if (item.type === 2 || item.type === 6) return existing.value.movie.has(t)
  return false
}

function typeLabel(t: number): string {
  switch (t) {
    case 1:
      return '书籍'
    case 2:
      return '动画'
    case 4:
      return '游戏'
    case 6:
      return '影视'
    default:
      return '其他'
  }
}

async function search(targetOffset = 0): Promise<void> {
  const q = keyword.value.trim()
  if (!q) return
  const seq = ++searchSeq
  loading.value = true
  try {
    const r = await window.mook.search.bgmSearch(q, targetOffset)
    if (seq !== searchSeq) return
    results.value = r.results
    total.value = r.total
    offset.value = targetOffset
    searched.value = true
    try {
      const [movies, books, games] = await Promise.all([
        window.mook.movie.list({ keyword: q }),
        window.mook.book.list({ keyword: q }),
        window.mook.game.list({ keyword: q })
      ])
      if (seq !== searchSeq) return
      existing.value = {
        movie: new Set(movies.filter((m) => !m.isDeleted).map((m) => normalizeTitle(m.title))),
        book: new Set(books.filter((b) => !b.isDeleted).map((b) => normalizeTitle(b.title))),
        game: new Set(games.filter((g) => !g.isDeleted).map((g) => normalizeTitle(g.title)))
      }
    } catch {
      existing.value = { movie: new Set(), book: new Set(), game: new Set() }
    }
  } catch (e) {
    if (seq === searchSeq) message.error('搜索失败：' + String(e))
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

async function openDetail(item: BgmSearchItem): Promise<void> {
  detailShow.value = true
  detailLoading.value = true
  detail.value = null
  choosing.value = false
  try {
    detail.value = await window.mook.search.bgmDetail(item.id)
  } catch (e) {
    message.error('加载详情失败：' + String(e))
    detailShow.value = false
  } finally {
    detailLoading.value = false
  }
}

async function importAs(
  target: 'book' | 'game' | 'movie',
  status: MovieInput['status'] | BookInput['status'] | GameInput['status']
): Promise<void> {
  if (!detail.value) return
  const d = detail.value
  if (itemExists(d)) {
    message.warning('本地库已有同名条目')
    return
  }
  importing.value = true
  importStatus.value = status
  try {
    if (target === 'book') {
      const id = await window.mook.book.newId()
      const input = bgmToBook(d, id, status as BookInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'books', id)
        input.coverPath = local
      }
      await window.mook.book.create(JSON.parse(JSON.stringify(input)) as BookInput)
      message.success(`已添加到「${BOOK_STATUS_LABELS[status as BookInput['status']]}」`)
      emit('imported', 'book')
    } else if (target === 'game') {
      const id = await window.mook.game.newId()
      const input = bgmToGame(d, id, status as GameInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'games', id)
        input.coverPath = local
      }
      await window.mook.game.create(JSON.parse(JSON.stringify(input)) as GameInput)
      message.success(`已添加到「${GAME_STATUS_LABELS[status as GameInput['status']]}」`)
      emit('imported', 'game')
    } else {
      const id = await window.mook.movie.newId()
      const input = bgmToMovie(d, id, status as MovieInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'movies', id)
        input.posterPath = local
      }
      await window.mook.movie.create(JSON.parse(JSON.stringify(input)) as MovieInput)
      message.success(`已添加到「${MOVIE_STATUS_LABELS[status as MovieInput['status']]}」`)
      emit('imported', 'movie')
    }
    // 同步去重集合，使「已收藏」立即生效
    const bucket =
      target === 'book' ? 'book' : target === 'game' ? 'game' : 'movie'
    existing.value[bucket].add(normalizeTitle(d.title))
    choosing.value = false
    detailShow.value = false
  } catch (e) {
    message.error('添加失败：' + String(e))
  } finally {
    importing.value = false
    importStatus.value = null
  }
}
</script>

<template>
  <div class="panel">
    <div class="local-search">
      <svg class="ls-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <NInput
        v-model:value="keyword"
        size="large"
        clearable
        :bordered="false"
        placeholder="搜索书籍 / 动画 / 游戏 / 影视（Bangumi），回车搜索"
        @keyup.enter="search(0)"
      />
      <NButton size="small" type="primary" :loading="loading" @click="search(0)">
        搜索
      </NButton>
    </div>

    <div v-if="loading" class="grid">
      <div v-for="n in 10" :key="n" class="card">
        <div class="poster sk" />
        <div class="sk sk-line w80" />
        <div class="sk sk-line w40" />
      </div>
    </div>
    <template v-else>
      <div v-if="!searched" class="local-hint">
        输入关键词，回车或点击从 Bangumi 搜索
      </div>
      <NEmpty v-else-if="!results.length" description="没有结果" class="empty" />
      <div v-if="results.length" class="grid">
        <div v-for="r in results" :key="r.id" class="card" @click="openDetail(r)">
          <div class="poster">
            <img v-if="r.image" :src="remoteImg(r.image, 'bgm')" />
            <div v-else class="fallback">📚</div>
            <NTag size="tiny" :bordered="false" class="type">{{ typeLabel(r.type) }}</NTag>
            <span v-if="itemExists(r)" class="in-lib">已在库</span>
          </div>
          <div class="t" :title="r.title">{{ r.title }}</div>
          <div class="meta">
            <span>{{ r.date ? r.date.slice(0, 4) : '' }}</span>
            <span v-if="r.rating">★ {{ r.rating }}</span>
          </div>
        </div>
      </div>
      <div v-if="total > PAGE" class="pager">
        <NButton size="tiny" :disabled="offset <= 0" @click="search(offset - PAGE)">上一页</NButton>
        <span class="pg">{{ Math.floor(offset / PAGE) + 1 }} / {{ Math.ceil(total / PAGE) }}</span>
        <NButton
          size="tiny"
          :disabled="offset + PAGE >= total"
          @click="search(offset + PAGE)"
        >
          下一页
        </NButton>
      </div>
    </template>

    <NModal
      :show="detailShow"
      @update:show="(v: boolean) => (detailShow = v)"
      :auto-focus="false"
    >
      <div class="detail" v-if="detail">
        <div class="d-head">
          <img v-if="detail.image" :src="remoteImg(detail.image, 'bgm')" class="d-poster" />
          <div class="d-info">
            <h3>{{ detail.title }}</h3>
            <div class="d-orig" v-if="detail.name && detail.name !== detail.title">
              {{ detail.name }}
            </div>
            <NSpace :size="6" class="d-tags">
              <NTag size="small" :bordered="false">{{ typeLabel(detail.type) }}</NTag>
              <NTag v-if="detail.date" size="small" :bordered="false">{{ detail.date }}</NTag>
              <NTag v-for="g in detail.tags.slice(0, 6)" :key="g" size="small" :bordered="false">
                {{ g }}
              </NTag>
            </NSpace>
            <div v-if="detail.rating" class="d-rate">
              <NRate :value="detail.rating / 2" readonly allow-half size="small" />
              <span>{{ detail.rating }} / 10</span>
            </div>
          </div>
        </div>

        <p class="d-overview">{{ detail.summary || '暂无简介' }}</p>

        <div class="d-foot">
          <div class="foot-right">
            <span v-if="itemExists(detail)" class="collected">已收藏该条目</span>
            <template v-else>
              <template v-if="choosing">
                <template v-if="detail.type === 1">
                  <NButton size="small" :loading="importStatus === 'want_to_read'" @click="importAs('book', 'want_to_read')">
                    想读
                  </NButton>
                  <NButton size="small" :loading="importStatus === 'reading'" @click="importAs('book', 'reading')">
                    在读
                  </NButton>
                  <NButton
                    size="small"
                    :loading="importStatus === 'read'"
                    @click="importAs('book', 'read')"
                  >
                    读过
                  </NButton>
                </template>
                <template v-else-if="detail.type === 4">
                  <NButton
                    size="small"
                    :loading="importStatus === 'want_to_play'"
                    @click="importAs('game', 'want_to_play')"
                  >
                    想玩
                  </NButton>
                  <NButton size="small" :loading="importStatus === 'playing'" @click="importAs('game', 'playing')">
                    在玩
                  </NButton>
                  <NButton
                    size="small"
                    :loading="importStatus === 'completed'"
                    @click="importAs('game', 'completed')"
                  >
                    已通关
                  </NButton>
                </template>
                <template v-else-if="detail.type === 2 || detail.type === 6">
                  <NButton
                    size="small"
                    :loading="importStatus === 'want_to_watch'"
                    @click="importAs('movie', 'want_to_watch')"
                  >
                    想看
                  </NButton>
                  <NButton size="small" :loading="importStatus === 'watching'" @click="importAs('movie', 'watching')">
                    在看
                  </NButton>
                  <NButton
                    size="small"
                    :loading="importStatus === 'watched'"
                    @click="importAs('movie', 'watched')"
                  >
                    已看
                  </NButton>
                </template>
                <span v-else class="hint">该类型暂不支持导入</span>
                <NButton size="small" :disabled="importing" @click="choosing = false">取消</NButton>
              </template>
              <NButton
                v-else
                size="small"
                type="primary"
                :disabled="![1, 2, 4, 6].includes(detail.type)"
                @click="choosing = true"
              >
                添加到本地库
              </NButton>
            </template>
          </div>
        </div>
      </div>
      <div v-else-if="detailLoading" class="detail loading-box">
        <NSpin size="small" /> 加载中…
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.local-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  margin: 2px 0 14px;
  height: 46px;
  border-radius: 12px;
  background: #f4f5f8;
  border: 1px solid transparent;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    box-shadow 0.15s;
}
.local-search:focus-within {
  background: var(--surface);
  border-color: color-mix(in srgb, var(--accent-ink) 45%, var(--surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-ink) 8%, transparent);
}
.ls-icon {
  width: 18px;
  height: 18px;
  color: #9aa0ac;
  flex-shrink: 0;
}
.local-search :deep(.n-input) {
  flex: 1;
  min-width: 0;
}
.local-search :deep(.n-input .n-input__border),
.local-search :deep(.n-input .n-input__state-border) {
  display: none;
}
.local-hint {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: #b0b5bd;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  height: 56vh;
  overflow-y: auto;
  align-content: start;
  padding-right: 4px;
}
.card {
  cursor: pointer;
}
.poster {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #f2f3f7;
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: #c2c7d2;
}
.type {
  position: absolute;
  left: 6px;
  top: 6px;
}
.in-lib {
  position: absolute;
  right: 6px;
  top: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: #fff;
  background: rgba(31, 35, 41, 0.72);
  backdrop-filter: blur(6px);
}
.t {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #9aa0ac;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 18px;
}
.pg {
  font-size: 12.5px;
  color: #5b616c;
}
.empty {
  height: 56vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 骨架屏 */
.sk {
  position: relative;
  overflow: hidden;
  background: #eef0f4;
}
.sk::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.65), transparent);
  animation: sk-shimmer 1.3s infinite;
}
@keyframes sk-shimmer {
  100% {
    transform: translateX(100%);
  }
}
.sk-line {
  height: 12px;
  border-radius: 5px;
  margin-top: 8px;
}
.w40 {
  width: 40%;
}
.w80 {
  width: 80%;
}
.detail {
  width: 720px;
  max-width: 94vw;
  max-height: 86vh;
  overflow-y: auto;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.loading-box {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #5b616c;
}
.d-head {
  display: flex;
  gap: 18px;
}
.d-poster {
  width: 150px;
  border-radius: 10px;
  flex-shrink: 0;
}
.d-info h3 {
  font-size: 19px;
  margin-bottom: 4px;
}
.d-orig {
  font-size: 13px;
  color: #9aa0ac;
  margin-bottom: 8px;
}
.d-rate {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: #5b616c;
}
.d-overview {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.8;
  color: #3f444d;
  white-space: pre-wrap;
}
.d-foot {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #f2f3f6;
}
.foot-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.collected {
  font-size: 13px;
  color: #9aa0ac;
}
.hint {
  font-size: 12.5px;
  color: #9aa0ac;
}
</style>
