<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
  useMessage
} from 'naive-ui'
import type { BookExcerpt } from '@shared/types'

const props = defineProps<{ bookId: string }>()
const message = useMessage()
const items = ref<BookExcerpt[]>([])
const loading = ref(false)
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
      <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 添加摘抄</NButton>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有摘抄" size="small" />
      <div v-else class="list">
        <div v-for="e in items" :key="e.id" class="excerpt">
          <div v-if="e.chapter" class="chapter">摘自《{{ e.chapter }}》</div>
          <p class="content">{{ e.content }}</p>
          <p v-if="e.comment" class="comment">感悟：{{ e.comment }}</p>
          <div class="actions">
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
  background: #fff;
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
