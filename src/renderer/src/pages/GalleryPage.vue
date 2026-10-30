<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NSelect, NEmpty, NSpin, NImage, NImageGroup, NTag, NInput } from 'naive-ui'
import type { GalleryImage } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import { useInfiniteScroll } from '@/utils/infiniteScroll'

const loading = ref(false)
const images = ref<GalleryImage[]>([])
const category = ref<string | null>(null)
const keyword = ref('')

const CATEGORY_LABELS: Record<string, string> = {
  movie_poster: '影视封面',
  movie_posters: '影视海报墙',
  book_cover: '书籍封面',
  game_cover: '游戏封面',
  game_screenshot: '游戏截图',
  note_image: '笔记图片',
  person_photo: '人物照片',
  movie_character: '影视角色',
  book_character: '书籍角色',
  game_character: '游戏角色'
}

const categoryOptions = computed(() =>
  [...new Set(images.value.map((i) => i.category))].map((c) => ({
    label: CATEGORY_LABELS[c] ?? c,
    value: c
  }))
)

// 搜索：按关联实体标题（影视/书名/游戏/笔记/人物名）匹配，空格拆词全部命中
const searchTokens = computed(() =>
  keyword.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
)
const filtered = computed(() =>
  images.value.filter((i) => {
    if (category.value && i.category !== category.value) return false
    if (searchTokens.value.length) {
      const hay = `${i.entityTitle ?? ''} ${catLabel(i.category)}`.toLowerCase()
      if (!searchTokens.value.every((t) => hay.includes(t))) return false
    }
    return true
  })
)

// 渲染窗口：图片元数据已在内存，分批挂载 DOM（NImage 自身已 lazy 加载文件）
const PAGE = 40
const renderCount = ref(PAGE)
const visible = computed(() => filtered.value.slice(0, renderCount.value))
const gallerySentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(
  gallerySentinel,
  () => {
    renderCount.value += PAGE
  },
  {
    root: () => document.querySelector('.content'),
    canLoad: () => renderCount.value < filtered.value.length,
    margin: '600px 0px'
  }
)
watch([filtered, category, keyword], () => (renderCount.value = PAGE))

function catLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c
}

onMounted(async () => {
  loading.value = true
  try {
    images.value = await window.mook.stats.gallery()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="title">图库 <span class="total">{{ filtered.length }} 张</span></h2>
      <div class="tools">
        <NInput
          v-model:value="keyword"
          placeholder="搜索影视 / 书籍 / 游戏 / 笔记 / 人物名"
          clearable
          size="small"
          class="search"
        />
        <NSelect
          v-model:value="category"
          :options="categoryOptions"
          placeholder="全部类型"
          clearable
          size="small"
          class="filter"
        />
      </div>
    </div>

    <NSpin :show="loading">
      <NEmpty
        v-if="!filtered.length && !loading"
        :description="keyword.trim() ? '没有匹配的图片' : '还没有图片'"
        class="empty"
      />
      <NImageGroup v-else>
        <div class="masonry">
          <div v-for="(img, i) in visible" :key="img.path + i" class="cell">
            <div class="img">
              <NImage
                :src="toImgUrl(img.path)"
                object-fit="cover"
                lazy
                :img-props="{ decoding: 'async' }"
              />
            </div>
            <div class="meta">
              <div class="line1">
                <NTag size="small" round type="primary" :bordered="false">{{ catLabel(img.category) }}</NTag>
                <span class="t" :title="img.entityTitle">{{ img.entityTitle || '未命名' }}</span>
              </div>
              <div class="d">{{ formatDate(img.createdAt) }}</div>
            </div>
          </div>
        </div>
        <div v-if="renderCount < filtered.length" ref="gallerySentinel" class="load-more">
          加载中…
        </div>
      </NImageGroup>
    </NSpin>
  </div>
</template>

<style scoped>
.page {
  padding: 20px 26px 32px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2329;
  display: flex;
  align-items: center;
  gap: 10px;
}
.total {
  font-size: 12px;
  font-weight: 500;
  color: #5b616c;
  background: #f2f4f8;
  border-radius: 999px;
  padding: 3px 11px;
}
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search {
  width: 300px;
}
.filter {
  width: 180px;
}
/* 瀑布流：保留每张图原始比例，避免人物照/截图被强行裁切 */
.masonry {
  column-width: 168px;
  column-gap: 14px;
}
.cell {
  break-inside: avoid;
  margin-bottom: 14px;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  overflow: hidden;
  /* 屏幕外的卡片跳过重排/绘制，长图库滚动更顺 */
  content-visibility: auto;
  contain-intrinsic-size: auto 240px;
  transition:
    border-color var(--d2) var(--fluent-ease),
    box-shadow var(--d2) var(--fluent-ease);
}
.cell:hover {
  border-color: #dfe3ee;
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.08);
}
.img {
  background: #f4f5f8;
  line-height: 0;
}
.img :deep(.n-image),
.img :deep(.n-image img) {
  width: 100%;
  display: block;
}
.img :deep(.n-image img) {
  position: static;
  height: auto;
}
.meta {
  padding: 9px 11px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.line1 {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.t {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: #3f444d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d {
  font-size: 11px;
  color: #a8adb8;
}
.load-more {
  padding: 16px 0 8px;
  text-align: center;
  font-size: 12.5px;
  color: #a8adb8;
}
.empty {
  margin-top: 90px;
}
</style>
