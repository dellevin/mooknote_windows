<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import {
  NButton,
  NInput,
  NSelect,
  NAutoComplete,
  NEmpty,
  NSpin,
  NTag,
  NDynamicTags,
  NImage,
  NImageGroup,
  useDialog
} from 'naive-ui'
import type { Note, NoteInput } from '@shared/types'
import { NOTE_SORT_LABELS } from '@shared/types'
import { formatDate, plain, toImgUrl } from '@/utils/image'
import { plainPreview } from '@/utils/markdown'
import NoteBinModal from '@/components/note/NoteBinModal.vue'
import WysiwygEditor from '@/components/note/WysiwygEditor.vue'

const dialog = useDialog()
const notes = ref<Note[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const keyword = ref('')
const initialNoteSort = (): number => {
  const v = Number(localStorage.getItem('sortNote'))
  return Number.isFinite(v) && v > 0 ? v : 0
}
const sortMode = ref(initialNoteSort())
// 标签筛选：输入 # 触发联想；activeTag 为当前生效标签（芯片展示，可点 × 取消）
const activeTag = ref<string | null>(null)
const allTags = ref<string[]>([])
const PAGE_SIZE = 50
const listSentinel = ref<HTMLElement | null>(null)

const binShow = ref(false)
const editing = ref<Note | null>(null)
const form = ref({
  id: '',
  title: '',
  content: '',
  tags: [] as string[],
  images: [] as string[],
  isPinned: false
})
const hasSelection = computed(() => !!form.value.id)

// 自动保存状态：idle 灰（无内容/初始）、dirty 橙（未保存）、saving 蓝（保存中）、saved 绿、error 红
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
const saveStatus = ref<SaveStatus>('idle')
const statusText = computed(
  () =>
    ({
      idle: '待输入',
      dirty: '未保存',
      saving: '保存中…',
      saved: '已自动保存',
      error: '保存失败'
    })[saveStatus.value]
)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let hydrated = false

const sortOptions = Object.entries(NOTE_SORT_LABELS).map(([value, label]) => ({
  label,
  value: Number(value)
}))
const metaText = computed(() =>
  editing.value
    ? `创建于 ${formatDate(editing.value.createdAt)} · 更新于 ${formatDate(editing.value.updatedAt)}`
    : '新笔记'
)
// 字数统计：剥离 markdown 语法与空白后计数（中文按字、英文连写计 1，个人笔记以中文为主）
const wordCount = computed(() => {
  const text = form.value.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_`#~|\-]+/g, '')
    .replace(/\s+/g, '')
  return text.length
})

function noteQuery(limit: number, offset: number) {
  return window.mook.note.list({
    keyword: keyword.value || undefined,
    tag: activeTag.value ?? undefined,
    sortMode: sortMode.value,
    limit,
    offset
  })
}

// 搜索框联想：仅当光标所在“词”以 # 开头时，从全部标签里过滤候选
const tagSuggestOptions = computed(() => {
  const m = /#([^\s#]*)$/.exec(keyword.value)
  if (!m) return []
  const q = m[1].toLowerCase()
  return allTags.value
    .filter((t: string) => !q || t.toLowerCase().includes(q))
    .slice(0, 8)
    .map((t: string) => ({ label: '#' + t, value: '#' + t }))
})

// 选中标签：把末尾 #片段 换成空输入并将标签设为筛选条件
function pickTag(value: string): void {
  keyword.value = keyword.value.replace(/#[^\s#]*$/, '').trimEnd()
  activeTag.value = value.replace(/^#/, '')
  void load()
}

function clearTag(): void {
  activeTag.value = null
  void load()
}

// 回车：搜索框里还留着 #片段 时视为选第一个标签，否则普通关键词搜索
function onSearchEnter(): void {
  const opt = tagSuggestOptions.value[0]
  if (opt) {
    pickTag(opt.value)
    return
  }
  void load()
}

async function load(selectId?: string): Promise<void> {
  loading.value = true
  try {
    const rows = await noteQuery(PAGE_SIZE, 0)
    notes.value = rows
    hasMore.value = rows.length === PAGE_SIZE
    allTags.value = await window.mook.note.tags()
    if (selectId) {
      const fresh = notes.value.find((n) => n.id === selectId)
      if (fresh) hydrate(fresh)
    }
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const rows = await noteQuery(PAGE_SIZE, notes.value.length)
    notes.value = [...notes.value, ...rows]
    hasMore.value = rows.length === PAGE_SIZE
  } finally {
    loadingMore.value = false
  }
}

useInfiniteScroll(
  listSentinel,
  loadMore,
  {
    root: () => document.querySelector('.rail-list'),
    canLoad: () => hasMore.value && !loadingMore.value && !loading.value,
    margin: '400px 0px'
  }
)

function setSort(m: number): void {
  sortMode.value = m
  localStorage.setItem('sortNote', String(m))
  void load()
}

function onSaveShortcut(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.key.toLowerCase() !== 's') return
  e.preventDefault()
  if (form.value.id) void persist()
}

onMounted(() => {
  window.addEventListener('keydown', onSaveShortcut)
  void load()
})

function clearSaveTimer(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function hydrate(n: Note | null): void {
  clearSaveTimer()
  hydrated = false
  editing.value = n
  if (n) {
    form.value = {
      id: n.id,
      title: n.title,
      content: n.content,
      tags: [...n.tags],
      images: [...n.images],
      isPinned: n.isPinned
    }
  } else {
    form.value = { id: '', title: '', content: '', tags: [], images: [], isPinned: false }
  }
  saveStatus.value = 'idle'
  // 等本次赋值触发的 watch 跑完，避免误判为改动
  void Promise.resolve().then(() => {
    hydrated = true
  })
}

async function openCreate(): Promise<void> {
  hydrate(null)
  form.value.id = await window.mook.note.newId()
}
function openNote(n: Note): void {
  hydrate(n)
}

const picking = ref(false)
async function pickImages(): Promise<void> {
  if (!form.value.id) return
  picking.value = true
  try {
    const paths = await window.mook.note.pickImages(form.value.id)
    for (const p of paths) if (!form.value.images.includes(p)) form.value.images.push(p)
  } finally {
    picking.value = false
  }
}

async function persist(): Promise<void> {
  clearSaveTimer()
  if (!form.value.id) return
  // 标题、正文、图片全空才不入库
  if (
    !form.value.content.trim() &&
    !form.value.title.trim() &&
    !form.value.images.length
  ) {
    saveStatus.value = 'idle'
    return
  }
  const payload: NoteInput = {
    id: form.value.id,
    title: form.value.title.trim(),
    content: form.value.content,
    contentType: 'markdown',
    tags: form.value.tags,
    images: form.value.images,
    isPinned: form.value.isPinned
  }
  const wasNew = !editing.value
  saveStatus.value = 'saving'
  try {
    const body = plain(payload)
    const saved = wasNew
      ? await window.mook.note.create(body)
      : await window.mook.note.update(body)
    editing.value = saved
    saveStatus.value = 'saved'
    // 静默刷新左栏（更新排序/置顶/时间），不重新 hydrate 当前编辑器以免打断输入
    const rows = await noteQuery(PAGE_SIZE, 0)
    notes.value = rows
    hasMore.value = rows.length === PAGE_SIZE
  } catch {
    saveStatus.value = 'error'
  }
}

// 内容/标题/标签/置顶/图片任一改动：标记未保存并防抖 800ms 自动落库
watch(
  () => [
    form.value.title,
    form.value.content,
    form.value.tags,
    form.value.isPinned,
    form.value.images
  ],
  () => {
    if (!hydrated || !form.value.id) return
    if (
      !form.value.content.trim() &&
      !form.value.title.trim() &&
      !form.value.images.length
    ) {
      saveStatus.value = 'idle'
      return
    }
    saveStatus.value = 'dirty'
    clearSaveTimer()
    saveTimer = setTimeout(() => void persist(), 800)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  clearSaveTimer()
  window.removeEventListener('keydown', onSaveShortcut)
})

async function togglePin(n: Note): Promise<void> {
  // 正在编辑的笔记：仅切换表单，交给防抖自动保存；列表中的其他笔记直接落库
  if (editing.value?.id === n.id) {
    form.value.isPinned = !n.isPinned
    return
  }
  await window.mook.note.togglePin(n.id, !n.isPinned)
  await load()
}

function askDelete(n: Note): void {
  dialog.warning({
    title: '删除笔记',
    content: `确定将「${n.title || '无标题笔记'}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.note.softDelete(n.id)
      if (editing.value?.id === n.id) hydrate(null)
      await load()
    }
  })
}

