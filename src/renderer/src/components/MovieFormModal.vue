<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import {
  NModal,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NDatePicker,
  NButton,
  NSpace,
  useMessage
} from 'naive-ui'
import type { MovieInput } from '@shared/types'
import { MOVIE_STATUS_LABELS, MOVIE_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain } from '@/utils/image'

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

function tagOptions(list: string[]): { label: string; value: string }[] {
  return list.map((v) => ({ label: v, value: v }))
}
const directorOptions = computed(() => tagOptions(meta.value.directors))
const writerOptions = computed(() => tagOptions(meta.value.writers))
const actorOptions = computed(() => tagOptions(meta.value.actors))
const genreOptions = computed(() => tagOptions(meta.value.genres))

const posterUrl = computed(() => toImgUrl(form.posterPath))

onMounted(async () => {
  meta.value = await window.mook.movie.metadata()
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
          <div class="poster-box">
            <img v-if="posterUrl" :src="posterUrl" />
            <div v-else class="poster-empty">无海报</div>
          </div>
          <NButton size="small" :loading="picking" block @click="choosePoster">
            选择海报
          </NButton>
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
        </div>

        <div class="fields-col">
          <NForm label-placement="top" size="small">
            <NFormItem label="名称" required>
              <NInput v-model:value="form.title" placeholder="影视名称" />
            </NFormItem>

            <div class="grid-2">
              <NFormItem label="状态">
                <NSelect v-model:value="form.status" :options="statusOptions" />
              </NFormItem>
              <NFormItem label="分类">
                <NSelect v-model:value="form.category" :options="categoryOptions" />
              </NFormItem>
            </div>

            <div class="grid-3">
              <NFormItem label="评分（0-10）">
                <NInputNumber
                  v-model:value="form.rating"
                  :min="0"
                  :max="10"
                  :step="0.5"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="时长（分钟）">
                <NInputNumber
                  v-model:value="form.duration"
                  :min="0"
                  :step="1"
                  class="full"
                />
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

            <div class="grid-2">
              <NFormItem label="上映日期">
                <NDatePicker
                  v-model:value="form.releaseTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="观看日期">
                <NDatePicker
                  v-model:value="form.watchTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
            </div>

            <NFormItem label="导演">
              <NSelect
                v-model:value="form.directors"
                :options="directorOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>
            <NFormItem label="编剧">
              <NSelect
                v-model:value="form.writers"
                :options="writerOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>
            <NFormItem label="主演">
              <NSelect
                v-model:value="form.actors"
                :options="actorOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>
            <NFormItem label="类型">
              <NSelect
                v-model:value="form.genres"
                :options="genreOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="如 剧情 / 科幻"
              />
            </NFormItem>
            <NFormItem label="别名">
              <NSelect
                v-model:value="form.alternateTitles"
                :options="[]"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>

            <NFormItem label="剧情简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 6 }"
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
</template>

<style scoped>
.form-card {
  width: 860px;
  max-width: 94vw;
}
.form-body {
  display: flex;
  gap: 20px;
  max-height: 72vh;
}
.poster-col {
  flex: 0 0 160px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.poster-box {
  width: 160px;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #eef0f5;
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
.fields-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
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
</style>
