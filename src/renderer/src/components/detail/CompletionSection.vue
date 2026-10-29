<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NDatePicker,
  NInput,
  NSpace,
  NPopconfirm,
  useMessage
} from 'naive-ui'
import type { GameCompletion } from '@shared/types'
import { tsToIso, formatDate } from '@/utils/image'

const props = defineProps<{ gameId: string }>()
const message = useMessage()
const items = ref<GameCompletion[]>([])
const loading = ref(false)
const editorShow = ref(false)
const saving = ref(false)
const form = ref({ dateTs: Date.now(), note: '' })

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.completion.list(props.gameId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openAdd(): void {
  form.value = { dateTs: Date.now(), note: '' }
  editorShow.value = true
}

async function save(): Promise<void> {
  if (!form.value.dateTs) {
    message.warning('请选择通关日期')
    return
  }
  saving.value = true
  try {
    const date = tsToIso(form.value.dateTs)
    if (!date) return
    const now = new Date().toISOString()
    await window.mook.completion.add({
      id: window.mook.util.uuid(),
      gameId: props.gameId,
      completionDate: date,
      note: form.value.note.trim(),
      createdAt: now,
      updatedAt: now
    })
    editorShow.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(e: GameCompletion): Promise<void> {
  await window.mook.completion.remove(e.id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">通关记录（{{ items.length }}）</span>
      <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 记录通关</NButton>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有通关记录" size="small" />
      <div v-else class="list">
        <div v-for="e in items" :key="e.id" class="row">
          <div>
            <span class="date">🏁 {{ formatDate(e.completionDate) }}</span>
            <span v-if="e.note" class="note">{{ e.note }}</span>
          </div>
          <NPopconfirm @positive-click="remove(e)">
            <template #trigger>
              <NButton size="tiny" quaternary type="error">删除</NButton>
            </template>
            删除这条通关记录？
          </NPopconfirm>
        </div>
      </div>
    </NSpin>

    <NModal v-model:show="editorShow" :auto-focus="false">
      <div class="editor">
        <h3>记录通关</h3>
        <NForm label-placement="top" size="small">
          <NFormItem label="通关日期">
            <NDatePicker v-model:value="form.dateTs" type="date" class="full" />
          </NFormItem>
          <NFormItem label="备注">
            <NInput
              v-model:value="form.note"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 5 }"
              placeholder="通关感想（可选）"
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
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid #f2f3f6;
}
.date {
  font-weight: 600;
  color: #1f2329;
  margin-right: 12px;
}
.note {
  font-size: 13px;
  color: #5b616c;
}
.editor {
  width: 480px;
  max-width: 92vw;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.full {
  width: 100%;
}
.editor-footer {
  margin-top: 8px;
}
</style>
