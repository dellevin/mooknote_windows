<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NButton, NSpace, NEmpty, NSpin, NPopconfirm, NCheckbox } from 'naive-ui'
import type { Note } from '@shared/types'
import { formatDate } from '@/utils/image'
import { plainPreview } from '@/utils/markdown'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
}>()

const items = ref<Note[]>([])
const loading = ref(false)
const selected = ref<Set<string>>(new Set())
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.note.list({ includeDeleted: true })
  } finally {
    loading.value = false
  }
}
watch(
  () => props.show,
  (s) => {
    if (s) {
      selected.value = new Set()
      void load()
    }
  }
)

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((n) => n.id))
}
async function batchRestore(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.note.restore(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}
async function batchPurge(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.note.purge(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}

async function restore(n: Note): Promise<void> {
  await window.mook.note.restore(n.id)
  emit('changed')
  await load()
}
async function purge(n: Note): Promise<void> {
  await window.mook.note.purge(n.id)
  emit('changed')
  await load()
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="bin">
      <h3>笔记回收站</h3>
      <div v-if="items.length" class="bulk">
        <NCheckbox :checked="allSelected" @update:checked="toggleAll">全选</NCheckbox>
        <NButton size="tiny" :disabled="!selected.size" @click="batchRestore">
          批量恢复<span v-if="selected.size">（{{ selected.size }}）</span>
        </NButton>
        <NPopconfirm @positive-click="batchPurge">
          <template #trigger>
            <NButton size="tiny" type="error" ghost :disabled="!selected.size">
              批量删除<span v-if="selected.size">（{{ selected.size }}）</span>
            </NButton>
          </template>
          选中的 {{ selected.size }} 篇笔记及其图片将被彻底删除，不可恢复。确定？
        </NPopconfirm>
      </div>
      <NSpin :show="loading" class="spin">
        <NEmpty v-if="!items.length && !loading" description="回收站是空的" />
        <div v-else class="list">
          <div
            v-for="n in items"
            :key="n.id"
            class="row"
            :class="{ picked: selected.has(n.id) }"
          >
            <div class="info">
              <NCheckbox :checked="selected.has(n.id)" @update:checked="toggle(n.id)" />
              <div class="text">
                <span class="title">{{ n.title || '无标题笔记' }}</span>
                <span class="preview">{{ plainPreview(n.content, 60) }}</span>
                <span class="date">删除前更新：{{ formatDate(n.updatedAt) }}</span>
              </div>
            </div>
            <NSpace :size="8" class="acts">
              <NButton size="tiny" type="primary" quaternary @click="restore(n)">恢复</NButton>
              <NPopconfirm @positive-click="purge(n)">
                <template #trigger>
                  <NButton size="tiny" type="error" quaternary>彻底删除</NButton>
                </template>
                彻底删除后图片也会清除，不可恢复？
              </NPopconfirm>
            </NSpace>
          </div>
        </div>
      </NSpin>
      <div class="footer">
        <NSpace justify="end">
          <NButton @click="emit('update:show', false)">关闭</NButton>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.bin {
  width: 680px;
  max-width: 92vw;
  height: 70vh;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
}
.bin h3 {
  flex-shrink: 0;
  font-size: 16px;
  margin-bottom: 12px;
}
.bulk {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.spin {
  flex: 1;
  min-height: 0;
  display: flex;
}
.spin :deep(.n-spin-container),
.spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 6px;
  border-radius: 8px;
  border-bottom: 1px solid #f2f3f6;
}
.row.picked {
  background: rgba(31, 35, 41, 0.05);
}
.info {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.info .text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.acts {
  flex-shrink: 0;
}
.title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.preview {
  font-size: 12.5px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.date {
  font-size: 11px;
  color: #9aa0ac;
}
.footer {
  flex-shrink: 0;
  margin-top: 12px;
}
</style>
