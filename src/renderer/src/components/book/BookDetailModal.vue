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

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}小时${m ? m + '分' : ''}` : `${m}分`
}

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
  },
  { immediate: true }
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
const STATUS_TYPE: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  want_to_read: 'info',
  reading: 'success',
  read: 'warning',
  abandoned: 'default'
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-card">
      <div v-if="loading" class="state">
        <NSpin size="medium" />
      </div>
      <NEmpty v-else-if="!book" class="state" description="记录不存在或已删除" />
      <template v-else>
        <div class="hero" :class="{ 'no-cover': !toImgUrl(book.coverPath) }">
          <img
            v-if="toImgUrl(book.coverPath)"
            class="hero-bg"
            :src="toImgUrl(book.coverPath)"
            alt=""
          />
          <div class="hero-mask"></div>
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
              <NTag size="small" :type="STATUS_TYPE[book.status]" round :bordered="false">
                {{ BOOK_STATUS_LABELS[book.status] }}
              </NTag>
              <NTag size="small" round :bordered="false" class="cat-tag">
                {{ BOOK_CATEGORY_LABELS[book.category] ?? book.category }}
              </NTag>
            </div>
            <div v-if="book.rating != null" class="rating-row">
              <NRate :value="book.rating" :max="10" allow-half readonly size="small" />
              <span class="rating-num">{{ book.rating.toFixed(1) }}</span>
            </div>
            <div class="kv">
              <span v-if="book.publisher" class="chip"><i>出版社</i>{{ book.publisher }}</span>
              <span v-if="book.publishDate" class="chip">
                <i>出版</i>{{ formatDate(book.publishDate) }}
              </span>
              <span v-if="book.startDate" class="chip">
                <i>开始</i>{{ formatDate(book.startDate) }}
              </span>
              <span v-if="book.finishDate" class="chip">
                <i>读完</i>{{ formatDate(book.finishDate) }}
              </span>
              <span v-if="book.readCount" class="chip"><i>读过</i>{{ book.readCount }} 次</span>
              <span v-if="book.readDuration" class="chip">
                <i>阅读时长</i>{{ formatDuration(book.readDuration) }}
              </span>
              <span v-if="book.isbn" class="chip"><i>ISBN</i>{{ book.isbn }}</span>
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
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  height: 86vh;
  max-height: 86vh;
  background: var(--surface);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.state {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 深色沉浸式头部：封面虚化铺底 + 遮罩，封面浮于左侧 */
.hero {
  position: relative;
  display: flex;
  gap: 22px;
  padding: 26px 28px 22px;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, #2a2636, #1d1926 60%, #140f1c);
}
.hero.no-cover {
  background: linear-gradient(135deg, #332c44, #201b2c 55%, #150f20);
}
.hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(30px) brightness(0.55) saturate(1.25);
  transform: scale(1.18);
  pointer-events: none;
  user-select: none;
}
.hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(18, 13, 26, 0.72) 0%,
    rgba(18, 13, 26, 0.45) 45%,
    rgba(18, 13, 26, 0.62) 100%
  );
  pointer-events: none;
}
.cover {
  position: relative;
  z-index: 1;
  flex: 0 0 148px;
  width: 148px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  background: rgba(255, 255, 255, 0.08);
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
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
.head-info {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 23px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 6px;
  line-height: 1.3;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.alt {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 10px;
}
.badges {
  display: flex;
  gap: 8px;
  margin: 2px 0 12px;
}
.cat-tag {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #e8ebf5 !important;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #ffc53d;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 3px 10px;
}
.chip i {
  font-style: normal;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 44px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 3px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 14px 0 8px;
}
.summary {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 14px;
}
.summary .section-title {
  margin-top: 0;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
  margin: 0;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
  flex-shrink: 0;
}
</style>
