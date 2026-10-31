<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import {
  NModal,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NDatePicker,
  NButton,
  NSpace,
  NRadioGroup,
  NRadioButton,
  NRate,
  NSpin,
  NEmpty,
  NTag,
  useMessage
} from 'naive-ui'
import type { MovieInput, TmdbSearchItem, TmdbDetail } from '@shared/types'
import { MOVIE_STATUS_LABELS, MOVIE_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain, remoteImg } from '@/utils/image'
import { tmdbToMovie } from '@/components/search/importHelper'
import TagPickField from '@/components/form/TagPickField.vue'

const props = defineProps<{ show: boolean; editId?: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const saving = ref(false)
const picking = ref(false)

interface FormState {
  id: string
  title: string
  posterPath: string | null
  releaseTs: number | null
  directors: string[]
  writers: string[]
  actors: string[]
  genres: string[]
  alternateTitles: string[]
  summary: string
  rating: number | null
  status: keyof typeof MOVIE_STATUS_LABELS
  category: string
  watchTs: number | null
  watchCount: number
  duration: number
  coverOffset: number
}

function emptyForm(id: string): FormState {
  return {
    id,
    title: '',
    posterPath: null,
    releaseTs: null,
    directors: [],
    writers: [],
    actors: [],
    genres: [],
    alternateTitles: [],
    summary: '',
    rating: null,
    status: 'want_to_watch',
    category: 'movie',
    watchTs: null,
    watchCount: 0,
    duration: 0,
    coverOffset: 0
  }
}

const form = reactive<FormState>(emptyForm(''))

const statusOptions = Object.entries(MOVIE_STATUS_LABELS).map(([value, label]) => ({
  label,
  value
}))
const categoryOptions = Object.entries(MOVIE_CATEGORY_LABELS).map(([value, label]) => ({
  label,
  value
}))

interface Meta {
  directors: string[]
  writers: string[]
  actors: string[]
  genres: string[]
}
const meta = ref<Meta>({ directors: [], writers: [], actors: [], genres: [] })

const posterUrl = computed(() => toImgUrl(form.posterPath))

// 星级：NRate 为 5 星半星制，存储为 0–10
const starValue = computed({
  get: () => (form.rating == null ? null : form.rating / 2),
  set: (v: number | null) => {
    form.rating = v == null ? null : Math.round(v * 2 * 10) / 10
  }
})

// TMDB token 已配置时才显示「从 TMDB 抓取填充」
const tmdbEnabled = ref(false)

onMounted(async () => {
  const [md, token] = await Promise.all([
    window.mook.movie.metadata(),
    window.mook.prefs.get<string>('tmdbApiToken', '')
  ])
  meta.value = md
  tmdbEnabled.value = !!String(token ?? '').trim()
})

async function hydrate(): Promise<void> {
  meta.value = await window.mook.movie.metadata()
  if (props.editId) {
    const m = await window.mook.movie.get(props.editId)
    if (m) {
      Object.assign(form, {
        ...emptyForm(m.id),
        title: m.title,
        posterPath: m.posterPath,
        releaseTs: isoToTs(m.releaseDate),
        directors: [...m.directors],
        writers: [...m.writers],
        actors: [...m.actors],
        genres: [...m.genres],
        alternateTitles: [...m.alternateTitles],
        summary: m.summary ?? '',
        rating: m.rating,
        status: m.status,
        category: m.category,
        watchTs: isoToTs(m.watchDate),
        watchCount: m.watchCount,
        duration: m.duration,
        coverOffset: m.coverOffset
      })
      return
    }
  }
  Object.assign(form, emptyForm(await window.mook.movie.newId()))
}

async function choosePoster(): Promise<void> {
  picking.value = true
  try {
    const p = await window.mook.movie.pickCover(form.id)
    if (p) form.posterPath = p
  } finally {
    picking.value = false
  }
}

function close(): void {
  emit('update:show', false)
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    message.warning('请填写影视名称')
    return
  }
  saving.value = true
  try {
    const payload: MovieInput = {
      id: form.id,
      title: form.title.trim(),
      posterPath: form.posterPath,
      releaseDate: tsToIso(form.releaseTs),
      directors: form.directors,
      writers: form.writers,
      actors: form.actors,
      genres: form.genres,
      alternateTitles: form.alternateTitles,
      summary: form.summary.trim() || null,
      rating: form.rating,
      status: form.status,
      category: form.category,
      watchDate: tsToIso(form.watchTs),
      watchCount: form.watchCount || 0,
      duration: form.duration || 0,
      coverOffset: form.coverOffset
    }
    const body = plain(payload)
    if (props.editId) await window.mook.movie.update(body)
    else await window.mook.movie.create(body)
    message.success(props.editId ? '已保存修改' : '已添加')
    emit('saved')
    close()
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}

// ── 从 TMDB 抓取填充 ──
const fetchShow = ref(false)
const keyword = ref('')
const searching = ref(false)
const searched = ref(false)
const results = ref<TmdbSearchItem[]>([])
const detailLoadingId = ref<string | null>(null)
let searchSeq = 0

function openFetch(): void {
  keyword.value = form.title
  results.value = []
  searched.value = false
  fetchShow.value = true
}

async function doSearch(): Promise<void> {
  const q = keyword.value.trim()
  if (!q) return
  const seq = ++searchSeq
  searching.value = true
  try {
    const r = await window.mook.search.tmdbSearch(q, 1)
    if (seq !== searchSeq) return
    results.value = r.results
    searched.value = true
  } catch (e) {
    if (seq === searchSeq) message.error('搜索失败：' + String(e))
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

async function applyResult(item: TmdbSearchItem): Promise<void> {
  const key = item.mediaType + item.id
  detailLoadingId.value = key
  try {
    const d: TmdbDetail = await window.mook.search.tmdbDetail(item.id, item.mediaType)
    // 用当前表单状态（想看看/状态与观看记录）覆盖抓取结果，只回填资料字段
    const filled = tmdbToMovie(d, form.id, form.status)
    let poster = form.posterPath
    if (d.posterUrl) {
      const local = await window.mook.search.downloadImage(d.posterUrl, 'tmdb', 'movies', form.id)
      if (local) poster = local
    }
    form.title = filled.title
    form.posterPath = poster
    form.releaseTs = isoToTs(filled.releaseDate)
    form.directors = [...filled.directors]
    form.writers = [...filled.writers]
    form.actors = [...filled.actors]
    form.genres = [...filled.genres]
    form.alternateTitles = [...filled.alternateTitles]
    form.summary = filled.summary ?? ''
    form.rating = filled.rating
    form.category = filled.category
    form.duration = filled.duration
    message.success(`已填充《${filled.title}》的资料，状态与观看记录保留不变`)
    fetchShow.value = false
  } catch (e) {
    message.error('填充失败：' + String(e))
  } finally {
    detailLoadingId.value = null
  }
}

defineExpose({ hydrate })
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
    <NCard
      class="form-card"
      :title="editId ? '编辑影视' : '添加影视'"
      closable
      size="small"
      :bordered="false"
      @close="close"
    >
      <div class="form-body">
        <div class="poster-col">
          <div class="poster-box" title="选择海报" @click="choosePoster">
            <img v-if="posterUrl" :src="posterUrl" />
            <div v-else class="poster-empty">无海报</div>
            <div class="poster-mask">
              <NButton size="tiny" secondary :loading="picking">选择海报</NButton>
            </div>
          </div>
          <NButton
            v-if="form.posterPath"
            size="small"
            quaternary
            type="error"
            block
            @click="form.posterPath = null"
          >
            移除海报
          </NButton>

          <NButton
            v-if="tmdbEnabled"
            size="small"
            secondary
            block
            class="tmdb-btn"
            @click="openFetch"
          >
            从 TMDB 抓取填充
          </NButton>
        </div>

        <div class="fields-col">
          <NForm label-placement="top" size="small">
            <!-- 基本信息 -->
            <div class="sec-title">基本信息</div>
            <NFormItem label="名称" required>
              <NInput v-model:value="form.title" placeholder="影视名称" />
            </NFormItem>

            <NFormItem label="别名">
              <TagPickField
                v-model="form.alternateTitles"
                label="别名"
                :candidates="[]"
                placeholder="输入别名后回车添加"
              />
            </NFormItem>

            <NFormItem label="状态">
              <NRadioGroup v-model:value="form.status" type="button" size="small">
                <NRadioButton v-for="o in statusOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <NFormItem label="类型分类">
              <NRadioGroup v-model:value="form.category" type="button" size="small">
                <NRadioButton v-for="o in categoryOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <div class="grid-2">
              <NFormItem label="我的评分">
                <div class="rate-row">
                  <NRate v-model:value="starValue" allow-half size="small" :max="5" />
                  <span class="rate-num">{{ form.rating != null ? form.rating : '—' }}</span>
                  <NButton
                    v-if="form.rating != null"
                    size="tiny"
                    quaternary
                    @click="form.rating = null"
                  >
                    清除
                  </NButton>
                </div>
              </NFormItem>
              <NFormItem label="时长（分钟）">
                <NInputNumber
                  v-model:value="form.duration"
                  :min="0"
                  :step="1"
                  clearable
                  class="full"
                />
              </NFormItem>
            </div>

            <!-- 创作信息 -->
            <div class="sec-title">创作信息</div>
            <NFormItem label="导演">
              <TagPickField v-model="form.directors" label="导演" :candidates="meta.directors" />
            </NFormItem>
            <NFormItem label="编剧">
              <TagPickField v-model="form.writers" label="编剧" :candidates="meta.writers" />
            </NFormItem>
            <NFormItem label="主演">
              <TagPickField v-model="form.actors" label="主演" :candidates="meta.actors" />
            </NFormItem>
            <TagPickField
              v-model="form.genres"
              label="类型"
              cloud
              :candidates="meta.genres"
            />

            <!-- 观看记录 -->
            <div class="sec-title">观看记录</div>
            <div class="grid-3">
              <NFormItem label="上映日期">
                <NDatePicker
                  v-model:value="form.releaseTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="观看日期">
                <NDatePicker v-model:value="form.watchTs" type="date" clearable class="full" />
              </NFormItem>
              <NFormItem label="观看次数">
                <NInputNumber
                  v-model:value="form.watchCount"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
            </div>

            <!-- 简介 -->
            <div class="sec-title">简介</div>
            <NFormItem label="剧情简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 8 }"
                placeholder="剧情简介"
              />
            </NFormItem>
          </NForm>
        </div>
      </div>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="close">取消</NButton>
          <NButton type="primary" :loading="saving" @click="save">保存</NButton>
        </NSpace>
      </template>
    </NCard>
  </NModal>

  <!-- TMDB 抓取弹窗（独立于编辑弹窗，避免嵌套多根节点导致内容不渲染） -->
  <NModal
    :show="fetchShow"
    @update:show="(v: boolean) => (fetchShow = v)"
    :auto-focus="false"
  >
      <div class="fetch-card">
        <h3>从 TMDB 抓取填充</h3>
        <div class="fetch-search">
          <NInput
            v-model:value="keyword"
            size="small"
            clearable
            placeholder="搜索电影 / 剧集，回车搜索"
            @keyup.enter="doSearch"
          />
          <NButton size="small" type="primary" :loading="searching" @click="doSearch">
            搜索
          </NButton>
        </div>

        <NSpin :show="searching">
          <div v-if="!searched" class="fetch-hint">输入关键词开始搜索</div>
          <NEmpty v-else-if="!results.length" description="没有结果" class="fetch-empty" />
          <div v-else class="fetch-list">
            <div
              v-for="r in results"
              :key="r.mediaType + r.id"
              class="fetch-item"
              @click="applyResult(r)"
            >
              <div class="fi-poster">
                <img v-if="r.posterUrl" :src="remoteImg(r.posterUrl, 'tmdb')" />
                <div v-else class="fi-fallback">🎟</div>
              </div>
              <div class="fi-info">
                <div class="fi-title">{{ r.title }}</div>
                <div class="fi-meta">
                  <NTag size="tiny" :bordered="false">
                    {{ r.mediaType === 'movie' ? '电影' : '剧集' }}
                  </NTag>
                  <span>{{ r.date ? r.date.slice(0, 4) : '' }}</span>
                  <span v-if="r.rating">★ {{ r.rating }}</span>
                </div>
                <div class="fi-overview">{{ r.overview || '暂无简介' }}</div>
              </div>
              <NButton
                size="tiny"
                type="primary"
                secondary
                :loading="detailLoadingId === r.mediaType + r.id"
              >
                填充
              </NButton>
            </div>
          </div>
        </NSpin>
      </div>
    </NModal>
</template>

<style scoped>
.form-card {
  width: 920px;
  max-width: 95vw;
}
.form-card :deep(.n-card__content) {
  padding-top: 8px;
}
.form-body {
  display: flex;
  gap: 22px;
  max-height: 74vh;
}
.poster-col {
  flex: 0 0 170px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.poster-box {
  position: relative;
  width: 170px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: #eef0f5;
  cursor: pointer;
}
.poster-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.poster-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0a6b2;
  font-size: 13px;
}
.poster-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.poster-box:hover .poster-mask {
  opacity: 1;
}
.tmdb-btn {
  margin-top: 2px;
}
.fields-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 6px;
}
.sec-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  margin: 14px 0 6px;
  padding-left: 8px;
  border-left: 3px solid var(--accent);
}
.sec-title:first-child {
  margin-top: 2px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 14px;
}
.full {
  width: 100%;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rate-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  min-width: 26px;
}

/* TMDB 抓取弹窗 */
.fetch-card {
  width: 620px;
  max-width: 94vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 22px;
}
.fetch-card h3 {
  font-size: 16px;
  color: var(--text-strong);
  margin-bottom: 14px;
}
.fetch-search {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.fetch-hint,
.fetch-empty {
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: #b0b5bd;
}
.fetch-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 56vh;
  overflow-y: auto;
  padding-right: 4px;
}
.fetch-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.fetch-item:hover {
  border-color: color-mix(in srgb, var(--accent-ink) 45%, #eef0f4);
  background: color-mix(in srgb, var(--accent) 5%, #ffffff);
}
.fi-poster {
  flex: 0 0 44px;
  width: 44px;
  height: 66px;
  border-radius: 6px;
  overflow: hidden;
  background: #f2f3f7;
}
.fi-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fi-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.fi-info {
  flex: 1;
  min-width: 0;
}
.fi-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fi-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #9aa0ac;
  margin: 3px 0;
}
.fi-overview {
  font-size: 12px;
  color: #8a909c;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
