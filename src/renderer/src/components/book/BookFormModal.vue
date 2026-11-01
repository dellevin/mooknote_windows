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
  NRadioGroup,
  NRadioButton,
  NRate,
  useMessage
} from 'naive-ui'
import type { BookInput, BookStatus } from '@shared/types'
import { BOOK_STATUS_LABELS, BOOK_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain } from '@/utils/image'
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
  coverPath: string | null
  authors: string[]
  translators: string[]
  alternateTitles: string[]
  publisher: string | null
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
  readDuration: number
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
    publisher: null,
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
    readDuration: 0,
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

const publisherOptions = computed(() =>
  meta.value.publishers.map((v: string) => ({ label: v, value: v }))
)

const coverUrl = computed(() => toImgUrl(form.coverPath))

// 星级：NRate 为 5 星半星制，存储为 0–10
const starValue = computed({
  get: () => (form.rating == null ? null : form.rating / 2),
  set: (v: number | null) => {
    form.rating = v == null ? null : Math.round(v * 2 * 10) / 10
  }
})

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
        publisher: b.publisher,
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
        readDuration: b.readDuration ?? 0,
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
      publisher: form.publisher?.trim() || null,
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
      readDuration: form.readDuration || 0,
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
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
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
          <div class="cover-box" title="选择封面" @click="chooseCover">
            <img v-if="coverUrl" :src="coverUrl" />
            <div v-else class="cover-empty">无封面</div>
            <div class="cover-mask">
              <NButton size="tiny" secondary :loading="picking">选择封面</NButton>
            </div>
          </div>
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
            <!-- 基本信息 -->
            <div class="sec-title">基本信息</div>
            <NFormItem label="书名" required>
              <NInput v-model:value="form.title" placeholder="书名" />
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
              <NFormItem label="阅读次数">
                <NInputNumber
                  v-model:value="form.readCount"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
              <NFormItem label="阅读总时长（分钟）">
                <NInputNumber
                  v-model:value="form.readDuration"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
            </div>

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

            <!-- 创作信息 -->
            <div class="sec-title">创作信息</div>
            <NFormItem label="作者">
              <TagPickField v-model="form.authors" label="作者" :candidates="meta.authors" />
            </NFormItem>
            <NFormItem label="译者">
              <TagPickField
                v-model="form.translators"
                label="译者"
                :candidates="meta.translators"
              />
            </NFormItem>
            <TagPickField
              v-model="form.genres"
              label="类型"
              cloud
              :candidates="meta.genres"
            />

            <!-- 阅读记录 -->
            <div class="sec-title">阅读记录</div>
            <div class="grid-3">
              <NFormItem label="出版日期">
                <NDatePicker
                  v-model:value="form.publishTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="开始日期">
                <NDatePicker v-model:value="form.startTs" type="date" clearable class="full" />
              </NFormItem>
              <NFormItem label="读完日期">
                <NDatePicker v-model:value="form.finishTs" type="date" clearable class="full" />
              </NFormItem>
            </div>

            <!-- 简介 -->
            <div class="sec-title">简介</div>
            <NFormItem label="书籍简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 8 }"
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
.cover-col {
  flex: 0 0 170px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cover-box {
  position: relative;
  width: 170px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: #eef0f5;
  cursor: pointer;
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
.cover-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cover-box:hover .cover-mask {
  opacity: 1;
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
</style>
