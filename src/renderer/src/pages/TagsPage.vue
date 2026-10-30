<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NInput,
  NButton,
  NTag,
  NSpin,
  NEmpty,
  NModal,
  NRadioGroup,
  NRadio,
  NSelect,
  useMessage
} from 'naive-ui'
import {
  TAG_TYPE_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS,
  type Tag,
  type TagType,
  type Movie,
  type Book,
  type Game,
  type Note
} from '@shared/types'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import PosterCard from '@/components/PosterCard.vue'
import CoverCard from '@/components/CoverCard.vue'
import MovieDetailModal from '@/components/MovieDetailModal.vue'
import BookDetailModal from '@/components/book/BookDetailModal.vue'
import GameDetailModal from '@/components/game/GameDetailModal.vue'

const TYPES: TagType[] = ['movie_genre', 'book_genre', 'game_genre', 'note_tag']
const message = useMessage()

const loading = ref(false)
const tags = ref<Tag[]>([])
const usage = ref<Record<string, number>>({})
const active = ref<TagType>('movie_genre')

const adding = ref(false)
const addShow = ref(false)
const newName = ref('')
const addInputRef = ref<{ focus?: () => void } | null>(null)
function focusAddInput(): void {
  addInputRef.value?.focus?.()
}
const editingId = ref<string | null>(null)
const editingName = ref('')
const editInputRef = ref<{ focus?: () => void } | null>(null)
function focusEditInput(): void {
  editInputRef.value?.focus?.()
}

function openAdd(): void {
  newName.value = ''
  addShow.value = true
}

async function confirmAdd(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  adding.value = true
  try {
    await window.mook.tag.add(active.value, name)
    addShow.value = false
    newName.value = ''
    await load()
  } catch (e) {
    message.error('添加失败：' + String(e))
  } finally {
    adding.value = false
  }
}

