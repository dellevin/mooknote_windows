<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NButton, NSpace, NEmpty, NSpin, NTag, NPopconfirm, NCheckbox } from 'naive-ui'
import type { CustomModule, CustomModuleItem } from '@shared/types'
import { formatDate } from '@/utils/image'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
}>()

const items = ref<CustomModuleItem[]>([])
const modules = ref<CustomModule[]>([])
const loading = ref(false)
const selected = ref<Set<string>>(new Set())
const allSelected = computed(() => items.value.length > 0 && selected.value.size === items.value.length)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.customItem.deleted()
    modules.value = await window.mook.customModule.list(true)
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
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((it) => it.id))
}
async function batchRestore(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.customItem.restore(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}
async function batchPurge(): Promise<void> {
  const ids = [...selected.value]
  if (!ids.length) return
  await Promise.all(ids.map((id) => window.mook.customItem.purge(id)))
  selected.value = new Set()
  await load()
  emit('changed')
}

function moduleName(id: string): string {
  return modules.value.find((m) => m.id === id)?.name ?? '已删除分类'
}

async function restore(it: CustomModuleItem): Promise<void> {
  await window.mook.customItem.restore(it.id)
  emit('changed')
  await load()
}
async function purge(it: CustomModuleItem): Promise<void> {
  await window.mook.customItem.purge(it.id)
  emit('changed')
  await load()
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="box">
      <h3>自定义分类回收站</h3>
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
          选中的 {{ selected.size }} 个条目及其图片将被彻底删除，不可恢复。确定？
        </NPopconfirm>
      </div>
      <NSpin :show="loading" class="spin">
        <NEmpty v-if="!items.length && !loading" description="回收站是空的" />
        <div v-else class="list">
          <div
            v-for="it in items"
            :key="it.id"
            class="row"
            :class="{ picked: selected.has(it.id) }"
          >
            <div class="info">
              <NCheckbox :checked="selected.has(it.id)" @update:checked="toggle(it.id)" />
              <div class="text">
                <span class="title">
                  {{ it.title || '无标题条目' }}
                  <NTag size="tiny" :bordered="false">{{ moduleName(it.moduleId) }}</NTag>
                </span>
                <span class="date">删除于 {{ formatDate(it.updatedAt) }}</span>
              </div>
            </div>
            <NSpace :size="8" class="acts">
              <NButton size="tiny" type="primary" quaternary @click="restore(it)">恢复</NButton>
              <NPopconfirm @positive-click="purge(it)">
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
.box {
  width: 660px;
  max-width: 92vw;
  height: 70vh;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
}
.box h3 {
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
  display: flex;
  align-items: center;
  gap: 6px;
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
