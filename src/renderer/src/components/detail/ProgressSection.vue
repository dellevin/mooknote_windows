<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NCheckbox,
  NRate,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NDatePicker,
  NSpace,
  NImage,
  NImageGroup,
  NPopconfirm,
  useMessage
} from 'naive-ui'
import type { ProgressEntry, ProgressKind } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, formatDate, plain } from '@/utils/image'

const props = defineProps<{
  kind: ProgressKind
  parentId: string
  title: string
  noLabel: string // 集 / 章 / 关
}>()

const message = useMessage()
const entries = ref<ProgressEntry[]>([])
const loading = ref(false)
const picking = ref(false)

const doneCount = computed(() => entries.value.filter((e) => e.done).length)

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = await window.mook.progress.list(props.kind, props.parentId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function toggle(e: ProgressEntry, v: boolean): Promise<void> {
  await window.mook.progress.toggle(props.kind, e.id, v)
  await load()
}

// ---- 编辑器 ----
const editorShow = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = ref({
  no: 1,
  title: '',
  dateTs: null as number | null,
  rating: null as number | null,
  review: '',
  images: [] as string[]
})

function openAdd(): void {
  editingId.value = null
  form.value = {
    no: entries.value.length + 1,
    title: '',
    dateTs: Date.now(),
    rating: null,
    review: '',
    images: []
  }
  editorShow.value = true
}
function openEdit(e: ProgressEntry): void {
  editingId.value = e.id
  form.value = {
    no: e.no,
    title: e.title,
    dateTs: isoToTs(e.date),
    rating: e.rating,
    review: e.review,
    images: [...e.images]
  }
  editorShow.value = true
}

async function pickImages(): Promise<void> {
  picking.value = true
  try {
    const paths = await window.mook.progress.pickImages(props.kind, props.parentId)
    form.value.images.push(...paths)
  } finally {
    picking.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    if (!editingId.value) editingId.value = await window.mook.progress.newId()
    const payload: ProgressEntry = {
      id: editingId.value,
      parentId: props.parentId,
      no: form.value.no || 0,
      title: form.value.title.trim(),
      done: true,
      date: tsToIso(form.value.dateTs),
      rating: form.value.rating,
      review: form.value.review.trim(),
      images: form.value.images,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    const isNew = !entries.value.some((e) => e.id === payload.id)
    await window.mook.progress.save(props.kind, plain(payload), isNew)
    editorShow.value = false
    await load()
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}

async function remove(e: ProgressEntry): Promise<void> {
  await window.mook.progress.remove(props.kind, e.id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">
        {{ title }}（{{ doneCount }}/{{ entries.length }}）
      </span>
      <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 添加{{ noLabel }}</NButton>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!entries.length && !loading" :description="`还没有${title}记录`" size="small" />
      <div v-else class="list">
        <div v-for="e in entries" :key="e.id" class="row" :class="{ done: e.done }">
          <NCheckbox :checked="e.done" @update:checked="(v: boolean) => toggle(e, v)">
            <span class="no">{{ noLabel }} {{ e.no }}</span>
            <span v-if="e.title" class="t">{{ e.title }}</span>
          </NCheckbox>
          <div class="right">
            <NRate
              v-if="e.rating != null"
              :value="e.rating"
              readonly
              size="small"
              :max="10"
              allow-half
            />
            <span class="date">{{ formatDate(e.date) }}</span>
            <NButton size="tiny" quaternary @click="openEdit(e)">编辑</NButton>
            <NPopconfirm @positive-click="remove(e)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">删</NButton>
              </template>
              删除这条记录？
            </NPopconfirm>
          </div>
        </div>
        <template v-for="e in entries" :key="e.id + '-d'">
          <div v-if="e.review || e.images.length" class="detail">
            <p v-if="e.review">{{ e.review }}</p>
            <NImageGroup v-if="e.images.length">
              <NSpace :size="6">
                <NImage
                  v-for="img in e.images"
                  :key="img"
                  :src="toImgUrl(img)"
                  object-fit="cover"
                  class="thumb"
                />
              </NSpace>
            </NImageGroup>
          </div>
        </template>
      </div>
    </NSpin>

    <NModal v-model:show="editorShow" :auto-focus="false">
      <div class="editor">
        <h3>{{ editingId && entries.some((e) => e.id === editingId) ? '编辑' : '添加' }}{{ noLabel }}记录</h3>
        <NForm label-placement="top" size="small">
          <div class="grid-3">
            <NFormItem :label="`${noLabel}号`">
              <NInputNumber v-model:value="form.no" :min="1" class="full" />
            </NFormItem>
            <NFormItem label="日期">
              <NDatePicker v-model:value="form.dateTs" type="date" clearable class="full" />
            </NFormItem>
            <NFormItem label="评分">
              <NInputNumber
                v-model:value="form.rating"
                :min="0"
                :max="10"
                :step="0.5"
                clearable
                class="full"
              />
            </NFormItem>
          </div>
          <NFormItem label="标题">
            <NInput v-model:value="form.title" :placeholder="`${noLabel}标题（可选）`" />
          </NFormItem>
          <NFormItem label="评语">
            <NInput
              v-model:value="form.review"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
            />
          </NFormItem>
          <NFormItem label="截图">
            <NSpace :size="6">
              <div v-for="(img, i) in form.images" :key="img" class="img-cell">
                <img :src="toImgUrl(img)" />
                <button class="img-del" @click="form.images.splice(i, 1)">✕</button>
              </div>
              <NButton size="small" :loading="picking" @click="pickImages">＋ 图片</NButton>
            </NSpace>
          </NFormItem>
        </NForm>
        <div class="editor-footer">
          <NSpace justify="end">
            <NButton @click="editorShow = false">取消</NButton>
            <NButton type="primary" :loading="saving" @click="save">保存</NButton>
          </NSpace>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.list {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  border-bottom: 1px solid #f2f3f6;
}
.row.done .t,
.row.done .no {
  color: #8a909c;
}
.no {
  font-weight: 600;
  color: #1f2329;
  margin-right: 8px;
}
.t {
  color: #3d434d;
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.date {
  font-size: 12px;
  color: #9aa0ac;
  min-width: 78px;
}
.detail {
  padding: 4px 4px 10px 28px;
}
.detail p {
  font-size: 13px;
  color: #5b616c;
  line-height: 1.6;
  margin-bottom: 6px;
}
.thumb {
  width: 72px;
  height: 72px;
  border-radius: 6px;
}
.editor {
  width: 600px;
  max-width: 92vw;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 14px;
}
.full {
  width: 100%;
}
.img-cell {
  position: relative;
  width: 64px;
  height: 64px;
}
.img-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
}
.img-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
}
.editor-footer {
  margin-top: 8px;
}
</style>