// 标签按 parentId/sortOrder 组织成树（DAO 返回时已 ORDER BY sort_order, name）
interface FlatNode {
  tag: Tag
  depth: number
  childCount: number
}
const collapsed = ref<Set<string>>(new Set())
function toggleCollapse(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

const childrenMap = computed(() => {
  const m = new Map<string, Tag[]>()
  for (const t of tags.value.filter((x: Tag) => x.type === active.value)) {
    const key = t.parentId || ''
    const arr = m.get(key)
    if (arr) arr.push(t)
    else m.set(key, [t])
  }
  return m
})

const flat = computed<FlatNode[]>(() => {
  const out: FlatNode[] = []
  const walk = (parentId: string, depth: number): void => {
    for (const t of childrenMap.value.get(parentId) ?? []) {
      const childCount = childrenMap.value.get(t.id)?.length ?? 0
      out.push({ tag: t, depth, childCount })
      if (childCount > 0 && !collapsed.value.has(t.id)) walk(t.id, depth + 1)
    }
  }
  walk('', 0)
  return out
})
const shown = computed(() => flat.value)

// 渲染窗口：标签本身已在内存，只分批挂载到 DOM，避免一次渲染上千行卡顿
const PAGE = 80
const renderCount = ref(PAGE)
const visible = computed(() => flat.value.slice(0, renderCount.value))
const tagSentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(
  tagSentinel,
  () => {
    renderCount.value += PAGE
  },
  {
    root: () => document.querySelector('.content'),
    canLoad: () => renderCount.value < flat.value.length,
    margin: '500px 0px'
  }
)
watch([flat, active], () => (renderCount.value = PAGE))

// ── 拖拽排序 / 改层级（与手机端树形排列一致）──
type DropZone = 'before' | 'after' | 'into'
const dragId = ref<string | null>(null)
const dropHint = ref<{ id: string; zone: DropZone } | null>(null)
const rootDragOver = ref(false)

function onDragStart(e: DragEvent, t: Tag): void {
  dragId.value = t.id
  dropHint.value = null
  e.dataTransfer?.setData('text/plain', t.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOverRow(e: DragEvent, t: Tag): void {
  if (!dragId.value || dragId.value === t.id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const el = e.currentTarget as HTMLElement
  const ratio = (e.clientY - el.getBoundingClientRect().top) / el.offsetHeight
  const zone: DropZone = ratio < 0.3 ? 'before' : ratio > 0.72 ? 'after' : 'into'
  if (dropHint.value?.id !== t.id || dropHint.value.zone !== zone) {
    dropHint.value = { id: t.id, zone }
  }
  rootDragOver.value = false
}
function onDragLeaveRow(t: Tag): void {
  if (dropHint.value?.id === t.id) dropHint.value = null
}
async function onDropRow(e: DragEvent, t: Tag): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  const id = dragId.value
  const hint = dropHint.value
  dragId.value = null
  dropHint.value = null
  rootDragOver.value = false
  if (!id || !hint || id === t.id) return
  try {
    if (hint.zone === 'into') {
      const next = new Set(collapsed.value)
      next.delete(t.id)
      collapsed.value = next
      await window.mook.tag.move(id, t.id, null)
    } else {
      const parent = t.parentId || ''
      const siblings = (childrenMap.value.get(parent) ?? []).filter(
        (s: Tag) => s.id !== id
      )
      const idx = siblings.findIndex((s: Tag) => s.id === t.id)
      let beforeId: string | null
      if (hint.zone === 'before') {
        beforeId = t.id
      } else {
        beforeId = idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1].id : null
      }
      await window.mook.tag.move(id, parent, beforeId)
    }
    await load()
  } catch (err) {
    message.error(String(err))
  }
}
async function onDropRoot(e: DragEvent): Promise<void> {
  e.preventDefault()
  const id = dragId.value
  dragId.value = null
  dropHint.value = null
  rootDragOver.value = false
  if (!id) return
  await window.mook.tag.move(id, '', null)
  await load()
}
function endDrag(): void {
  dragId.value = null
  dropHint.value = null
  rootDragOver.value = false
}
function hintClass(t: Tag): Record<string, boolean> {
  return {
    'drop-before': dropHint.value?.id === t.id && dropHint.value.zone === 'before',
    'drop-after': dropHint.value?.id === t.id && dropHint.value.zone === 'after',
    'drop-into': dropHint.value?.id === t.id && dropHint.value.zone === 'into',
    dragging: dragId.value === t.id
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [all, counts] = await Promise.all([
      window.mook.tag.list(),
      window.mook.tag.usage(active.value)
    ])
    tags.value = all
    usage.value = counts
  } finally {
    loading.value = false
  }
}

async function switchType(t: TagType): Promise<void> {
  active.value = t
  usage.value = await window.mook.tag.usage(t)
}

const editShow = ref(false)
function startEdit(t: Tag): void {
  editingId.value = t.id
  editingName.value = t.name
  editShow.value = true
}

async function confirmEdit(): Promise<void> {
  const id = editingId.value
  const name = editingName.value.trim()
  if (!id) return
  editShow.value = false
  editingId.value = null
  if (!name) return
  const target = tags.value.find((t: Tag) => t.id === id)
  if (!target || name === target.name) return
  try {
    await window.mook.tag.rename(id, name)
    await load()
  } catch (e) {
    message.error(String(e))
  }
}

async function toggleHidden(t: Tag): Promise<void> {
  await window.mook.tag.toggleHidden(t.id)
  await load()
}

async function sync(): Promise<void> {
  const n = await window.mook.tag.sync()
  message.success(n ? `已从条目同步 ${n} 个新标签` : '标签已是最新')
  await load()
}

// ── 删除 / 合并弹窗 ──
const deleteTarget = ref<Tag | null>(null)
const deleteMode = ref<'detach' | 'purge' | 'merge'>('purge')
const mergeName = ref<string | null>(null)

const mergeOptions = computed(() =>
  tags.value
    .filter((t: Tag) => t.type === active.value && t.id !== deleteTarget.value?.id)
    .map((t: Tag) => ({
      label: `${t.name}（${usage.value[t.name] ?? 0} 次使用）`,
      value: t.name
    }))
)

function openDelete(t: Tag): void {
  deleteTarget.value = t
  deleteMode.value = 'purge'
  mergeName.value = null
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  if (deleteMode.value === 'merge' && !mergeName.value) {
    message.warning('请选择合并目标标签')
    return
  }
  try {
    await window.mook.tag.remove(
      deleteTarget.value.id,
      deleteMode.value,
      deleteMode.value === 'merge' ? (mergeName.value as string) : undefined
    )
    deleteTarget.value = null
    await load()
  } catch (e) {
    message.error(String(e))
  }
}

onMounted(load)

// ── 查看标签关联条目 ──
const viewTarget = ref<Tag | null>(null)
const viewLoading = ref(false)
const viewMovies = ref<Movie[]>([])
const viewBooks = ref<Book[]>([])
const viewGames = ref<Game[]>([])
const viewNotes = ref<Note[]>([])

// 标签只存名称字符串，note.list 的 tag 是 LIKE 子串匹配；影视/书/游戏没有按标签
// 查询接口，直接全量取未删除条目后在内存里按数组精确匹配（与 tagDao.usage 同思路）。
async function openView(t: Tag): Promise<void> {
  viewTarget.value = t
  viewMovies.value = []
  viewBooks.value = []
  viewGames.value = []
  viewNotes.value = []
  viewLoading.value = true
  try {
    if (t.type === 'note_tag') {
      viewNotes.value = (await window.mook.note.list({ tag: t.name })).filter((n) =>
        n.tags.includes(t.name)
      )
    } else if (t.type === 'movie_genre') {
      viewMovies.value = (await window.mook.movie.list()).filter((m) =>
        m.genres.includes(t.name)
      )
    } else if (t.type === 'book_genre') {
      viewBooks.value = (await window.mook.book.list()).filter((b) =>
        b.genres.includes(t.name)
      )
    } else {
      viewGames.value = (await window.mook.game.list()).filter((g) =>
        g.genres.includes(t.name)
      )
    }
  } catch (e) {
    message.error('加载关联条目失败：' + String(e))
  } finally {
    viewLoading.value = false
  }
}

const viewCount = computed(
  () =>
    viewMovies.value.length +
    viewBooks.value.length +
    viewGames.value.length +
    viewNotes.value.length
)

function notePreview(n: Note): string {
  return n.content.replace(/[#>*`\-\[\]()!]/g, '').trim().slice(0, 80) || '（无内容）'
}

// 详情弹窗
const detailShow = ref(false)
const detailId = ref<string | null>(null)
const detailKind = ref<'movie' | 'book' | 'game'>('movie')
function openDetail(kind: 'movie' | 'book' | 'game', id: string): void {
  detailKind.value = kind
  detailId.value = id
  detailShow.value = true
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="title">标签管理</h2>
      <div class="toolbar-ops">
        <NButton size="small" quaternary @click="sync">从条目同步</NButton>
        <NButton size="small" type="primary" @click="openAdd">＋ 新建标签</NButton>
      </div>
    </div>

    <div class="tabs">
      <button
        v-for="t in TYPES"
        :key="t"
        type="button"
        class="tab"
        :class="{ on: active === t }"
        @click="switchType(t)"
      >
        {{ TAG_TYPE_LABELS[t] }}
      </button>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!flat.length && !loading" description="还没有标签" class="empty" />
      <div
        v-else
        class="list"
        :class="{ 'root-over': rootDragOver }"
        @dragover.prevent
        @dragenter.prevent="rootDragOver = true"
        @drop="onDropRoot"
      >
        <div
          v-for="node in visible"
          :key="node.tag.id"
          class="row"
          :class="hintClass(node.tag)"
          :style="{ paddingLeft: 8 + node.depth * 22 + 'px' }"
          draggable="true"
          @dragstart="onDragStart($event, node.tag)"
          @dragover="onDragOverRow($event, node.tag)"
          @dragleave="onDragLeaveRow(node.tag)"
          @drop="onDropRow($event, node.tag)"
          @dragend="endDrag"
        >
          <button
            v-if="node.childCount > 0"
            type="button"
            class="caret"
            :class="{ open: !collapsed.has(node.tag.id) }"
            title="折叠/展开子标签"
            @click="toggleCollapse(node.tag.id)"
          >
            ▸
          </button>
          <span v-else class="caret-placeholder"></span>
          <button
            type="button"
            class="name name-btn"
            :class="{ hidden: node.tag.isHidden }"
            :title="`查看带有「${node.tag.name}」的条目`"
            @click.stop="openView(node.tag)"
          >
            {{ node.tag.name }}
          </button>
          <NTag v-if="node.tag.isHidden" size="tiny" :bordered="false">已隐藏</NTag>
          <button
            type="button"
            class="count count-btn"
            @click.stop="openView(node.tag)"
          >
            {{ usage[node.tag.name] ?? 0 }} 次使用
          </button>
          <div class="ops">
            <NButton size="tiny" quaternary @click.stop="startEdit(node.tag)">重命名</NButton>
            <NButton size="tiny" quaternary @click.stop="toggleHidden(node.tag)">
              {{ node.tag.isHidden ? '显示' : '隐藏' }}
            </NButton>
            <NButton size="tiny" type="error" quaternary @click.stop="openDelete(node.tag)">
              删除
            </NButton>
          </div>
        </div>
        <div v-if="renderCount < flat.length" ref="tagSentinel" class="load-more">
          加载中…
        </div>
      </div>
    </NSpin>

    <NModal
      :show="addShow"
      @update:show="(v: boolean) => !v && (addShow = false)"
      :auto-focus="false"
      @after-enter="focusAddInput"
    >
      <div class="dlg-card">
        <h3>新建标签 · {{ TAG_TYPE_LABELS[active] }}</h3>
        <NInput
          ref="addInputRef"
          v-model:value="newName"
          size="small"
          placeholder="输入标签名称"
          @keyup.enter="confirmAdd"
        />
        <div class="dlg-foot">
          <NButton size="small" @click="addShow = false">取消</NButton>
          <NButton size="small" type="primary" :loading="adding" @click="confirmAdd">
            添加
          </NButton>
        </div>
      </div>
    </NModal>

    <NModal
      :show="editShow"
      @update:show="(v: boolean) => !v && (editShow = false)"
      :auto-focus="false"
      @after-enter="focusEditInput"
    >
      <div class="dlg-card">
        <h3>重命名标签</h3>
        <NInput
          ref="editInputRef"
          v-model:value="editingName"
          size="small"
          placeholder="输入新名称"
          @keyup.enter="confirmEdit"
        />
        <div class="dlg-foot">
          <NButton size="small" @click="editShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="confirmEdit">保存</NButton>
        </div>
      </div>
    </NModal>

    <NModal
      :show="!!deleteTarget"
      @update:show="(v: boolean) => !v && (deleteTarget = null)"
      :auto-focus="false"
    >
      <div v-if="deleteTarget" class="del-card">
        <h3>删除标签「{{ deleteTarget.name }}」</h3>
        <NRadioGroup v-model:value="deleteMode" class="modes">
          <NRadio value="purge">从所有条目中移除该标签</NRadio>
          <NRadio value="detach">仅删除标签，条目里保留名称</NRadio>
          <NRadio value="merge">合并到另一个标签</NRadio>
        </NRadioGroup>
        <NSelect
          v-if="deleteMode === 'merge'"
          v-model:value="mergeName"
          :options="mergeOptions"
          size="small"
          placeholder="选择合并目标"
          filterable
          class="merge-select"
        />
        <div class="del-foot">
          <NButton size="small" @click="deleteTarget = null">取消</NButton>
          <NButton size="small" type="error" @click="confirmDelete">确定</NButton>
        </div>
      </div>
    </NModal>

    <NModal
      :show="!!viewTarget"
      @update:show="(v: boolean) => !v && (viewTarget = null)"
    >
      <div v-if="viewTarget" class="view-card">
        <div class="view-head">
            <h3>
              标签「{{ viewTarget.name }}」的关联条目
              <span class="view-type">{{ TAG_TYPE_LABELS[viewTarget.type] }}</span>
            </h3>
            <NButton size="tiny" quaternary @click="viewTarget = null">关闭</NButton>
          </div>
          <NSpin :show="viewLoading" class="view-body">
            <div v-if="!viewLoading && !viewCount" class="view-empty">
              没有条目使用这个标签
            </div>

            <div v-if="viewMovies.length" class="view-grid">
              <PosterCard
                v-for="m in viewMovies"
                :key="m.id"
                :movie="m"
                @open="openDetail('movie', $event)"
              />
            </div>
            <div v-if="viewBooks.length" class="view-grid">
              <CoverCard
                v-for="b in viewBooks"
                :key="b.id"
                :title="b.title"
                :cover-path="b.coverPath"
                :rating="b.rating"
                :status-label="BOOK_STATUS_LABELS[b.status]"
                :date="b.publishDate"
                @open="openDetail('book', b.id)"
              />
            </div>
            <div v-if="viewGames.length" class="view-grid">
              <CoverCard
                v-for="g in viewGames"
                :key="g.id"
                :title="g.title"
                :cover-path="g.coverPath"
                :rating="g.rating"
                :status-label="GAME_STATUS_LABELS[g.status]"
                :date="g.releaseDate"
                @open="openDetail('game', g.id)"
              />
            </div>
            <div v-if="viewNotes.length" class="note-list">
              <div v-for="n in viewNotes" :key="n.id" class="note-row">
                <div class="note-title">{{ n.title || '无标题笔记' }}</div>
                <div class="note-preview">{{ notePreview(n) }}</div>
              </div>
            </div>
          </NSpin>
        </div>
      </NModal>

      <MovieDetailModal
        v-if="detailKind === 'movie'"
        v-model:show="detailShow"
        :id="detailId"
      />
      <BookDetailModal
        v-else-if="detailKind === 'book'"
        v-model:show="detailShow"
        :id="detailId"
      />
      <GameDetailModal
        v-else-if="detailKind === 'game'"
        v-model:show="detailShow"
        :id="detailId"
      />
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
  margin-bottom: 14px;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2329;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.tab {
  font-size: 12.5px;
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid #e6e8ee;
  background: rgba(255, 255, 255, 0.7);
  color: #555;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease);
}
.tab:hover {
  border-color: var(--accent);
}
.tab.on {
  background: color-mix(in srgb, var(--accent) 12%, #fff);
  border-color: color-mix(in srgb, var(--accent) 40%, #fff);
  color: var(--accent);
  font-weight: 600;
}
.toolbar-ops {
  display: flex;
  align-items: center;
  gap: 8px;
}
.list {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  transition: background 0.12s ease;
}
.list.root-over {
  background: #f2f6ff;
  outline: 2px dashed #9ab8f5;
  outline-offset: 2px;
}
.load-more {
  padding: 16px 0 8px;
  text-align: center;
  font-size: 12.5px;
  color: #a8adb8;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 8px;
  border-bottom: 1px solid #f2f3f6;
  cursor: grab;
  user-select: none;
}
.row.dragging {
  opacity: 0.4;
}
/* 拖拽落点指示线：上 30% → 插前面；下 28% → 插后面；中间 → 成为子标签 */
.row.drop-before::before,
.row.drop-after::before {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: #3468f6;
  border-radius: 2px;
  pointer-events: none;
}
.row.drop-before::before {
  top: -1px;
}
.row.drop-after::before {
  bottom: -1px;
}
.row.drop-into {
  background: #eaf2ff;
  border-radius: 6px;
}
/* 折叠三角 */
.caret {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: #8a909c;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  cursor: pointer;
  transform: rotate(0deg);
  transition: transform 0.12s ease;
}
.caret.open {
  transform: rotate(90deg);
}
.caret-placeholder {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
}
.name {
  font-size: 13.5px;
  color: #1f2329;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name.hidden {
  color: #a8adb8;
}
.name-btn {
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name-btn:hover {
  color: var(--accent);
  text-decoration: underline;
}
.count {
  font-size: 11.5px;
  color: #a8adb8;
}
.count-btn {
  padding: 2px 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.count-btn:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, #fff);
}
.view-card {
  width: 780px;
  max-width: 94vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--fluent-card);
  backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid var(--fluent-stroke);
  border-radius: 14px;
  box-shadow: var(--fluent-shadow);
  padding: 20px 22px;
}
.view-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.view-head h3 {
  font-size: 16px;
  color: #1f2329;
}
.view-type {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--accent);
  margin-left: 8px;
}
.view-empty {
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: #a8adb8;
}
.view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.view-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 14px 10px;
  align-content: start;
}
.view-grid + .view-grid {
  margin-top: 18px;
}
.note-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note-row {
  padding: 10px 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
}
.note-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
  margin-bottom: 3px;
}
.note-preview {
  font-size: 12.5px;
  color: #8a909c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ops {
  margin-left: auto;
  display: flex;
  gap: 2px;
}
.empty {
  margin-top: 60px;
}
.dlg-card {
  width: 400px;
  max-width: 92vw;
  background: var(--fluent-card);
  backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid var(--fluent-stroke);
  border-radius: 14px;
  box-shadow: var(--fluent-shadow);
  padding: 22px 24px;
}
.dlg-card h3 {
  font-size: 16px;
  margin-bottom: 16px;
  color: #1f2329;
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.del-card {
  width: 440px;
  max-width: 92vw;
  background: var(--fluent-card);
  backdrop-filter: blur(32px) saturate(1.4);
  border: 1px solid var(--fluent-stroke);
  border-radius: 14px;
  box-shadow: var(--fluent-shadow);
  padding: 22px 24px;
}
.del-card h3 {
  font-size: 16px;
  margin-bottom: 16px;
  color: #1f2329;
}
.modes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.merge-select {
  margin-top: 12px;
}
.del-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
