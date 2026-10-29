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
import type { TmdbSearchItem, TmdbDetail, MovieInput } from '@shared/types'
import { MOVIE_STATUS_LABELS } from '@shared/types'
import { tmdbToMovie } from './importHelper'
import { formatDate } from '@/utils/image'

const emit = defineEmits<{ (e: 'imported', kind: 'movie'): void }>()

const message = useMessage()
const keyword = ref('')
const loading = ref(false)
const results = ref<TmdbSearchItem[]>([])
const page = ref(1)
const totalPages = ref(1)
const searched = ref(false)

const detailShow = ref(false)
const detail = ref<TmdbDetail | null>(null)
const detailLoading = ref(false)
const importing = ref(false)

async function search(targetPage = 1): Promise<void> {
  const q = keyword.value.trim()
  if (!q) return
  loading.value = true
  try {
    const r = await window.mook.search.tmdbSearch(q, targetPage)
    results.value = r.results
    page.value = r.page
    totalPages.value = r.totalPages
    searched.value = true
  } catch (e) {
    message.error('搜索失败：' + String(e))
  } finally {
    loading.value = false
  }
}

async function openDetail(item: TmdbSearchItem): Promise<void> {
  detailShow.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await window.mook.search.tmdbDetail(item.id, item.mediaType)
  } catch (e) {
    message.error('加载详情失败：' + String(e))
    detailShow.value = false
  } finally {
    detailLoading.value = false
  }
}

async function addMovie(status: MovieInput['status']): Promise<void> {
  if (!detail.value) return
  importing.value = true
  try {
    const id = await window.mook.movie.newId()
    const input = tmdbToMovie(detail.value, id, status)
    if (detail.value.posterUrl) {
      const local = await window.mook.search.downloadImage(
        detail.value.posterUrl,
        'tmdb',
        'movies',
        id
      )
      input.posterPath = local
    }
    await window.mook.movie.create(input)
    message.success(`已添加到「${MOVIE_STATUS_LABELS[status]}」`)
    detailShow.value = false
    emit('imported', 'movie')
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
        placeholder="搜索电影 / 剧集"
        clearable
        size="small"
        @keyup.enter="search(1)"
      />
      <NButton size="small" type="primary" :loading="loading" @click="search(1)">搜索</NButton>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="searched && !results.length && !loading" description="没有结果" class="empty" />
      <div v-if="results.length" class="grid">
        <div v-for="r in results" :key="r.mediaType + r.id" class="card" @click="openDetail(r)">
          <div class="poster">
            <img v-if="r.posterUrl" :src="r.posterUrl" />
            <div v-else class="fallback">🎟</div>
            <NTag size="tiny" :bordered="false" class="type">
              {{ r.mediaType === 'movie' ? '电影' : '剧集' }}
            </NTag>
          </div>
          <div class="t" :title="r.title">{{ r.title }}</div>
          <div class="meta">
            <span>{{ r.date ? r.date.slice(0, 4) : '' }}</span>
            <span v-if="r.rating">★ {{ r.rating }}</span>
          </div>
        </div>
      </div>
      <div v-if="totalPages > 1" class="pager">
        <NButton size="tiny" :disabled="page <= 1" @click="search(page - 1)">上一页</NButton>
        <span class="pg">{{ page }} / {{ totalPages }}</span>
        <NButton size="tiny" :disabled="page >= totalPages" @click="search(page + 1)">下一页</NButton>
      </div>
    </NSpin>

    <NModal
      :show="detailShow"
      @update:show="(v: boolean) => (detailShow = v)"
      :auto-focus="false"
    >
      <div class="detail" v-if="detail">
        <div class="d-head">
          <img v-if="detail.posterUrl" :src="detail.posterUrl" class="d-poster" />
          <div class="d-info">
            <h3>{{ detail.title }}</h3>
            <div class="d-orig" v-if="detail.originalTitle !== detail.title">
              {{ detail.originalTitle }}
            </div>
            <NSpace :size="6" class="d-tags">
              <NTag size="small" :bordered="false">
                {{ detail.mediaType === 'movie' ? '电影' : '剧集' }}
              </NTag>
              <NTag v-if="detail.date" size="small" :bordered="false">
                {{ formatDate(detail.date) }}
              </NTag>
              <NTag v-if="detail.runtime" size="small" :bordered="false">
                {{ detail.runtime }} 分钟
              </NTag>
              <NTag v-for="g in detail.genres" :key="g" size="small" :bordered="false">
                {{ g }}
              </NTag>
            </NSpace>
            <div v-if="detail.rating" class="d-rate">
              <NRate :value="detail.rating / 2" readonly allow-half size="small" />
              <span>{{ detail.rating }} / 10</span>
            </div>
          </div>
        </div>

        <div class="d-people" v-if="detail.directors.length || detail.actors.length">
          <p v-if="detail.directors.length"><label>导演：</label>{{ detail.directors.join('、') }}</p>
          <p v-if="detail.actors.length"><label>主演：</label>{{ detail.actors.join('、') }}</p>
        </div>
        <p class="d-overview">{{ detail.overview || '暂无简介' }}</p>

        <div class="d-foot">
          <NSpace justify="space-between" align="center">
            <span class="hint">添加到本地影视库（会下载封面）</span>
            <NSpace>
              <NButton size="small" :loading="importing" @click="addMovie('want_to_watch')">
                想看
              </NButton>
              <NButton size="small" :loading="importing" @click="addMovie('watching')">在看</NButton>
              <NButton size="small" type="primary" :loading="importing" @click="addMovie('watched')">
                已看
              </NButton>
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
.d-people {
  margin-top: 14px;
  font-size: 13.5px;
  color: #3f444d;
  line-height: 1.8;
}
.d-people label {
  color: #9aa0ac;
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
