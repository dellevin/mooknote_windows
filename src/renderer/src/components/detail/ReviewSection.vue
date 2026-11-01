<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NTag,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NDatePicker,
  NRadioGroup,
  NRadioButton,
  NSpace,
  NImage,
  NImageGroup,
  NPopconfirm,
  NCheckbox,
  useMessage,
  useDialog
} from 'naive-ui'
import type { Review, ReviewKind, ReviewInput, ReviewType } from '@shared/types'
import { REVIEW_TYPE_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, formatDate, plain } from '@/utils/image'

const props = defineProps<{ kind: ReviewKind; parentId: string }>()

const message = useMessage()
const dialog = useDialog()
const reviews = ref<Review[]>([])
const loading = ref(false)

// 多选批量删除
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => reviews.value.length > 0 && selectedIds.value.size === reviews.value.length
)
function enterSelect(): void {
  selectMode.value = true
  selectedIds.value = new Set()
}
function exitSelect(): void {
  selectMode.value = false
  selectedIds.value = new Set()
}
function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleSelectAll(): void {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(reviews.value.map((r: Review) => r.id))
}
function batchRemove(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定删除选中的 ${n} 条评价吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.review.remove(props.kind, id))
      )
      exitSelect()
      await load()
    }
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    reviews.value = await window.mook.review.list(props.kind, props.parentId)
  } finally {
    loading.value = false
  }
}
onMounted(load)
defineExpose({ reload: load })

// ---- 编辑弹窗 ----
const editorShow = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const picking = ref(false)
const form = ref<{
  content: string
  reviewer: string
  source: string
  reviewType: ReviewType
  dateTs: number | null
  images: string[]
}>({ content: '', reviewer: '', source: '', reviewType: 1, dateTs: null, images: [] })

function resetForm(): void {
  form.value = {
    content: '',
    reviewer: '',
    source: '',
    reviewType: 1,
    dateTs: Date.now(),
    images: []
  }
}

async function openAdd(): Promise<void> {
  editingId.value = null
  resetForm()
  editorShow.value = true
}
function openEdit(r: Review): void {
  editingId.value = r.id
  form.value = {
    content: r.content,
    reviewer: r.reviewer ?? '',
    source: r.source ?? '',
    reviewType: r.reviewType,
    dateTs: isoToTs(r.reviewDate) ?? Date.now(),
    images: [...r.images]
  }
  editorShow.value = true
}

async function pickImages(): Promise<void> {
  // 图片按 reviewId 落盘；新建时先申请一个 id
  if (!editingId.value) editingId.value = await window.mook.review.newId()
  picking.value = true
  try {
    const paths = await window.mook.review.pickImages(editingId.value)
    form.value.images.push(...paths)
  } finally {
    picking.value = false
  }
}

