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
import type { BookInput, BookStatus } from '@shared/types'
import { BOOK_STATUS_LABELS, BOOK_CATEGORY_LABELS } from '@shared/types'
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
  coverPath: string | null
  authors: string[]
  translators: string[]
  alternateTitles: string[]
  publisher: string
  genres: string[]
  summary: string
  rating: number | null
  status: BookStatus
  category: string
  isbn: string
  publishTs: number | null
  startTs: number | null
  finishTs: number | null
  readCount: number
  coverOffset: number
}

function emptyForm(id: string): FormState {
  return {
    id,
    title: '',
    coverPath: null,
    authors: [],
    translators: [],
    alternateTitles: [],
    publisher: '',
    genres: [],
    summary: '',
    rating: null,
    status: 'want_to_read',
    category: 'book',
    isbn: '',
    publishTs: null,
    startTs: null,
    finishTs: null,
    readCount: 0,
    coverOffset: 0
  }
}

const form = reactive<FormState>(emptyForm(''))

const statusOptions = Object.entries(BOOK_STATUS_LABELS).map(([value, label]) => ({
  label,
  value
}))
const categoryOptions = Object.entries(BOOK_CATEGORY_LABELS).map(([value, label]) => ({
  label,
  value
}))

const meta = ref<{
  authors: string[]
  translators: string[]
  genres: string[]
  publishers: string[]
}>({ authors: [], translators: [], genres: [], publishers: [] })

const opts = (list: string[]) => list.map((v) => ({ label: v, value: v }))
const authorOptions = computed(() => opts(meta.value.authors))
const translatorOptions = computed(() => opts(meta.value.translators))
const genreOptions = computed(() => opts(meta.value.genres))
const publisherOptions = computed(() => opts(meta.value.publishers))

const coverUrl = computed(() => toImgUrl(form.coverPath))

onMounted(async () => {
  meta.value = await window.mook.book.metadata()
})

async function hydrate(): Promise<void> {
  meta.value = await window.mook.book.metadata()
  if (props.editId) {
    const b = await window.mook.book.get(props.editId)
    if (b) {
      Object.assign(form, {
        ...emptyForm(b.id),
        title: b.title,
        coverPath: b.coverPath,
        authors: [...b.authors],
        translators: [...b.translators],
        alternateTitles: [...b.alternateTitles],
        publisher: b.publisher ?? '',
        genres: [...b.genres],
        summary: b.summary ?? '',
        rating: b.rating,
        status: b.status,
        category: b.category,
        isbn: b.isbn ?? '',
        publishTs: isoToTs(b.publishDate),
        startTs: isoToTs(b.startDate),
        finishTs: isoToTs(b.finishDate),
        readCount: b.readCount,
        coverOffset: b.coverOffset
      })
      return
    }
  }
  Object.assign(form, emptyForm(await window.mook.book.newId()))
}

async function chooseCover(): Promise<void> {
  picking.value = true
  try {
    const p = await window.mook.book.pickCover(form.id)
    if (p) form.coverPath = p
  } finally {
    picking.value = false
  }
}

function close(): void {
  emit('update:show', false)
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    message.warning('请填写书名')
    return
  }
  saving.value = true
  try {
    const payload: BookInput = {
      id: form.id,
      title: form.title.trim(),
      coverPath: form.coverPath,
      authors: form.authors,
      translators: form.translators,
      alternateTitles: form.alternateTitles,
      publisher: form.publisher.trim() || null,
      genres: form.genres,
      summary: form.summary.trim() || null,
      rating: form.rating,
      status: form.status,
      category: form.category,
      isbn: form.isbn.trim() || null,
      publishDate: tsToIso(form.publishTs),
      startDate: tsToIso(form.startTs),
      finishDate: tsToIso(form.finishTs),
      readCount: form.readCount || 0,
      coverOffset: form.coverOffset
    }
    const body = plain(payload)
    if (props.editId) await window.mook.book.update(body)
    else await window.mook.book.create(body)
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
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <NCard
      class="form-card"
      :title="editId ? '编辑书籍' : '添加书籍'"
      closable
      size="small"
      :bordered="false"
      @close="close"
    >
      <div class="form-body">
        <div class="cover-col">
          <div class="cover-box">
            <img v-if="coverUrl" :src="coverUrl" />
            <div v-else class="cover-empty">无封面</div>
          </div>
          <NButton size="small" :loading="picking" block @click="chooseCover">选择封面</NButton>
          <NButton
            v-if="form.coverPath"
            size="small"
            quaternary
            type="error"
            block
            @click="form.coverPath = null"
          >
            移除封面
          </NButton>
        </div>

        <div class="fields-col">
          <NForm label-placement="top" size="small">
            <NFormItem label="书名" required>
              <NInput v-model:value="form.title" placeholder="书名" />
            </NFormItem>

            <div class="grid-2">
              <NFormItem label="状态">
                <NSelect v-model:value="form.status" :options="statusOptions" />
              </NFormItem>
              <NFormItem label="分类">
                <NSelect v-model:value="form.category" :options="categoryOptions" />
              </NFormItem>
            </div>

            <NFormItem label="作者">
              <NSelect
                v-model:value="form.authors"
                :options="authorOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>
            <NFormItem label="译者">
              <NSelect
                v-model:value="form.translators"
                :options="translatorOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>

            <div class="grid-2">
              <NFormItem label="出版社">
                <NSelect
                  v-model:value="form.publisher"
                  :options="publisherOptions"
                  filterable
                  tag
                  clearable
                  class="full"
                  placeholder="出版社"
                />
              </NFormItem>
              <NFormItem label="ISBN">
                <NInput v-model:value="form.isbn" placeholder="ISBN" />
              </NFormItem>
            </div>

            <NFormItem label="类型">
              <NSelect
                v-model:value="form.genres"
                :options="genreOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="如 文学 / 科幻"
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
              <NFormItem label="阅读次数">
                <NInputNumber
                  v-model:value="form.readCount"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
              <NFormItem label="出版日期">
                <NDatePicker
                  v-model:value="form.publishTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
            </div>
            <div class="grid-2">
              <NFormItem label="开始日期">
                <NDatePicker v-model:value="form.startTs" type="date" clearable class="full" />
              </NFormItem>
              <NFormItem label="读完日期">
                <NDatePicker v-model:value="form.finishTs" type="date" clearable class="full" />
              </NFormItem>
            </div>

            <NFormItem label="简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 6 }"
                placeholder="书籍简介"
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
.cover-col {
  flex: 0 0 150px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cover-box {
  width: 150px;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: #eef0f5;
}
.cover-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
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