// 标签输入框：输入时从已有标签联想，选中即加为标签；也可直接回车新建
const tagDraft = ref('')
function tagSuggestFrom(q: string): { label: string; value: string }[] {
  const kw = q.trim().toLowerCase()
  return allTags.value
    .filter((t: string) => !form.value.tags.includes(t) && (!kw || t.toLowerCase().includes(kw)))
    .slice(0, 8)
    .map((t: string) => ({ label: '#' + t, value: t }))
}
function submitTag(submit: (v: string) => void, v?: string): void {
  const val = (v ?? tagDraft.value).trim()
  if (!val || form.value.tags.includes(val)) return
  submit(val)
  tagDraft.value = ''
}
// 插槽输入框挂载后自动聚焦（NDynamicTags 默认聚焦逻辑够不到插槽组件）
function focusTagInput(inst: unknown): void {
  ;(inst as { focus?: () => void } | null)?.focus?.()
}

function cardTitle(n: Note): string {
  if (n.title) return n.title
  return plainPreview(n.content, 20) || '无标题笔记'
}
</script>

<template>
  <div class="page">
    <div class="notes-wrap">
      <aside class="note-rail">
        <div class="rail-head">
          <div class="rail-title-row">
            <h2 class="page-title">笔记</h2>
            <div class="rail-title-ops">
              <NButton size="small" type="primary" class="new-btn" @click="openCreate">
                ＋ 写笔记
              </NButton>
              <NButton size="small" quaternary @click="binShow = true">回收站</NButton>
            </div>
          </div>
          <div class="rail-search">
            <NSelect
              v-model:value="sortMode"
              :options="sortOptions"
              :consistent-menu-width="false"
              size="small"
              class="sort-select"
              @update:value="setSort"
            />
            <NAutoComplete
              v-model:value="keyword"
              :options="tagSuggestOptions"
              :show-arrow="false"
              placeholder="搜索标题 / 正文，输入 # 选标签"
              clearable
              size="small"
              class="rail-search-input"
              @select="pickTag"
              @keyup.enter="onSearchEnter"
              @clear="load()"
            />
          </div>
          <div v-if="activeTag" class="active-tag">
            <NTag size="small" closable :bordered="false" type="info" @close="clearTag">
              #{{ activeTag }}
            </NTag>
          </div>
        </div>

        <NSpin :show="loading" class="rail-spin">
          <NEmpty v-if="!notes.length && !loading" description="还没有笔记" class="rail-empty" />
          <div v-else class="rail-list">
            <div
              v-for="n in notes"
              :key="n.id"
              class="note-row"
              :class="{ active: editing?.id === n.id, pinned: n.isPinned }"
              @click="openNote(n)"
            >
              <div class="row-main">
                <div class="row-title">
                  <svg v-if="n.isPinned" class="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M14 3l7 7-2.2 1.2-3.1-.9-3.3 3.3.4 2.7-1.4 1.4-3-4-4 4.5L3 17l4.5-4-4-3 1.4-1.4 2.7.4 3.3-3.3-.9-3.1L14 3z"
                    />
                  </svg>
                  <span class="row-title-text">{{ cardTitle(n) }}</span>
                </div>
                <p class="row-preview">{{ plainPreview(n.content, 60) || '无内容' }}</p>
                <div v-if="n.tags.length" class="row-tags">
                  <NTag v-for="t in n.tags.slice(0, 3)" :key="t" size="tiny" :bordered="false">
                    #{{ t }}
                  </NTag>
                </div>
                <div class="row-date">{{ formatDate(n.updatedAt) }}</div>
              </div>
              <div class="row-actions" @click.stop>
                <NButton size="tiny" quaternary @click="togglePin(n)">
                  {{ n.isPinned ? '取消置顶' : '置顶' }}
                </NButton>
                <NButton size="tiny" quaternary type="error" @click="askDelete(n)">删除</NButton>
              </div>
            </div>
            <div v-if="hasMore" ref="listSentinel" class="rail-more">
              {{ loadingMore ? '加载中…' : '' }}
            </div>
          </div>
        </NSpin>
      </aside>

      <section class="note-detail">
        <NEmpty
          v-if="!hasSelection"
          description="选择左侧笔记查看，或点「写笔记」新建一篇"
          class="detail-empty"
        />
        <div v-else class="note-editor">
          <div class="editor-head">
            <NInput
              v-model:value="form.title"
              placeholder="笔记标题（可留空）"
              :bordered="false"
              class="title-input"
            />
            <NButton
              size="small"
              type="primary"
              :loading="saveStatus === 'saving'"
              @click="persist"
            >
              保存
            </NButton>
          </div>
          <div class="editor-meta">
            <span>{{ metaText }}</span>
            <span class="meta-right">
              <span class="word-count">{{ wordCount }} 字</span>
              <span class="save-dot" :class="saveStatus" :title="statusText"></span>
            </span>
          </div>

          <div class="tag-row">
            <span class="field-label">标签</span>
            <NDynamicTags v-model:value="form.tags">
              <template #input="{ submit, deactivate }">
                <NAutoComplete
                  :ref="focusTagInput"
                  v-model:value="tagDraft"
                  :options="tagSuggestFrom(tagDraft)"
                  size="small"
                  placeholder="输入关键词选已有标签，或直接回车新建"
                  style="width: 240px"
                  @select="(v) => submitTag(submit, v)"
                  @keydown.enter.prevent.stop="submitTag(submit)"
                  @blur="deactivate"
                />
              </template>
            </NDynamicTags>
          </div>

          <WysiwygEditor :key="form.id" v-model="form.content" class="content-editor" />

          <div class="image-row">
            <span class="field-label">图片</span>
            <div class="image-list">
              <NImageGroup>
                <div v-for="(img, i) in form.images" :key="img" class="img-cell">
                  <NImage :src="toImgUrl(img)" object-fit="cover" />
                  <button
                    type="button"
                    class="img-del"
                    title="移除图片"
                    @click="form.images.splice(i, 1)"
                  >
                    ✕
                  </button>
                </div>
              </NImageGroup>
              <button
                type="button"
                class="img-add"
                :disabled="picking"
                title="添加图片"
                @click="pickImages"
              >
                ＋
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <NoteBinModal v-model:show="binShow" @changed="load()" />
  </div>
