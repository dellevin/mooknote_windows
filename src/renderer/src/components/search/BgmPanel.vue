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
import { bgmToBook, bgmToGame, bgmToMovie } from './importHelper'

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

const detailShow = ref(false)
const detail = ref<BgmDetail | null>(null)
const detailLoading = ref(false)
const importing = ref(false)

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
  loading.value = true
  try {
    const r = await window.mook.search.bgmSearch(q, targetOffset)
    results.value = r.results
    total.value = r.total
    offset.value = targetOffset
    searched.value = true
  } catch (e) {
    message.error('搜索失败：' + String(e))
  } finally {
    loading.value = false
  }
}

async function openDetail(item: BgmSearchItem): Promise<void> {
  detailShow.value = true
  detailLoading.value = true
  detail.value = null
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
  importing.value = true
  try {
    if (target === 'book') {
      const id = await window.mook.book.newId()
      const input = bgmToBook(d, id, status as BookInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'books', id)
        input.coverPath = local
      }
      await window.mook.book.create(input)
      message.success(`已添加到「${BOOK_STATUS_LABELS[status as BookInput['status']]}」`)
      emit('imported', 'book')
    } else if (target === 'game') {
      const id = await window.mook.game.newId()
      const input = bgmToGame(d, id, status as GameInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'games', id)
        input.coverPath = local
      }
      await window.mook.game.create(input)
      message.success(`已添加到「${GAME_STATUS_LABELS[status as GameInput['status']]}」`)
      emit('imported', 'game')
    } else {
      const id = await window.mook.movie.newId()
      const input = bgmToMovie(d, id, status as MovieInput['status'])
      if (d.image) {
        const local = await window.mook.search.downloadImage(d.image, 'bgm', 'movies', id)
        input.posterPath = local
      }
      await window.mook.movie.create(input)
      message.success(`已添加到「${MOVIE_STATUS_LABELS[status as MovieInput['status']]}」`)
      emit('imported', 'movie')
    }
    detailShow.value = false
  } catch (e) {
    message.error('添加失败：' + String(e))
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="panel">
    <div class="searchbar">
      <NInput
        v-model:value="keyword"
        placeholder="搜索书籍 / 动画 / 游戏 / 影视"
        clearable
        size="small"
        @keyup.enter="search(0)"
      />
      <NButton size="small" type="primary" :loading="loading" @click="search(0)">搜索</NButton>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="searched && !results.length && !loading" description="没有结果" class="empty" />
      <div v-if="results.length" class="grid">
        <div v-for="r in results" :key="r.id" class="card" @click="openDetail(r)">
          <div class="poster">
            <img v-if="r.image" :src="r.image" />
            <div v-else class="fallback">📚</div>
            <NTag size="tiny" :bordered="false" class="type">{{ typeLabel(r.type) }}</NTag>
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
    </NSpin>

    <NModal
      :show="detailShow"
      @update:show="(v: boolean) => (detailShow = v)"
      :auto-focus="false"
    >
      <div class="detail" v-if="detail">
        <div class="d-head">
          <img v-if="detail.image" :src="detail.image" class="d-poster" />
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
          <NSpace justify="space-between" align="center">
            <span class="hint">添加到本地库（会下载封面）</span>
            <NSpace>
              <template v-if="detail.type === 1">
                <NButton size="small" :loading="importing" @click="importAs('book', 'want_to_read')">
                  想读
                </NButton>
                <NButton size="small" :loading="importing" @click="importAs('book', 'reading')">
                  在读
                </NButton>
                <NButton
                  size="small"
                  type="primary"
                  :loading="importing"
                  @click="importAs('book', 'read')"
                >
                  读过
                </NButton>
              </template>
              <template v-else-if="detail.type === 4">
                <NButton
                  size="small"
                  :loading="importing"
                  @click="importAs('game', 'want_to_play')"
                >
                  想玩
                </NButton>
                <NButton size="small" :loading="importing" @click="importAs('game', 'playing')">
                  在玩
                </NButton>
                <NButton
                  size="small"
                  type="primary"
                  :loading="importing"
                  @click="importAs('game', 'completed')"
                >
                  已通关
                </NButton>
              </template>
              <template v-else-if="detail.type === 2 || detail.type === 6">
                <NButton
                  size="small"
                  :loading="importing"
                  @click="importAs('movie', 'want_to_watch')"
                >
                  想看
                </NButton>
                <NButton size="small" :loading="importing" @click="importAs('movie', 'watching')">
                  在看
                </NButton>
                <NButton
                  size="small"
                  type="primary"
                  :loading="importing"
                  @click="importAs('movie', 'watched')"
                >
                  已看
                </NButton>
              </template>
              <span v-else class="hint">该类型暂不支持导入</span>
            </NSpace>
          </NSpace>
        </div>
      </div>
      <div v-else-if="detailLoading" class="detail loading-box">
        <NSpin size="small" /> 加载中…
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.searchbar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  width: 100%;
}
.searchbar :deep(.n-input) {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
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
.t {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
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
  margin-top: 60px;
}
.detail {
  width: 720px;
  max-width: 94vw;
  max-height: 86vh;
  overflow-y: auto;
  background: #fff;
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
.hint {
  font-size: 12.5px;
  color: #9aa0ac;
}
</style>
