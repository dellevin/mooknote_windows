<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NImage,
  NImageGroup,
  NPopconfirm,
  NCheckbox,
  NSpace,
  useMessage,
  useDialog
} from 'naive-ui'
import type { MediaImage } from '@shared/types'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{
  kind: 'poster' | 'screenshot'
  parentId: string
  title: string
}>()

const message = useMessage()
const dialog = useDialog()
const items = ref<MediaImage[]>([])
const loading = ref(false)
const adding = ref(false)

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
    : new Set(items.value.map((it: MediaImage) => it.id))
}
function batchRemove(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定移除选中的 ${n} 张图片吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.imageCollection.remove(props.kind, id))
      )
      exitSelect()
      await load()
    }
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.imageCollection.list(props.kind, props.parentId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function add(): Promise<void> {
  adding.value = true
  try {
    items.value = await window.mook.imageCollection.add(props.kind, props.parentId)
  } catch (e) {
    message.error('添加失败：' + String(e))
  } finally {
    adding.value = false
  }
}

async function remove(id: string): Promise<void> {
  await window.mook.imageCollection.remove(props.kind, id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">{{ title }}（{{ items.length }}）</span>
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
          <NButton size="tiny" type="primary" ghost :loading="adding" @click="add">＋ 添加</NButton>
        </template>
      </NSpace>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有图片" size="small" />
      <NImageGroup v-else>
        <div class="gallery">
          <div
            v-for="it in items"
            :key="it.id"
            class="cell"
            :class="{ picked: selectMode && selectedIds.has(it.id) }"
            @click="selectMode ? toggleSelect(it.id) : undefined"
          >
            <NImage
              :src="toImgUrl(it.imagePath)"
              object-fit="cover"
              class="img"
              :preview-disabled="selectMode"
            />
            <div v-if="selectMode" class="pick-box">
              <NCheckbox :checked="selectedIds.has(it.id)" @click.stop @update:checked="() => toggleSelect(it.id)" />
            </div>
            <NPopconfirm v-if="!selectMode" to="body" @positive-click="remove(it.id)">
              <template #trigger>
                <button class="del">✕</button>
              </template>
              移除这张图片？
            </NPopconfirm>
          </div>
        </div>
      </NImageGroup>
    </NSpin>
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
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.cell {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #eef0f5;
  border: 2px solid transparent;
}
.cell.picked {
  border-color: var(--accent, #2563eb);
}
.pick-box {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  padding: 2px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
}
.img {
  width: 100%;
  height: 100%;
}
.del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.cell:hover .del {
  opacity: 1;
}
</style>