</template>

<style scoped>
.page {
  padding: 14px 18px 18px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.notes-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}

/* 左侧笔记栏 */
.note-rail {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 14px;
  overflow: hidden;
}
.rail-head {
  padding: 14px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid #f2f3f6;
}
.rail-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-title {
  font-size: 17px;
  color: #1f2329;
}
.new-btn {
  border-radius: 999px;
}
.rail-title-ops {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rail-search {
  display: flex;
  gap: 8px;
}
.sort-select {
  width: 92px;
  flex-shrink: 0;
}
.rail-search-input {
  flex: 1;
  min-width: 0;
}
.active-tag {
  margin-top: -2px;
  display: flex;
}
.rail-spin {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.rail-spin :deep(.n-spin-container),
.rail-spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.rail-list {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rail-more {
  height: 10px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #a8adb8;
}
.rail-empty {
  margin: auto;
}
.note-row {
  position: relative;
  display: flex;
  padding: 7px 10px 6px 11px;
  border-radius: 10px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #eef0f4;
  transition:
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}
.note-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #cfd4dd;
  transition: background 0.15s ease;
}
.note-row:hover {
  border-color: #e3e6ec;
  background: #fafbfc;
}
.note-row.active {
  border-color: #1f2329;
  background: #f7f8fa;
}
.note-row.active::before {
  background: #1f2329;
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}
.pin-icon {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  fill: #6b7280;
}
.row-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-preview {
  margin-top: 2px;
  font-size: 11.5px;
  color: #8a909c;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}
.row-tags {
  margin-top: 4px;
  display: flex;
  gap: 4px;
}
.row-date {
  margin-top: 3px;
  font-size: 10.5px;
  color: #b3b8c2;
}
.row-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  gap: 2px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border-radius: 7px;
  padding: 1px;
}
.note-row:hover .row-actions {
  display: flex;
}

/* 右侧详情/编辑：与左栏同款白底圆角描边，编辑器内部无边框融入其中 */
.note-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-empty {
  margin: auto;
}
.note-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 左侧多留一条 gutter：放 Notion 风格块手柄（＋ / ⠿），标题/标签/正文仍对齐 */
  padding: 18px 22px 18px 48px;
}
.editor-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title-input {
  flex: 1;
  font-size: 20px;
  font-weight: 600;
}
/* 去掉 NInput 无边框时仍保留的左右内边距，让标题贴左右两侧。
   Naive 把内边距以内联变量 --n-padding-left/right 写在根元素，
   内联优先级高，需在根元素上用 !important 覆盖变量本身。 */
.title-input {
  --n-padding-left: 0 !important;
  --n-padding-right: 0 !important;
}

/* 自动保存状态：仅颜色小点（悬停看文案） */
.save-dot {
  display: inline-block;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c2c6cd;
  transition: background 0.2s ease;
  cursor: default;
}
.save-dot.dirty {
  background: #f59e0b;
}
.save-dot.saving {
  background: #3b82f6;
}
.save-dot.saved {
  background: #22c55e;
}
.save-dot.error {
  background: #ef4444;
}

.editor-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #9aa0ac;
  margin: 2px 0 6px;
}
.word-count {
  color: #b3b8c2;
}
.meta-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
/* 标签行：编辑器上方 */
.tag-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 8px;
}
.tag-row :deep(.n-dynamic-tags) {
  flex: 1;
  min-width: 0;
}

