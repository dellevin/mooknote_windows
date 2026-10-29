<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NTag,
  NRate,
  NEmpty,
  NSpin,
  NTabs,
  NTabPane,
  useDialog
} from 'naive-ui'
import type { Movie } from '@shared/types'
import { MOVIE_STATUS_LABELS, MOVIE_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import ReviewSection from '@/components/detail/ReviewSection.vue'
import ImageCollectionSection from '@/components/detail/ImageCollectionSection.vue'
import ProgressSection from '@/components/detail/ProgressSection.vue'
import PeopleSection from '@/components/detail/PeopleSection.vue'
import CharacterSection from '@/components/detail/CharacterSection.vue'

const props = defineProps<{ show: boolean; id: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'edit', id: string): void
  (e: 'changed'): void
}>()

const dialog = useDialog()
const movie = ref<Movie | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  if (!props.id) return
  loading.value = true
  try {
    movie.value = await window.mook.movie.get(props.id)
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

function askDelete(): void {
  if (!movie.value) return
  const m = movie.value
  dialog.warning({
    title: '删除影视',
    content: `确定将「${m.title}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.movie.softDelete(m.id)
      emit('changed')
      emit('update:show', false)
    }
  })
}

const tagFields: { key: 'directors' | 'writers' | 'actors' | 'genres'; label: string }[] = [
  { key: 'directors', label: '导演' },
  { key: 'writers', label: '编剧' },
  { key: 'actors', label: '主演' },
  { key: 'genres', label: '类型' }
]
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
    <div class="detail-card">
      <NSpin :show="loading">
        <NEmpty v-if="!movie && !loading" description="记录不存在或已删除" />
        <template v-else-if="movie">
          <div class="hero">
            <div class="poster">
              <img v-if="toImgUrl(movie.posterPath)" :src="toImgUrl(movie.posterPath)" />
              <div v-else class="poster-empty">无海报</div>
            </div>
            <div class="head-info">
              <h2 class="title">{{ movie.title }}</h2>
              <div v-if="movie.alternateTitles.length" class="alt">
                {{ movie.alternateTitles.join(' / ') }}
              </div>
              <div class="badges">
                <NTag size="small" type="primary" :bordered="false">
                  {{ MOVIE_STATUS_LABELS[movie.status] }}
                </NTag>
                <NTag size="small" :bordered="false">
                  {{ MOVIE_CATEGORY_LABELS[movie.category] ?? movie.category }}
                </NTag>
              </div>
              <div v-if="movie.rating != null" class="rating-row">
                <NRate :value="movie.rating" :max="10" allow-half readonly size="small" />
                <span class="rating-num">{{ movie.rating.toFixed(1) }}</span>
              </div>
              <div class="kv">
                <span v-if="movie.releaseDate">上映：{{ formatDate(movie.releaseDate) }}</span>
                <span v-if="movie.watchDate">观看：{{ formatDate(movie.watchDate) }}</span>
                <span v-if="movie.duration">时长：{{ movie.duration }} 分钟</span>
                <span v-if="movie.watchCount">看过 {{ movie.watchCount }} 次</span>
              </div>
            </div>
          </div>

          <div class="body">
            <NTabs type="line" animated size="small">
              <NTabPane name="info" tab="资料">
                <div
                  v-for="f in tagFields"
                  :key="f.key"
                  v-show="movie[f.key].length"
                  class="tag-row"
                >
                  <span class="tag-label">{{ f.label }}</span>
                  <NSpace :size="6">
                    <NTag v-for="v in movie[f.key]" :key="v" size="small" :bordered="false">
                      {{ v }}
                    </NTag>
                  </NSpace>
                </div>

                <div v-if="movie.summary" class="summary">
                  <div class="section-title">剧情简介</div>
                  <p>{{ movie.summary }}</p>
                </div>
                <NEmpty v-else-if="!movie.summary" description="暂无简介" size="small" />
              </NTabPane>

              <NTabPane name="reviews" tab="评价">
                <ReviewSection :key="'rv-' + movie.id" kind="movie" :parent-id="movie.id" />
              </NTabPane>

              <NTabPane name="posters" tab="海报墙">
                <ImageCollectionSection
                  :key="'po-' + movie.id"
                  kind="poster"
                  :parent-id="movie.id"
                  title="海报墙"
                />
              </NTabPane>

              <NTabPane name="episodes" tab="分集">
                <ProgressSection
                  :key="'ep-' + movie.id"
                  kind="episode"
                  :parent-id="movie.id"
                  title="分集记录"
                  no-label="集"
                />
              </NTabPane>

              <NTabPane name="people" tab="人物">
                <PeopleSection :key="'pp-' + movie.id" kind="movie" :parent-id="movie.id" />
              </NTabPane>

              <NTabPane name="characters" tab="角色">
                <CharacterSection :key="'ch-' + movie.id" kind="movie" :parent-id="movie.id" />
              </NTabPane>
            </NTabs>
          </div>

          <div class="footer">
            <NSpace justify="end">
              <NButton type="error" quaternary @click="askDelete">删除</NButton>
              <NButton type="primary" @click="emit('edit', movie.id)">编辑</NButton>
            </NSpace>
          </div>
        </template>
      </NSpin>
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.hero {
  display: flex;
  gap: 22px;
  padding: 24px 26px 18px;
  background: linear-gradient(135deg, #f3f5fb, #eef1f8);
}
.poster {
  flex: 0 0 150px;
  width: 150px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  background: #e2e5ee;
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.poster-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
}
.head-info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 22px;
  color: #1f2329;
  margin-bottom: 6px;
}
.alt {
  font-size: 13px;
  color: #8a909c;
  margin-bottom: 10px;
}
.badges {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #f5a623;
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: #5b616c;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
}
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 40px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 2px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  margin: 8px 0 8px;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
}
</style>
