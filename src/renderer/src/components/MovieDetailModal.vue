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
  },
  { immediate: true }
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
const STATUS_TYPE: Record<string, 'info' | 'success' | 'warning'> = {
  want_to_watch: 'info',
  watching: 'success',
  watched: 'warning'
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
    <div class="detail-card">
      <div v-if="loading" class="state">
        <NSpin size="medium" />
      </div>
      <NEmpty v-else-if="!movie" class="state" description="记录不存在或已删除" />
      <template v-else>
        <div class="hero" :class="{ 'no-cover': !toImgUrl(movie.posterPath) }">
          <img
            v-if="toImgUrl(movie.posterPath)"
            class="hero-bg"
            :src="toImgUrl(movie.posterPath)"
            alt=""
          />
          <div class="hero-mask"></div>
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
              <NTag size="small" :type="STATUS_TYPE[movie.status]" round :bordered="false">
                {{ MOVIE_STATUS_LABELS[movie.status] }}
              </NTag>
              <NTag size="small" round :bordered="false" class="cat-tag">
                {{ MOVIE_CATEGORY_LABELS[movie.category] ?? movie.category }}
              </NTag>
            </div>
            <div v-if="movie.rating != null" class="rating-row">
              <NRate :value="movie.rating" :max="10" allow-half readonly size="small" />
              <span class="rating-num">{{ movie.rating.toFixed(1) }}</span>
            </div>
            <div class="kv">
              <span v-if="movie.releaseDate" class="chip">
                <i>上映</i>{{ formatDate(movie.releaseDate) }}
              </span>
              <span v-if="movie.watchDate" class="chip">
                <i>观看</i>{{ formatDate(movie.watchDate) }}
              </span>
              <span v-if="movie.duration" class="chip"><i>时长</i>{{ movie.duration }} 分钟</span>
              <span v-if="movie.watchCount" class="chip">
                <i>看过</i>{{ movie.watchCount }} 次
              </span>
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
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  height: 86vh;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.state {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 深色沉浸式头部：海报虚化铺底 + 遮罩，海报浮于左侧 */
.hero {
  position: relative;
  display: flex;
  gap: 22px;
  padding: 26px 28px 22px;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, #1f2c3d, #152030 60%, #0e1622);
}
.hero.no-cover {
  background: linear-gradient(135deg, #24344a, #172436 55%, #0f1a28);
}
.hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(30px) brightness(0.55) saturate(1.25);
  transform: scale(1.18);
  pointer-events: none;
  user-select: none;
}
.hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(10, 16, 26, 0.72) 0%,
    rgba(10, 16, 26, 0.45) 45%,
    rgba(10, 16, 26, 0.62) 100%
  );
  pointer-events: none;
}
.poster {
  position: relative;
  z-index: 1;
  flex: 0 0 148px;
  width: 148px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  background: rgba(255, 255, 255, 0.08);
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
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
.head-info {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 23px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
  line-height: 1.3;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.alt {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 10px;
}
.badges {
  display: flex;
  gap: 8px;
  margin: 2px 0 12px;
}
.cat-tag {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #e8ebf5 !important;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #ffc53d;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 3px 10px;
}
.chip i {
  font-style: normal;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 44px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 3px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  margin: 14px 0 8px;
}
.summary {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 14px;
}
.summary .section-title {
  margin-top: 0;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
  margin: 0;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
  flex-shrink: 0;
}
</style>
