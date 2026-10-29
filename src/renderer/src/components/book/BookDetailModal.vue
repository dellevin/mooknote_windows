<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NTag,
  NRate,
  NEmpty,
  NSpin,
  NTabs,
  NTabPane,
  useDialog
} from 'naive-ui'
import type { Book } from '@shared/types'
import { BOOK_STATUS_LABELS, BOOK_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import ReviewSection from '@/components/detail/ReviewSection.vue'
import ExcerptSection from '@/components/detail/ExcerptSection.vue'
import ProgressSection from '@/components/detail/ProgressSection.vue'
import PeopleSection from '@/components/detail/PeopleSection.vue'
import CharacterSection from '@/components/detail/CharacterSection.vue'

const props = defineProps<{ show: boolean; id: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'edit', id: string): void
  (e: 'changed'): void
}>()

const dialog = useDialog()
const book = ref<Book | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  if (!props.id) return
  loading.value = true
  try {
    book.value = await window.mook.book.get(props.id)
  } finally {
    loading.value = false
  }
}
watch(
  () => [props.show, props.id],
  ([s]) => {
    if (s) void load()
  }
)

function askDelete(): void {
  if (!book.value) return
  const b = book.value
  dialog.warning({
    title: '删除书籍',
    content: `确定将「${b.title}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.book.softDelete(b.id)
      emit('changed')
      emit('update:show', false)
    }
  })
}

const tagFields: { key: 'authors' | 'translators' | 'genres'; label: string }[] = [
  { key: 'authors', label: '作者' },
  { key: 'translators', label: '译者' },
  { key: 'genres', label: '类型' }
]
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-card">
      <NSpin :show="loading">
        <NEmpty v-if="!book && !loading" description="记录不存在或已删除" />
        <template v-else-if="book">
          <div class="hero">
            <div class="cover">
              <img v-if="toImgUrl(book.coverPath)" :src="toImgUrl(book.coverPath)" />
              <div v-else class="cover-empty">无封面</div>
            </div>
            <div class="head-info">
              <h2 class="title">{{ book.title }}</h2>
              <div v-if="book.alternateTitles.length" class="alt">
                {{ book.alternateTitles.join(' / ') }}
              </div>
              <div class="badges">
                <NTag size="small" type="primary" :bordered="false">
                  {{ BOOK_STATUS_LABELS[book.status] }}
                </NTag>
                <NTag size="small" :bordered="false">
                  {{ BOOK_CATEGORY_LABELS[book.category] ?? book.category }}
                </NTag>
              </div>
              <div v-if="book.rating != null" class="rating-row">
                <NRate :value="book.rating" :max="10" allow-half readonly size="small" />
                <span class="rating-num">{{ book.rating.toFixed(1) }}</span>
              </div>
              <div class="kv">
                <span v-if="book.publisher">{{ book.publisher }}</span>
                <span v-if="book.isbn">ISBN：{{ book.isbn }}</span>
                <span v-if="book.publishDate">出版：{{ formatDate(book.publishDate) }}</span>
                <span v-if="book.startDate">开始：{{ formatDate(book.startDate) }}</span>
                <span v-if="book.finishDate">读完：{{ formatDate(book.finishDate) }}</span>
                <span v-if="book.readCount">读过 {{ book.readCount }} 次</span>
              </div>
            </div>
          </div>

          <div class="body">
            <NTabs type="line" animated size="small">
              <NTabPane name="info" tab="资料">
                <div
                  v-for="f in tagFields"
                  :key="f.key"
                  v-show="book[f.key].length"
                  class="tag-row"
                >
                  <span class="tag-label">{{ f.label }}</span>
                  <NSpace :size="6">
                    <NTag v-for="v in book[f.key]" :key="v" size="small" :bordered="false">
                      {{ v }}
                    </NTag>
                  </NSpace>
                </div>

                <div v-if="book.summary" class="summary">
                  <div class="section-title">简介</div>
                  <p>{{ book.summary }}</p>
                </div>
                <NEmpty v-else-if="!book.summary" description="暂无简介" size="small" />
              </NTabPane>

              <NTabPane name="reviews" tab="评价">
                <ReviewSection :key="'rv-' + book.id" kind="book" :parent-id="book.id" />
              </NTabPane>

              <NTabPane name="excerpts" tab="摘抄">
                <ExcerptSection :key="'ex-' + book.id" :book-id="book.id" />
              </NTabPane>

              <NTabPane name="chapters" tab="章节">
                <ProgressSection
                  :key="'ch-' + book.id"
                  kind="chapter"
                  :parent-id="book.id"
                  title="章节记录"
                  no-label="章"
                />
              </NTabPane>

              <NTabPane name="people" tab="人物">
                <PeopleSection :key="'pp-' + book.id" kind="book" :parent-id="book.id" />
              </NTabPane>

              <NTabPane name="characters" tab="角色">
                <CharacterSection :key="'cr-' + book.id" kind="book" :parent-id="book.id" />
              </NTabPane>
            </NTabs>
          </div>

          <div class="footer">
            <NSpace justify="end">
              <NButton type="error" quaternary @click="askDelete">删除</NButton>
              <NButton type="primary" @click="emit('edit', book.id)">编辑</NButton>
            </NSpace>
          </div>
        </template>
      </NSpin>
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.hero {
  display: flex;
  gap: 22px;
  padding: 24px 26px 18px;
  background: linear-gradient(135deg, #f3f5fb, #eef1f8);
}
.cover {
  flex: 0 0 150px;
  width: 150px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  background: #e2e5ee;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
}
.head-info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 22px;
  color: #1f2329;
  margin-bottom: 6px;
}
.alt {
  font-size: 13px;
  color: #8a909c;
  margin-bottom: 10px;
}
.badges {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #f5a623;
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: #5b616c;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
}
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 40px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 2px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  margin: 8px 0;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
}
</style>