.content-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.content-editor :deep(.vditor-wysiwyg),
.content-editor :deep(.vditor-textarea) {
  -webkit-user-select: text;
  user-select: text;
}

/* 图片行：编辑器下方，缩略图自动换行 */
.image-row {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
}
.image-list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.image-list :deep(.n-image-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field-label {
  flex: 0 0 36px;
  font-size: 13px;
  color: #5b616c;
  line-height: 28px;
}

/* 缩略图：固定 64×64 盒子，横图/竖图统一填满裁切，不按原图比例撑格 */
.img-cell {
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border-radius: 8px;
  overflow: hidden;
  background: #f2f3f6;
}
/* NImage 外层 .n-image 默认 inline-block 跟随原图尺寸，必须一并强制铺满 */
.img-cell :deep(.n-image) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.img-cell :deep(.n-image img),
.img-cell :deep(img) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block;
  border-radius: 8px;
}
/* 添加图片：与缩略图同尺寸的虚线占位框，无图时常驻显示 */
.img-add {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border: 1px dashed #cfd4dd;
  border-radius: 8px;
  background: #fff;
  color: #9aa0ac;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    color 0.12s ease;
}
.img-add:hover {
  border-color: #1f2329;
  color: #1f2329;
}
.img-add:disabled {
  opacity: 0.6;
  cursor: wait;
}
.img-del {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid #fff;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  z-index: 2;
  transition: background 0.12s ease;
}
.img-del:hover {
  background: #ef4444;
}
</style>