async function save(): Promise<void> {
  if (!form.value.content.trim()) {
    message.warning('请填写评价内容')
    return
  }
  saving.value = true
  try {
    if (!editingId.value) editingId.value = await window.mook.review.newId()
    const payload: ReviewInput = {
      id: editingId.value,
      parentId: props.parentId,
      content: form.value.content.trim(),
      reviewer: form.value.reviewer.trim() || null,
      source: form.value.source.trim() || null,
      reviewType: form.value.reviewType,
      reviewDate: tsToIso(form.value.dateTs),
      images: form.value.images
    }
    const isNew = !reviews.value.some((r) => r.id === payload.id)
    await window.mook.review.save(props.kind, plain(payload), isNew)
    message.success('已保存')
    editorShow.value = false
    await load()
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}

async function remove(r: Review): Promise<void> {
  await window.mook.review.remove(props.kind, r.id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">评价（{{ reviews.length }}）</span>
      <NSpace :size="6">
        <template v-if="selectMode">
          <NButton size="tiny" quaternary @click="toggleSelectAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </NButton>
          <NButton
            size="tiny"
            type="error"
            ghost
            :disabled="!selectedIds.size"
            @click="batchRemove"
          >
            删除<span v-if="selectedIds.size">（{{ selectedIds.size }}）</span>
          </NButton>
          <NButton size="tiny" quaternary @click="exitSelect">完成</NButton>
        </template>
        <template v-else>
          <NButton size="tiny" quaternary :disabled="!reviews.length" @click="enterSelect">
            多选
          </NButton>
          <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 写评价</NButton>
        </template>
      </NSpace>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!reviews.length && !loading" description="还没有评价" size="small" />
      <div v-else class="review-list">
        <div
          v-for="r in reviews"
          :key="r.id"
          class="review"
          :class="{ picked: selectMode && selectedIds.has(r.id) }"
          @click="selectMode ? toggleSelect(r.id) : undefined"
        >
          <div v-if="selectMode" class="pick-row">
            <NCheckbox :checked="selectedIds.has(r.id)" @click.stop @update:checked="() => toggleSelect(r.id)" />
          </div>
          <div class="review-meta">
            <NTag size="tiny" :type="r.reviewType === 2 ? 'warning' : 'default'" :bordered="false">
              {{ REVIEW_TYPE_LABELS[r.reviewType] }}
            </NTag>
            <span v-if="r.reviewer" class="who">{{ r.reviewer }}</span>
            <span v-if="r.source" class="muted">来自 {{ r.source }}</span>
            <span class="muted">{{ formatDate(r.reviewDate) }}</span>
          </div>
          <p class="review-content">{{ r.content }}</p>
          <div v-if="r.images.length" class="review-images">
            <NImageGroup>
              <NSpace :size="6">
                <NImage
                  v-for="img in r.images"
                  :key="img"
                  :src="toImgUrl(img)"
                  object-fit="cover"
                  class="thumb"
                />
              </NSpace>
            </NImageGroup>
          </div>
          <div v-if="!selectMode" class="review-actions">
            <NButton size="tiny" quaternary @click="openEdit(r)">编辑</NButton>
            <NPopconfirm to="body" @positive-click="remove(r)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">删除</NButton>
              </template>
              删除这条评价？
            </NPopconfirm>
          </div>
        </div>
      </div>
    </NSpin>

    <NModal v-model:show="editorShow" :auto-focus="false">
      <div class="editor">
        <h3>{{ editingId && reviews.some((r) => r.id === editingId) ? '编辑评价' : '写评价' }}</h3>
        <NForm label-placement="top" size="small">
          <div class="editor-row">
            <NFormItem label="类型">
              <NRadioGroup v-model:value="form.reviewType">
                <NRadioButton :value="1">短评</NRadioButton>
                <NRadioButton :value="2">长评</NRadioButton>
              </NRadioGroup>
            </NFormItem>
            <NFormItem label="评价日期">
              <NDatePicker v-model:value="form.dateTs" type="date" clearable />
            </NFormItem>
          </div>
          <div class="editor-row">
            <NFormItem label="评价人">
              <NInput v-model:value="form.reviewer" placeholder="自己 / 他人" />
            </NFormItem>
            <NFormItem label="来源">
              <NInput v-model:value="form.source" placeholder="豆瓣 / 网页 等" />
            </NFormItem>
          </div>
          <NFormItem label="内容">
            <NInput
              v-model:value="form.content"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 10 }"
              placeholder="写下你的评价…"
            />
          </NFormItem>
          <NFormItem label="配图">
            <div class="img-edit">
              <NSpace :size="6">
                <div v-for="(img, i) in form.images" :key="img" class="img-cell">
                  <img :src="toImgUrl(img)" />
                  <button class="img-del" @click="form.images.splice(i, 1)">✕</button>
                </div>
              </NSpace>
              <NButton size="tiny" :loading="picking" @click="pickImages">＋ 添加图片</NButton>
            </div>
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
.section {
  width: 100%;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.review {
  border: 1px solid #f0f1f4;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.review.picked {
  border-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 5%, #fff);
}
.pick-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}
.review-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}
.who {
  color: #3d434d;
  font-weight: 600;
}
.muted {
  color: #9aa0ac;
}
.review-content {
  font-size: 13.5px;
  line-height: 1.7;
  color: #3d434d;
  white-space: pre-wrap;
}
.thumb {
  width: 84px;
  height: 84px;
  border-radius: 6px;
}
.review-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.editor {
  width: 620px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.editor-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.img-cell {
  position: relative;
  width: 72px;
  height: 72px;
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
