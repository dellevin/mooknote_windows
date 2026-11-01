<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NPopconfirm,
  NCheckbox,
  useMessage,
  useDialog
} from 'naive-ui'
import type { BookExcerpt } from '@shared/types'

const props = defineProps<{ bookId: string }>()
const message = useMessage()
const dialog = useDialog()
const items = ref<BookExcerpt[]>([])
const loading = ref(false)

// 多选批量删除
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => items.value.length > 0 && selectedIds.value.size === items.value.length
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
    : new Set(items.value.map((e: BookExcerpt) => e.id))
}
function batchRemove(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定删除选中的 ${n} 条摘抄吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all([...selectedIds.value].map((id) => window.mook.excerpt.remove(id)))
      exitSelect()
      await load()
    }
  })
}
const editorShow = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ chapter: '', content: '', comment: '' })

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.excerpt.list(props.bookId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openAdd(): void {
  editingId.value = null
  form.value = { chapter: '', content: '', comment: '' }
  editorShow.value = true
}
function openEdit(e: BookExcerpt): void {
  editingId.value = e.id
  form.value = { chapter: e.chapter ?? '', content: e.content, comment: e.comment ?? '' }
  editorShow.value = true
}

async function save(): Promise<void> {
  if (!form.value.content.trim()) {
    message.warning('请填写摘抄内容')
    return
  }
  saving.value = true
  try {
    if (!editingId.value) editingId.value = window.mook.util.uuid()
    const now = new Date().toISOString()
    await window.mook.excerpt.save({
      id: editingId.value,
      bookId: props.bookId,
      chapter: form.value.chapter.trim() || null,
      content: form.value.content.trim(),
      comment: form.value.comment.trim() || null,
      createdAt: now,
      updatedAt: now,
      isNew: !items.value.some((e) => e.id === editingId.value)
    })
    editorShow.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(e: BookExcerpt): Promise<void> {
  await window.mook.excerpt.remove(e.id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">摘抄（{{ items.length }}）</span>
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
          <NButton size="tiny" quaternary :disabled="!items.length" @click="enterSelect">
            多选
          </NButton>
          <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 添加摘抄</NButton>
        </template>
      </NSpace>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有摘抄" size="small" />
      <div v-else class="list">
        <div
          v-for="e in items"
          :key="e.id"
          class="excerpt"
          :class="{ picked: selectMode && selectedIds.has(e.id) }"
          @click="selectMode ? toggleSelect(e.id) : undefined"
        >
          <div v-if="selectMode" class="pick-row">
            <NCheckbox :checked="selectedIds.has(e.id)" @click.stop @update:checked="() => toggleSelect(e.id)" />
          </div>
          <div v-if="e.chapter" class="chapter">摘自《{{ e.chapter }}》</div>
          <p class="content">{{ e.content }}</p>
          <p v-if="e.comment" class="comment">感悟：{{ e.comment }}</p>
          <div v-if="!selectMode" class="actions">
            <NButton size="tiny" quaternary @click="openEdit(e)">编辑</NButton>
            <NPopconfirm to="body" @positive-click="remove(e)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">删除</NButton>
              </template>
              删除这条摘抄？
            </NPopconfirm>
          </div>
        </div>
      </div>
    </NSpin>

    <NModal v-model:show="editorShow" :auto-focus="false">
      <div class="editor">
        <h3>{{ editingId ? '编辑摘抄' : '添加摘抄' }}</h3>
        <NForm label-placement="top" size="small">
          <NFormItem label="章节 / 出处">
            <NInput v-model:value="form.chapter" placeholder="章节名（可选）" />
          </NFormItem>
          <NFormItem label="摘抄内容">
            <NInput
              v-model:value="form.content"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 10 }"
            />
          </NFormItem>
          <NFormItem label="感悟 / 批注">
            <NInput
              v-model:value="form.comment"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
            />
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
.excerpt {
  border-left: 3px solid #d0d3d9;
  background: #f8f9fd;
  border-radius: 0 8px 8px 0;
  padding: 10px 14px;
  margin-bottom: 10px;
}
.excerpt.picked {
  border-left-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 6%, #f8f9fd);
}
.pick-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.chapter {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}
.content {
  font-size: 13.5px;
  line-height: 1.7;
  color: #2f3540;
  white-space: pre-wrap;
}
.comment {
  font-size: 13px;
  color: #5b616c;
  margin-top: 8px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.editor {
  width: 600px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.editor-footer {
  margin-top: 8px;
}
</style>
