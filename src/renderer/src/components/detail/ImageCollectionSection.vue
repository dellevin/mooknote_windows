<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NEmpty, NSpin, NImage, NImageGroup, NPopconfirm, useMessage } from 'naive-ui'
import type { MediaImage } from '@shared/types'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{
  kind: 'poster' | 'screenshot'
  parentId: string
  title: string
}>()

const message = useMessage()
const items = ref<MediaImage[]>([])
const loading = ref(false)
const adding = ref(false)

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
      <NButton size="tiny" type="primary" ghost :loading="adding" @click="add">＋ 添加</NButton>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有图片" size="small" />
      <NImageGroup v-else>
        <div class="gallery">
          <div v-for="it in items" :key="it.id" class="cell">
            <NImage :src="toImgUrl(it.imagePath)" object-fit="cover" class="img" />
            <NPopconfirm to="body" @positive-click="remove(it.id)">
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
