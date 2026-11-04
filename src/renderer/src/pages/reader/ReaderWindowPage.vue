<script setup lang="ts">
// 电子书阅读独立窗口：书架视图。
// 打开书时由主进程把整个窗口切换到 foliate-js 阅读页（reader.html），
// 返回书架时再切回本页，因此本页不内嵌阅读 iframe。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ReaderBook, ReaderCategory } from '@shared/types'

// meta.bare=true 为独立阅读窗口；/reader-embed 无 bare，内嵌在主窗口工具栏内容区
const route = useRoute()
const embedded = computed(() => route.meta.bare !== true)

// 内嵌模式点书：在本页 iframe 覆盖层里承载 foliate 阅读页（独立窗模式不用）
const readingUrl = ref('')
function onReaderMessage(e: MessageEvent): void {
  if (e.data && typeof e.data === 'object' && e.data.type === 'mook-reader-back') {
    readingUrl.value = ''
  }
}

const books = ref<ReaderBook[]>([])
const categories = ref<ReaderCategory[]>([])
const loading = ref(false)
const importing = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

// 当前选中的侧栏分类：all / uncat / 分类 id
const activeCat = ref<'all' | 'uncat' | string>('all')

// 侧栏计数（未分类单独统计）
const uncategorizedCount = computed(
  () => books.value.filter((b: ReaderBook) => !b.categoryIds.length).length
)

// 侧栏只显示未隐藏分类；隐藏的收进底部「已隐藏」折叠区
const visibleCategories = computed(() =>
  categories.value.filter((c: ReaderCategory) => !c.hidden)
)
const hiddenCategories = computed(() =>
  categories.value.filter((c: ReaderCategory) => c.hidden)
)
const hiddenExpanded = ref(false)

// 侧栏分类搜索（可见+已隐藏一起匹配）
const catKeyword = ref('')
const matchingCategories = computed(() => {
  const kw = catKeyword.value.trim().toLowerCase()
  if (!kw) return []
  return categories.value.filter((c: ReaderCategory) => c.name.toLowerCase().includes(kw))
})

// 拖拽排序（仅可见分类之间）
const dragCatId = ref<string | null>(null)
const dropTarget = ref<{ id: string; before: boolean } | null>(null)
function onCatDragStart(e: DragEvent, cat: ReaderCategory): void {
  dragCatId.value = cat.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', cat.id)
  }
}
function onCatDragOver(e: DragEvent, cat: ReaderCategory): void {
  if (!dragCatId.value || dragCatId.value === cat.id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id: cat.id, before: e.clientY < rect.top + rect.height / 2 }
}
function onCatDragEnd(): void {
  dragCatId.value = null
  dropTarget.value = null
}
async function onCatDrop(e: DragEvent, cat: ReaderCategory): Promise<void> {
  e.preventDefault()
  const dragId = dragCatId.value
  const target = dropTarget.value
  dragCatId.value = null
  dropTarget.value = null
  if (!dragId || !target || dragId === cat.id) return
  const ids = visibleCategories.value
    .map((c: ReaderCategory) => c.id)
    .filter((id: string) => id !== dragId)
  const targetIndex = ids.indexOf(target.id)
  const insertAt = target.before ? targetIndex : targetIndex + 1
  ids.splice(insertAt, 0, dragId)
  // 乐观更新：立即按新顺序排 categories，再落库
  const order = new Map<string, number>(ids.map((id: string, i: number) => [id, i]))
  categories.value = [...categories.value].sort((a, b) => {
    const av = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bv = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return av - bv
  })
  try {
    await window.mook.reader.reorderCategories([...ids])
  } catch {
    await loadCategories()
  }
}

// 侧栏折叠状态（记忆到 localStorage）
const sidebarCollapsed = ref(localStorage.getItem('reader.sidebarCollapsed') === '1')
function toggleSidebar(collapsed: boolean): void {
  sidebarCollapsed.value = collapsed
  railCatMenuOpen.value = false
  localStorage.setItem('reader.sidebarCollapsed', collapsed ? '1' : '0')
}

// 按分类 + 书名/作者实时过滤
const keyword = ref('')
const filteredBooks = computed(() => {
  let list = books.value
  if (activeCat.value === 'uncat') {
    list = list.filter((b: ReaderBook) => !b.categoryIds.length)
  } else if (activeCat.value !== 'all') {
    const cid = activeCat.value
    list = list.filter((b: ReaderBook) => b.categoryIds.includes(cid))
  }
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(
    (b: ReaderBook) =>
      b.title.toLowerCase().includes(kw) ||
      (b.author ?? '').toLowerCase().includes(kw)
  )
})

// 修改书名 / 作者
const editingBook = ref<ReaderBook | null>(null)
const draftTitle = ref('')
const draftAuthor = ref('')
const draftCover = ref<string | null>(null)
const savingMeta = ref(false)
const titleEl = ref<HTMLTextAreaElement | null>(null)
// 编辑弹窗里该书被勾选的分类 id；新建分类的输入
const draftCatIds = ref<string[]>([])
const newCatName = ref('')
// 书名 textarea 随内容自动增高，长书名换行显示而不是横向滚动
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}
function onTitleInput(e: Event): void {
  autoGrow(e.target as HTMLTextAreaElement)
}
function openEdit(book: ReaderBook): void {
  editingBook.value = book
  draftTitle.value = book.title
  draftAuthor.value = book.author ?? ''
  draftCover.value = book.coverPath ?? null
  draftCatIds.value = [...book.categoryIds]
  newCatName.value = ''
  void nextTick(() => {
    autoGrow(titleEl.value)
    titleEl.value?.focus()
    const len = titleEl.value?.value.length ?? 0
    titleEl.value?.setSelectionRange(len, len)
  })
}
function toggleCat(id: string): void {
  const i = draftCatIds.value.indexOf(id)
  if (i >= 0) draftCatIds.value.splice(i, 1)
  else draftCatIds.value.push(id)
}
async function createAndPickCat(): Promise<void> {
  const name = newCatName.value.trim()
  if (!name) return
  const res = await window.mook.reader.addCategory(name)
  if (res.ok && res.category) {
    categories.value.push(res.category)
    draftCatIds.value.push(res.category.id)
    newCatName.value = ''
  } else {
    showToast(res.error?.includes('UNIQUE') ? '分类已存在' : '新建失败')
  }
}
function closeEdit(): void {
  if (savingMeta.value) return
  editingBook.value = null
}
async function saveEdit(): Promise<void> {
  const book = editingBook.value
  const title = draftTitle.value.trim()
  if (!book || !title || savingMeta.value) return
  savingMeta.value = true
  try {
    const updated = await window.mook.reader.rename(book.id, title, draftAuthor.value.trim())
    if (!updated) {
      showToast('保存失败：未找到该书')
      return
    }
    await window.mook.reader.setBookCategories(book.id, [...draftCatIds.value])
    await Promise.all([loadBooks(), loadCategories()])
    editingBook.value = null
    showToast('书籍信息已更新')
  } catch (err) {
    showToast('保存失败：' + String(err))
  } finally {
    savingMeta.value = false
  }
}

// ---- 侧栏分类管理：新建/编辑统一用居中弹窗 ----
const catDialogVisible = ref(false)
const catDialogMode = ref<'create' | 'edit'>('create')
const catDialogId = ref<string | null>(null)
const catDialogName = ref('')
const catDialogHidden = ref(false)
const catDialogOrder = ref<number>(1)
const catSaving = ref(false)
const catDialogEl = ref<HTMLInputElement | null>(null)

async function loadCategories(): Promise<void> {
  categories.value = await window.mook.reader.listCategories()
}
function startCreateCat(): void {
  catDialogMode.value = 'create'
  catDialogId.value = null
  catDialogName.value = ''
  catDialogHidden.value = false
  catDialogOrder.value = visibleCategories.value.length + 1
  catDialogVisible.value = true
  void nextTick(() => catDialogEl.value?.focus())
}
function openCatDialog(cat: ReaderCategory): void {
  catDialogMode.value = 'edit'
  catDialogId.value = cat.id
  catDialogName.value = cat.name
  catDialogHidden.value = cat.hidden
  catDialogOrder.value = visibleCategories.value.findIndex((c: ReaderCategory) => c.id === cat.id) + 1
  catDialogVisible.value = true
  void nextTick(() => {
    catDialogEl.value?.focus()
    catDialogEl.value?.select()
  })
}
function closeCatDialog(): void {
  if (catSaving.value) return
  catDialogVisible.value = false
  catDialogName.value = ''
  catDialogId.value = null
}
async function confirmCatDialog(): Promise<void> {
  const name = catDialogName.value.trim()
  if (!name || catSaving.value) return
  catSaving.value = true
  try {
    if (catDialogMode.value === 'create') {
      const res = await window.mook.reader.addCategory(name)
      if (res.ok && res.category) {
        await loadCategories()
        activeCat.value = res.category.id
        catDialogVisible.value = false
      } else {
        showToast(res.error?.includes('UNIQUE') ? '分类已存在' : '新建失败')
      }
    } else {
      const id = catDialogId.value
      if (!id) return
      const target = categories.value.find((c: ReaderCategory) => c.id === id)
      if (target && name !== target.name) {
        await window.mook.reader.renameCategory(id, name)
      }
      if (target && catDialogHidden.value !== target.hidden) {
        await window.mook.reader.setCategoryHidden(id, catDialogHidden.value)
        if (catDialogHidden.value && activeCat.value === id) activeCat.value = 'all'
      }
      // 保存后仍可见时，才按编号在可见分类中重排
      if (!catDialogHidden.value) {
        const ids = visibleCategories.value
          .map((c: ReaderCategory) => c.id)
          .filter((cid: string) => cid !== id)
        const raw = Number.isFinite(catDialogOrder.value) ? catDialogOrder.value : 1
        const pos = Math.min(Math.max(Math.trunc(raw), 1), ids.length + 1) - 1
        ids.splice(pos, 0, id)
        await window.mook.reader.reorderCategories([...ids])
      }
      await loadCategories()
      catDialogVisible.value = false
    }
    catDialogName.value = ''
    catDialogId.value = null
  } catch (err) {
    showToast('保存失败：' + String(err))
  } finally {
    catSaving.value = false
  }
}
async function deleteSidebarCategory(cat: ReaderCategory): Promise<void> {
  const ok = await askConfirm(
    `删除分类「${cat.name}」`,
    '分类下的书籍不会被删除，会变为「未分类」。此操作不可撤销。'
  )
  if (!ok) return
  await window.mook.reader.deleteCategory(cat.id)
  if (activeCat.value === cat.id) activeCat.value = 'all'
  await Promise.all([loadBooks(), loadCategories()])
}
// 编辑弹窗内删除：关掉弹窗后复用侧栏删除（含确认）
async function deleteCatInDialog(): Promise<void> {
  const cat = categories.value.find((c: ReaderCategory) => c.id === catDialogId.value)
  catDialogVisible.value = false
  if (cat) await deleteSidebarCategory(cat)
}

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

// ---- 苹果风确认弹窗（替代 window.confirm） ----
interface ConfirmState {
  title: string
  message: string
  confirmText: string
  resolve: (ok: boolean) => void
}
const confirmDlg = ref<ConfirmState | null>(null)
function askConfirm(title: string, message: string, confirmText = '删除'): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDlg.value = { title, message, confirmText, resolve }
  })
}
function resolveConfirm(ok: boolean): void {
  const r = confirmDlg.value?.resolve
  confirmDlg.value = null
  r?.(ok)
}

// 单按钮结果提示弹窗（成功/失败，需手动关闭）
const alertDlg = ref<{ title: string; message: string; danger: boolean } | null>(null)
function showAlert(title: string, message: string, danger = false): void {
  alertDlg.value = { title, message, danger }
}

async function loadBooks(): Promise<void> {
  loading.value = true
  try {
    books.value = await window.mook.reader.list()
  } finally {
    loading.value = false
  }
}

async function importBooks(): Promise<void> {
  if (importing.value) return
  importing.value = true
  try {
    const res = await window.mook.reader.import()
    if (res.imported > 0) {
      showToast(`成功导入 ${res.imported} 本`)
      await loadBooks()
    }
    if (res.failed.length) showToast(res.failed[0] ?? '部分文件导入失败')
    if (!res.imported && !res.failed.length) showToast('已取消')
  } finally {
    importing.value = false
  }
}

async function openBook(book: ReaderBook): Promise<void> {
  if (embedded.value) {
    const base = await window.mook.reader.bookUrl(book.id)
    if (!base) {
      showToast('书籍文件不存在')
      return
    }
    readingUrl.value = `${base}&embedded=true`
    return
  }
  const ok = await window.mook.reader.openBook(book.id)
  if (!ok) showToast('书籍文件不存在')
}

const backupMenuOpen = ref(false)
const backingUp = ref(false)
function closeBackupMenu(): void {
  backupMenuOpen.value = false
}

// 收起态：点书本图标弹出的分类浮层
const railCatMenuOpen = ref(false)
function pickRailCat(id: string): void {
  activeCat.value = id
  railCatMenuOpen.value = false
}

// 书架展示形式：封面网格 / 列表
const viewMode = ref<'grid' | 'list'>(
  localStorage.getItem('reader.viewMode') === 'list' ? 'list' : 'grid'
)
function setViewMode(m: 'grid' | 'list'): void {
  viewMode.value = m
  localStorage.setItem('reader.viewMode', m)
}
function catNamesOf(book: ReaderBook): string {
  return book.categoryIds
    .map((id: string) => categories.value.find((c: ReaderCategory) => c.id === id)?.name)
    .filter(Boolean)
    .join('、')
}
async function exportBackup(): Promise<void> {
  closeBackupMenu()
  if (backingUp.value) return
  backingUp.value = true
  try {
    const res = await window.mook.reader.exportBackup()
    if (res.ok) {
      showAlert('导出成功', '书库备份已导出，可将该文件拷贝到其他设备用于迁移恢复。')
    } else if (res.error) {
      showAlert('导出失败', res.error, true)
    }
  } catch (err) {
    showAlert('导出失败', String(err), true)
  } finally {
    backingUp.value = false
  }
}
async function restoreBackup(): Promise<void> {
  closeBackupMenu()
  if (backingUp.value) return
  const ok = await askConfirm(
    '导入书库备份',
    '将用备份中的数据库、电子书和封面覆盖当前书库，现有内容会被替换，此操作不可撤销。',
    '恢复'
  )
  if (!ok) return
  backingUp.value = true
  try {
    const res = await window.mook.reader.importBackup()
    if (res.ok) {
      keyword.value = ''
      catKeyword.value = ''
      activeCat.value = 'all'
      await Promise.all([loadBooks(), loadCategories()])
      showAlert('恢复成功', `书库已从备份恢复，共 ${res.books ?? 0} 本书籍。`)
    } else if (res.error) {
      showAlert('恢复失败', res.error, true)
    }
  } catch (err) {
    showAlert('恢复失败', String(err), true)
  } finally {
    backingUp.value = false
  }
}

async function removeBook(book: ReaderBook): Promise<void> {
  const ok = await askConfirm(
    `删除《${book.title}》`,
    '将同时从书库删除对应的电子书文件，此操作不可撤销。'
  )
  if (!ok) return
  await window.mook.reader.delete(book.id)
  await Promise.all([loadBooks(), loadCategories()])
}

// 编辑弹窗内点封面换图：不关闭弹窗，只刷新封面与书库列表
async function changeCoverInEdit(): Promise<void> {
  const book = editingBook.value
  if (!book || savingMeta.value) return
  const updated = await window.mook.reader.pickCover(book.id)
  if (updated) {
    draftCover.value = updated.coverPath ?? null
    await loadBooks()
    showToast('封面已更新')
  }
}

// 无封面时生成占位图：纸黄主题下的低饱和暖灰封面，居中排书名，无高饱和彩色
const PLACEHOLDER_PALETTE: ReadonlyArray<readonly [string, string, string]> = [
  ['#d8d2c2', '#c4bca6', '#5c574a'], // 米灰
  ['#cfc8b8', '#b8afa0', '#575246'], // 暖灰
  ['#d6ccbe', '#bfb2a2', '#5d5448'], // 浅褐
  ['#ccc9c0', '#b2aea2', '#54524a'], // 灰绿
  ['#d2c9c4', '#bcb0aa', '#5b524e'] // 藕灰
]

function placeholderCover(title: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 420
  const ctx = canvas.getContext('2d')!
  const idx = [...title].reduce((s, ch) => s + ch.charCodeAt(0), 0) % PLACEHOLDER_PALETTE.length
  const [c1, c2, ink] = PLACEHOLDER_PALETTE[idx]!

  const grad = ctx.createLinearGradient(0, 0, 300, 420)
  grad.addColorStop(0, c1)
  grad.addColorStop(1, c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 300, 420)

  // 顶部一道细书脊线，增加书本感
  ctx.fillStyle = 'rgba(0, 0, 0, 0.07)'
  ctx.fillRect(20, 56, 2, 308)

  // 居中竖排区域内按行排书名（最多两行）
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const chars = [...title]
  const lines: string[] = []
  if (chars.length <= 6) {
    lines.push(title)
  } else {
    lines.push(chars.slice(0, 6).join(''))
    lines.push((chars.slice(6, 11).join('')) + (chars.length > 11 ? '…' : ''))
  }
  ctx.font = '500 34px "Songti SC", "SimSun", serif'
  const lh = 48
  const startY = 210 - ((lines.length - 1) * lh) / 2
  lines.forEach((line, i) => ctx.fillText(line, 158, startY + i * lh))

  // 底部作者位留给默认“未知作者”，封面不再放大字首字符
  return canvas.toDataURL('image/png')
}

// 自绘标题栏窗口控件
const isMaximized = ref(false)
function winMinimize(): void {
  window.mook.window.minimize()
}
function winToggleMax(): void {
  window.mook.window.toggleMaximize()
}
function winClose(): void {
  window.mook.window.close()
}

onMounted(() => {
  void loadBooks()
  void loadCategories()
  window.addEventListener('message', onReaderMessage)
  if (!embedded.value) {
    window.mook.window.onMaximizedChange((v: boolean) => (isMaximized.value = v))
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onReaderMessage)
})
</script>

<template>
  <div class="reader-win" :class="{ embedded }">
    <!-- 自绘标题栏：仅独立无边框窗口需要；内嵌在主窗口时隐藏 -->
    <div v-if="!embedded" class="reader-titlebar">
      <div class="rt-drag"></div>
      <div class="rt-controls">
        <button class="rt-btn" title="最小化" @click="winMinimize">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
          </svg>
        </button>
        <button class="rt-btn" title="最大化/还原" @click="winToggleMax">
          <svg v-if="!isMaximized" viewBox="0 0 12 12" width="12" height="12">
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none"
              stroke="currentColor" stroke-width="1" />
          </svg>
          <svg v-else viewBox="0 0 12 12" width="12" height="12">
            <rect x="3.5" y="2" width="6.5" height="6.5" rx="1" fill="none"
              stroke="currentColor" stroke-width="1" />
            <path d="M5 2.5V4H2.5v5.5H7V8" fill="none" stroke="currentColor"
              stroke-width="1" stroke-linejoin="round" />
          </svg>
        </button>
        <button class="rt-btn rt-close" title="关闭" @click="winClose">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor"
              stroke-width="1.1" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
    <div class="shelf-layout">
    <!-- 左侧分类栏（可折叠成窄轨） -->
    <aside class="cat-side" :class="{ collapsed: sidebarCollapsed }">
      <!-- 折叠态：窄轨，只留展开按钮与书库入口 -->
      <template v-if="sidebarCollapsed">
        <button class="rail-btn" title="展开侧栏" @click="toggleSidebar(false)">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <div class="rail-book-wrap">
          <button class="rail-btn" title="书库" :class="{ on: railCatMenuOpen }"
            @click.stop="railCatMenuOpen = !railCatMenuOpen">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          </button>
          <div v-if="railCatMenuOpen" class="rail-pop">
            <button class="rp-item" :class="{ on: activeCat === 'all' }"
              @click="pickRailCat('all')">
              <span class="rp-name">书库</span>
              <span class="rp-count">{{ books.length }}</span>
            </button>
            <button class="rp-item" :class="{ on: activeCat === 'uncat' }"
              @click="pickRailCat('uncat')">
              <span class="rp-name">未分类</span>
              <span class="rp-count">{{ uncategorizedCount }}</span>
            </button>
            <div v-if="visibleCategories.length" class="rp-sep"></div>
            <div class="rp-scroll">
              <button v-for="cat in visibleCategories" :key="cat.id" class="rp-item"
                :class="{ on: activeCat === cat.id }" @click="pickRailCat(cat.id)">
                <span class="rp-name">{{ cat.name }}</span>
                <span class="rp-count">{{ cat.count }}</span>
              </button>
            </div>
          </div>
        </div>
        <button class="rail-btn rail-add" title="新建分类" @click="startCreateCat">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </template>

      <!-- 展开态 -->
      <template v-else>
        <button class="brand-collapse" title="折叠侧栏" @click="toggleSidebar(true)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button class="cat-item" :class="{ on: activeCat === 'all' }" @click="activeCat = 'all'">
          <span class="ci-name">书库</span>
          <span class="ci-count">{{ books.length }}</span>
        </button>
        <button class="cat-item" :class="{ on: activeCat === 'uncat' }" @click="activeCat = 'uncat'">
          <span class="ci-name">未分类</span>
          <span class="ci-count">{{ uncategorizedCount }}</span>
        </button>

        <div class="cat-search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input v-model="catKeyword" type="text" placeholder="搜索分类" />
        </div>

        <!-- 中间可滚动区：固定头/尾之外 -->
        <div class="cat-scroll">
          <template v-if="!catKeyword.trim()">
            <div v-if="visibleCategories.length" class="cat-sep"></div>
            <div v-for="cat in visibleCategories" :key="cat.id"
              class="cat-item-wrap"
              :class="{
                dragging: dragCatId === cat.id,
                'drop-before': dropTarget?.id === cat.id && dropTarget.before,
                'drop-after': dropTarget?.id === cat.id && !dropTarget.before
              }"
              draggable="true"
              @dragstart="onCatDragStart($event, cat)"
              @dragover="onCatDragOver($event, cat)"
              @drop="onCatDrop($event, cat)"
              @dragend="onCatDragEnd">
              <button class="cat-item" :class="{ on: activeCat === cat.id }" @click="activeCat = cat.id">
                <span class="ci-name">{{ cat.name }}</span>
                <span class="ci-count">{{ cat.count }}</span>
              </button>
              <span class="cat-ops">
                <button title="编辑分类" @click.stop="openCatDialog(cat)">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button title="删除分类" @click.stop="deleteSidebarCategory(cat)">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </span>
            </div>

            <!-- 已隐藏分类：折叠收纳，点编辑可重新显示 -->
            <div v-if="hiddenCategories.length" class="cat-hidden">
              <button class="cat-hidden-toggle" @click="hiddenExpanded = !hiddenExpanded">
                <svg class="cat-hidden-caret" :class="{ open: hiddenExpanded }" viewBox="0 0 24 24"
                  width="11" height="11" fill="none" stroke="currentColor"
                  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                已隐藏 ({{ hiddenCategories.length }})
              </button>
              <template v-if="hiddenExpanded">
                <div v-for="cat in hiddenCategories" :key="cat.id" class="cat-item-wrap dim">
                  <button class="cat-item" :class="{ on: activeCat === cat.id }" @click="activeCat = cat.id">
                    <span class="ci-name">{{ cat.name }}</span>
                    <span class="ci-count">{{ cat.count }}</span>
                  </button>
                  <span class="cat-ops">
                    <button title="编辑分类" @click.stop="openCatDialog(cat)">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button title="删除分类" @click.stop="deleteSidebarCategory(cat)">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </span>
                </div>
              </template>
            </div>
          </template>

          <!-- 搜索结果：可见 + 已隐藏一起匹配，隐藏的置灰 -->
          <template v-else>
            <div v-if="!matchingCategories.length" class="cat-empty">无匹配分类</div>
            <div v-for="cat in matchingCategories" :key="cat.id" class="cat-item-wrap" :class="{ dim: cat.hidden }">
              <button class="cat-item" :class="{ on: activeCat === cat.id }" @click="activeCat = cat.id">
                <span class="ci-name">{{ cat.name }}</span>
                <span class="ci-count">{{ cat.count }}</span>
              </button>
              <span class="cat-ops">
                <button title="编辑分类" @click.stop="openCatDialog(cat)">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button title="删除分类" @click.stop="deleteSidebarCategory(cat)">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </span>
            </div>
          </template>
        </div>

        <div class="cat-add-sep"></div>
        <button class="cat-add" @click="startCreateCat">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新建分类
        </button>
      </template>
    </aside>

    <!-- 书架视图（打开书时窗口整页切换到 foliate-js reader.html） -->
    <div class="shelf">
      <div class="shelf-head">
        <div class="sh-title">
          {{ activeCat === 'all' ? '书库' : activeCat === 'uncat' ? '未分类'
             : (categories.find((c) => c.id === activeCat)?.name ?? '书库') }}
          <span class="sh-count" v-if="books.length">{{ filteredBooks.length }}</span>
        </div>
        <div class="sh-actions">
          <div class="search-box">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input v-model="keyword" type="text" placeholder="搜索书名或作者" />
          </div>
          <div class="view-toggle" title="切换展示形式">
            <button :class="{ on: viewMode === 'grid' }" title="封面视图"
              @click="setViewMode('grid')">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.2" />
                <rect x="14" y="3" width="7" height="7" rx="1.2" />
                <rect x="3" y="14" width="7" height="7" rx="1.2" />
                <rect x="14" y="14" width="7" height="7" rx="1.2" />
              </svg>
            </button>
            <button :class="{ on: viewMode === 'list' }" title="列表视图"
              @click="setViewMode('list')">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3.5" y1="6" x2="3.51" y2="6" />
                <line x1="3.5" y1="12" x2="3.51" y2="12" />
                <line x1="3.5" y1="18" x2="3.51" y2="18" />
              </svg>
            </button>
          </div>
          <button class="btn-primary" :disabled="importing" @click="importBooks">
          <svg v-if="!importing" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span v-else class="spin">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </span>
          {{ importing ? '正在导入…' : '导入电子书' }}
        </button>

        <!-- 备份 / 恢复 -->
        <div class="backup-wrap">
          <button class="btn-icon" title="备份与恢复" :disabled="backingUp"
            @click.stop="backupMenuOpen = !backupMenuOpen">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
            </svg>
          </button>
          <div v-if="backupMenuOpen" class="backup-menu">
            <button @click="exportBackup">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              导出书库备份
            </button>
            <button @click="restoreBackup">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
              导入恢复备份
            </button>
          </div>
        </div>
        </div>
      </div>

      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="!books.length" class="empty">
        <div class="empty-ico">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 6.5C10.5 5.2 8.6 4.5 6.5 4.5c-1 0-1.9.15-2.5.4V18c.6-.25 1.5-.4 2.5-.4 2.1 0 4 .7 5.5 2 1.5-1.3 3.4-2 5.5-2 1 0 1.9.15 2.5.4v-13.1c-.6-.25-1.5-.4-2.5-.4-2.1 0-4 .7-5.5 2z" />
            <path d="M12 6.5V19.6" />
          </svg>
        </div>
        <div class="empty-t1">书库还是空的</div>
        <div class="empty-t2">支持 EPUB / PDF / MOBI / AZW3 / FB2 / CBZ / TXT（TXT 导入时自动转换）</div>
        <button class="btn-primary big" @click="importBooks">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          导入第一本书
        </button>
      </div>

      <div v-else-if="filteredBooks.length && viewMode === 'grid'" class="grid">
        <div v-for="book in filteredBooks" :key="book.id" class="book-card">
          <div class="cover-wrap" @click="openBook(book)">
            <img class="cover" :src="book.coverPath ?? placeholderCover(book.title)" draggable="false" />
            <span v-if="book.percentage > 0" class="badge">
              {{ book.percentage >= 1 ? '已读完' : Math.round(book.percentage * 100) + '%' }}
            </span>
            <div class="cover-mask">
              <div class="mask-tools">
                <button class="mask-icon" title="编辑书籍信息" @click.stop="openEdit(book)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button class="mask-icon danger" title="从书架移除" @click.stop="removeBook(book)">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" x2="10" y1="11" y2="17" />
                    <line x1="14" x2="14" y1="11" y2="17" />
                  </svg>
                </button>
              </div>
              <span class="mask-read">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
                </svg>
              </span>
            </div>
          </div>
          <div class="bk-meta" @dblclick="openEdit(book)" title="双击编辑">
            <div class="bk-title" :title="book.title">{{ book.title }}</div>
            <div class="bk-author">{{ book.author || '未知作者' }}</div>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else-if="filteredBooks.length && viewMode === 'list'" class="book-list">
        <div class="bl-row" v-for="book in filteredBooks" :key="book.id"
          @click="openBook(book)" :title="book.title">
          <img class="bl-cover" :src="book.coverPath ?? placeholderCover(book.title)"
            draggable="false" />
          <div class="bl-main">
            <div class="bl-title">{{ book.title }}</div>
            <div class="bl-sub">{{ book.author || '未知作者' }}</div>
          </div>
          <div class="bl-cats">{{ catNamesOf(book) || '未分类' }}</div>
          <div class="bl-progress">
            <template v-if="book.percentage >= 1">已读完</template>
            <template v-else-if="book.percentage > 0">{{ Math.round(book.percentage * 100) }}%</template>
            <template v-else>未开始</template>
          </div>
          <div class="bl-ops" @click.stop>
            <button title="编辑书籍信息" @click="openEdit(book)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button class="danger" title="从书架移除" @click="removeBook(book)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div v-else class="hint">
        {{ keyword ? `没有找到匹配「${keyword}」的书籍` : '这个分类下还没有书' }}
      </div>
    </div>
    </div>

    <!-- 编辑书名 / 作者（Apple Books 风格：顶部导航 + 分组卡片） -->
    <Transition name="sheet">
      <div v-if="editingBook" class="sheet-mask" @click.self="closeEdit">
        <div class="sheet book-sheet">
          <div class="sheet-nav">
            <button class="sheet-nav-btn" :disabled="savingMeta" @click="closeEdit">取消</button>
            <span class="sheet-nav-title">编辑书籍信息</span>
            <button class="sheet-nav-btn accent"
              :disabled="savingMeta || !draftTitle.trim()" @click="saveEdit">
              {{ savingMeta ? '保存中' : '完成' }}
            </button>
          </div>
          <div class="sheet-body book-edit-body">
            <div class="book-edit-left">
              <button type="button" class="book-edit-cover" title="点击更换封面"
                @click="changeCoverInEdit">
                <img :src="draftCover ?? placeholderCover(draftTitle || '书')" draggable="false" />
                <span class="cover-edit-hint">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  更换封面
                </span>
              </button>
            </div>
            <div class="book-edit-right">
            <div class="sheet-card">
              <label class="sheet-row multiline">
                <span class="sr-label">书名</span>
                <textarea ref="titleEl" v-model="draftTitle" rows="1" maxlength="300"
                  placeholder="输入书名"
                  @input="onTitleInput"></textarea>
              </label>
              <label class="sheet-row">
                <span class="sr-label">作者</span>
                <input v-model="draftAuthor" type="text" maxlength="200"
                  placeholder="未知作者" @keydown.enter.prevent="saveEdit" />
              </label>
            </div>

            <div class="sheet-card cat-edit-card">
              <div class="cat-edit-head">分类</div>
              <div class="cat-chips">
                <button v-for="cat in draftCatIds" :key="cat" type="button"
                  class="cat-chip on"
                  @click="toggleCat(cat)">
                  {{ categories.find((c) => c.id === cat)?.name ?? '分类' }}
                  <span class="chip-x">✕</span>
                </button>
                <span v-if="!draftCatIds.length" class="cat-edit-empty">未选择分类（将归入「未分类」）</span>
              </div>
              <div class="cat-pick">
                <button v-for="cat in categories" :key="cat.id" type="button"
                  class="cat-chip" :class="{ on: draftCatIds.includes(cat.id) }"
                  @click="toggleCat(cat.id)">
                  {{ cat.name }}
                </button>
              </div>
              <div class="cat-new-row">
                <input v-model="newCatName" type="text" maxlength="30"
                  placeholder="新建分类并选择"
                  @keydown.enter.prevent="createAndPickCat" />
                <button type="button" class="cat-new-btn"
                  :disabled="!newCatName.trim()" @click="createAndPickCat">添加</button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="sheet">
      <div v-if="catDialogVisible" class="sheet-mask" @click.self="closeCatDialog">
        <div class="sheet cat-dialog">
          <div class="sheet-nav">
            <button class="sheet-nav-btn" :disabled="catSaving" @click="closeCatDialog">取消</button>
            <span class="sheet-nav-title">{{ catDialogMode === 'create' ? '新建分类' : '编辑分类' }}</span>
            <button class="sheet-nav-btn accent"
              :disabled="catSaving || !catDialogName.trim()" @click="confirmCatDialog">
              {{ catSaving ? '保存中' : '完成' }}
            </button>
          </div>
          <div class="sheet-body cat-dialog-body">
            <div class="sheet-card">
              <label class="sheet-row">
                <span class="sr-label">名称</span>
                <input ref="catDialogEl" v-model="catDialogName" type="text" maxlength="30"
                  placeholder="输入分类名称"
                  @keydown.enter.prevent="confirmCatDialog"
                  @keydown.esc.prevent="closeCatDialog" />
              </label>
              <div v-if="catDialogMode === 'edit'" class="sheet-row">
                <span class="sr-label-wide">排序</span>
                <input v-model.number="catDialogOrder" type="number" min="1"
                  :max="visibleCategories.length" class="cat-order-input"
                  @keydown.enter.prevent="confirmCatDialog" />
              </div>
              <div v-if="catDialogMode === 'edit'" class="sheet-row">
                <span class="sr-label-wide">隐藏标签</span>
                <button type="button" class="switch" role="switch"
                  :class="{ on: catDialogHidden }" :aria-checked="catDialogHidden"
                  @click="catDialogHidden = !catDialogHidden">
                  <span class="track"></span>
                </button>
              </div>
            </div>
            <button v-if="catDialogMode === 'edit'" type="button"
              class="cat-dialog-delete" :disabled="catSaving" @click="deleteCatInDialog">
              删除分类
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="backupMenuOpen" class="pop-anchor" @click="closeBackupMenu"></div>
    <div v-if="railCatMenuOpen" class="pop-anchor" @click="railCatMenuOpen = false"></div>

    <Transition name="sheet">
      <div v-if="confirmDlg" class="confirm-mask" @click.self="resolveConfirm(false)">
        <div class="confirm-box" role="alertdialog" aria-modal="true">
          <div class="confirm-text">
            <div class="confirm-title">{{ confirmDlg.title }}</div>
            <div class="confirm-msg">{{ confirmDlg.message }}</div>
          </div>
          <div class="confirm-actions">
            <button class="confirm-btn" @click="resolveConfirm(false)">取消</button>
            <button class="confirm-btn danger" @click="resolveConfirm(true)">
              {{ confirmDlg.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="sheet">
      <div v-if="alertDlg" class="confirm-mask" @click.self="alertDlg = null">
        <div class="confirm-box" role="alertdialog" aria-modal="true">
          <div class="confirm-text">
            <div class="confirm-title" :class="{ danger: alertDlg.danger }">{{ alertDlg.title }}</div>
            <div class="confirm-msg">{{ alertDlg.message }}</div>
          </div>
          <div class="confirm-actions single">
            <button class="confirm-btn" :class="{ danger: alertDlg.danger }" @click="alertDlg = null">
              知道了
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <!-- 内嵌阅读层：foliate 阅读页在本地 iframe 中全屏覆盖书架 -->
    <iframe
      v-if="embedded && readingUrl"
      class="embed-reader"
      :src="readingUrl"
      title="阅读"
    ></iframe>
  </div>
</template>

<style scoped>
.reader-win {
  position: fixed;
  inset: 0;
  background: #ece7dc;
  color: #2b2f36;
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
  user-select: none;
  display: flex;
  flex-direction: column;
}

/* 内嵌在主窗口内容区：不固定到整窗，填满内容卡片；iframe 阅读层相对它定位 */
.reader-win.embedded {
  position: relative;
  inset: auto;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
}
.embed-reader {
  position: absolute;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  border: none;
  background: #f5f1e8;
}

/* ---- 自绘标题栏 ---- */
.reader-titlebar {
  flex: 0 0 36px;
  display: flex;
  align-items: stretch;
  background: #ece7dc;
}
.rt-drag {
  flex: 1;
  -webkit-app-region: drag;
}
.rt-controls {
  display: flex;
  -webkit-app-region: no-drag;
}
.rt-controls button {
  -webkit-app-region: no-drag;
}
.rt-btn {
  width: 46px;
  border: none;
  background: transparent;
  color: #5d584c;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.12s,
    color 0.12s;
}
.rt-btn:hover {
  background: rgba(60, 50, 30, 0.1);
  color: #2b2f36;
}
.rt-btn.rt-close:hover {
  background: #e81123;
  color: #fff;
}
.rt-btn.rt-close:active {
  background: #c40f1e;
}

/* ---- 左右布局：分类栏 + 书架 ---- */
.shelf-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  min-width: 0;
}
.cat-side {
  flex: 0 0 188px;
  box-sizing: border-box;
  padding: 18px 12px 14px;
  overflow: hidden;
  border-right: 1px solid rgba(60, 50, 30, 0.1);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: flex-basis 0.18s ease, padding 0.18s ease;
}
/* 中间分类列表区滚动，头（书库/搜索）和尾（新建）固定 */
.cat-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.cat-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 4px;
  padding: 6px 9px;
  border-radius: 8px;
  background: rgba(60, 50, 30, 0.07);
  color: #9a9484;
}
.cat-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  font-family: inherit;
  color: #3d3a30;
}
.cat-search input::placeholder { color: #aaa494; }
.cat-empty {
  padding: 12px 10px;
  font-size: 12.5px;
  color: #a8a18c;
}
.cat-side.collapsed {
  flex-basis: 52px;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.rail-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #8a8578;
  cursor: pointer;
}
.rail-btn:hover { background: rgba(60, 50, 30, 0.08); color: #3d3a30; }
.rail-btn.on { background: rgba(209, 98, 42, 0.14); color: #c25a26; }
.rail-add { margin-top: auto; }

/* 收起态分类浮层：fixed 避免被 aside 的 overflow:hidden 裁切 */
.rail-book-wrap { position: relative; }
.rail-pop {
  position: fixed;
  left: 56px;
  top: 88px;
  z-index: 500;
  width: 210px;
  max-height: min(60vh, 420px);
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 12px;
  background: rgba(255, 253, 248, 0.94);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  backdrop-filter: blur(24px) saturate(1.5);
  box-shadow: 0 10px 34px rgba(60, 45, 20, 0.22), 0 0 0 1px rgba(60, 50, 30, 0.08);
  animation: rp-in 0.16s ease;
}
@keyframes rp-in {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}
.rp-item {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: #3d3a30;
  cursor: pointer;
  text-align: left;
}
.rp-item:hover { background: rgba(60, 50, 30, 0.07); }
.rp-item.on { background: rgba(209, 98, 42, 0.14); color: #c25a26; font-weight: 600; }
.rp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-count {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: #a8a18c;
}
.rp-item.on .rp-count { color: #c25a26; }
.rp-sep {
  flex: 0 0 auto;
  height: 1px;
  margin: 5px 8px;
  background: rgba(60, 50, 30, 0.1);
}
.rp-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.brand-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: flex-end;
  width: 24px;
  height: 24px;
  margin-bottom: 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #b0aa98;
  cursor: pointer;
}
.brand-collapse:hover { background: rgba(60, 50, 30, 0.08); color: #5d584c; }
.cat-item-wrap { position: relative; }
/* 拖拽排序：整行可拖，放置位置用顶部/底部高亮线提示 */
.cat-item-wrap[draggable='true'] .cat-item { cursor: grab; }
.cat-item-wrap.dragging { opacity: 0.4; }
.cat-item-wrap.dragging .cat-item { cursor: grabbing; }
.cat-item-wrap.drop-before::before,
.cat-item-wrap.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent, #e8a33d);
  pointer-events: none;
  z-index: 2;
}
.cat-item-wrap.drop-before::before { top: -1px; }
.cat-item-wrap.drop-after::after { bottom: -1px; }
.cat-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 13.5px;
  font-family: inherit;
  color: #5d584c;
  cursor: pointer;
  text-align: left;
}
.cat-item:hover { background: rgba(60, 50, 30, 0.06); }
.cat-item.on {
  background: rgba(60, 50, 30, 0.1);
  color: #3d3a30;
  font-weight: 600;
}
.ci-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ci-count {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: #a8a18c;
}
.cat-item.on .ci-count { color: #8a8578; }
.cat-ops {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  gap: 2px;
}
.cat-item-wrap:hover .cat-ops { display: inline-flex; }
/* hover 操作按钮时隐藏计数，避免重叠 */
.cat-item-wrap:hover .ci-count { visibility: hidden; }
.cat-ops button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #6d675a;
  cursor: pointer;
}
.cat-ops button:hover { color: #2b2720; background: #fff; }
.cat-sep {
  height: 1px;
  margin: 8px 10px;
  background: rgba(60, 50, 30, 0.08);
}

/* ---- iOS 风确认弹窗 ---- */
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(35, 31, 22, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}
.confirm-box {
  width: 270px;
  max-width: 100%;
  background: rgba(248, 246, 241, 0.98);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 18px 48px rgba(40, 32, 18, 0.3);
}
.confirm-text {
  padding: 20px 18px 18px;
  text-align: center;
}
.confirm-title {
  font-size: 15px;
  font-weight: 600;
  color: #2b2720;
}
.confirm-msg {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #7c766a;
}
.confirm-actions {
  display: flex;
  border-top: 1px solid rgba(60, 50, 30, 0.12);
}
.confirm-btn {
  flex: 1;
  padding: 12px 0;
  border: none;
  background: transparent;
  font-size: 14.5px;
  font-family: inherit;
  color: #4a463c;
  cursor: pointer;
}
.confirm-btn + .confirm-btn {
  border-left: 1px solid rgba(60, 50, 30, 0.12);
}
.confirm-btn:hover { background: rgba(60, 50, 30, 0.05); }
.confirm-btn.danger { color: #d14b4b; font-weight: 600; }
.confirm-btn.danger:hover { background: rgba(209, 75, 75, 0.08); }
.confirm-title.danger { color: #d14b4b; }
.cat-add-sep {
  flex: 0 0 auto;
  height: 1px;
  margin: 6px 0 6px;
  background: rgba(60, 50, 30, 0.1);
}
.cat-add {
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: #8a8578;
  cursor: pointer;
}
.cat-add:hover { background: rgba(60, 50, 30, 0.06); color: #5d584c; }
/* 分类弹窗：Apple 分组列表风，删除做成独立白底卡片里的居中文本行 */
.cat-dialog { width: 380px; }
.cat-order-input {
  flex: 0 0 72px !important;
  text-align: center;
  padding: 5px 8px !important;
  border: 1px solid rgba(60, 50, 30, 0.2) !important;
  border-radius: 8px;
  background: #f6f4ee !important;
}
.cat-dialog-body { padding: 16px 16px 18px; }
.cat-dialog .sheet-row { cursor: default; }
.cat-dialog-delete {
  width: 100%;
  margin-top: 12px;
  padding: 13px 16px;
  border: none;
  border-radius: 12px;
  background: #fff;
  color: #d14b4b;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  text-align: center;
}
.cat-dialog-delete:hover { background: rgba(209, 75, 75, 0.08); }
.cat-dialog-delete:disabled { opacity: 0.5; cursor: default; }
.switch {
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 20px;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.switch .track {
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: rgba(240, 160, 32, 0.25);
  transition: background 0.15s;
}
.switch .track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #f0a020;
  transition: transform 0.15s, background 0.15s;
}
.switch.on .track { background: rgba(24, 160, 88, 0.25); }
.switch.on .track::after { transform: translateX(14px); background: #18a058; }
/* 已隐藏分类折叠区 */
.cat-hidden {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(60, 50, 30, 0.08);
}
.cat-hidden-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-family: inherit;
  color: #a09a8c;
  cursor: pointer;
}
.cat-hidden-toggle:hover { color: #6f6a5d; }
.cat-hidden-caret { transition: transform 0.15s ease; }
.cat-hidden-caret.open { transform: rotate(90deg); }
.cat-item-wrap.dim .cat-item { opacity: 0.6; }

/* ---- 书架 ---- */
.shelf {
  flex: 1;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 26px 32px;
  overflow-y: auto;
}
.shelf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.sh-title {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.5px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: #3d3a30;
}
.sh-count {
  font-size: 13px;
  font-weight: 500;
  color: #9b9583;
}
/* 封面 / 列表 视图切换（紧贴书库标题） */
.view-toggle {
  display: inline-flex;
  align-items: center;
  padding: 2.5px;
  gap: 2px;
  border-radius: 8px;
  background: rgba(60, 50, 30, 0.08);
}
.view-toggle button {
  width: 28px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8a8578;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.view-toggle button:hover { color: #3d3a30; }
.view-toggle button.on {
  background: #fff;
  color: #c25a26;
  box-shadow: 0 1px 3px rgba(60, 45, 20, 0.18);
}

/* ---- 列表视图 ---- */
.book-list {
  display: flex;
  flex-direction: column;
}
.bl-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1.6fr) minmax(0, 1fr) 72px 70px;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
}
.bl-row:hover { background: rgba(60, 50, 30, 0.06); }
.bl-cover {
  width: 40px;
  height: 56px;
  border-radius: 4px;
  object-fit: cover;
  box-shadow: 0 2px 6px rgba(60, 45, 20, 0.22);
}
.bl-main { min-width: 0; }
.bl-title {
  font-size: 14px;
  font-weight: 600;
  color: #3d3a30;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bl-sub {
  margin-top: 2px;
  font-size: 12.5px;
  color: #9b9583;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bl-cats {
  font-size: 12.5px;
  color: #8a8578;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bl-progress {
  font-size: 12.5px;
  color: #9b9583;
  text-align: right;
}
.bl-ops {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}
.bl-row:hover .bl-ops { opacity: 1; }
.bl-ops button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #6f6a5d;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.bl-ops button:hover { background: rgba(60, 50, 30, 0.1); color: #3d3a30; }
.bl-ops button.danger:hover { background: #e81123; color: #fff; }
.sh-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(60, 50, 30, 0.12);
  color: #8a8578;
  transition: background 0.15s, border-color 0.15s;
}
.search-box:focus-within {
  background: #fff;
  border-color: rgba(60, 50, 30, 0.3);
}
.search-box input {
  width: 170px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  font-family: inherit;
  color: #3d3a30;
}
.search-box input::placeholder { color: #a8a18c; }

/* 编辑书名 / 作者：Apple Books 风格居中弹窗 */
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(35, 31, 22, 0.3);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 32px;
}
.sheet {
  width: 460px;
  max-width: 100%;
  max-height: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #f2efe7;
  box-shadow: 0 18px 48px rgba(40, 32, 18, 0.28);
  display: flex;
  flex-direction: column;
}
.sheet-nav {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(60, 50, 30, 0.1);
}
.sheet-nav-btn {
  justify-self: start;
  border: none;
  background: transparent;
  font-size: 15px;
  font-family: inherit;
  color: #8a8578;
  cursor: pointer;
  padding: 4px 2px;
}
.sheet-nav-btn.accent {
  justify-self: end;
  color: #0a84ff;
  font-weight: 600;
}
.sheet-nav-btn:disabled { opacity: 0.4; cursor: default; }
.sheet-nav-title {
  font-size: 15px;
  font-weight: 600;
  color: #3d3a30;
}
.sheet-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px 32px;
}
.sheet-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
}
.sheet-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
}
.sheet-row + .sheet-row {
  box-shadow: inset 0 1px 0 rgba(60, 50, 30, 0.08);
}
.sheet-row.multiline {
  align-items: flex-start;
}
.sr-label {
  flex: 0 0 44px;
  font-size: 14px;
  color: #3d3a30;
  padding-top: 2px;
}
.sr-label-wide { flex: 1; font-size: 14px; color: #3d3a30; }
.sheet-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  font-family: inherit;
  color: #3d3a30;
  padding: 2px 0;
}
.sheet-row input::placeholder,
.sheet-row textarea::placeholder { color: #b3ad9e; }
.sheet-row textarea {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  color: #3d3a30;
  padding: 0;
  max-height: 160px;
  overflow-y: auto;
}
/* 编辑弹窗：分类分组 */
.cat-edit-card {
  margin-top: 14px;
  padding: 12px 16px;
}

/* 编辑书籍：左侧封面 + 右侧表单（grid 让左列高度由右列内容确定，
   再用 height:100% + aspect-ratio 推出封面宽度） */
.book-sheet { width: 750px; }
.book-sheet .sheet-body {
  min-height: 400px;
}
.book-edit-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
  min-height: 400px;
}
.book-edit-left {
  display: flex;
  min-height: 0;
}
.book-edit-right {
  min-width: 0;
}
.book-edit-cover {
  position: relative;
  display: block;
  height: 100%;
  aspect-ratio: 5 / 7;
  padding: 0;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #e4ddcd;
  box-shadow: 0 4px 14px rgba(60, 45, 20, 0.22);
}
.book-edit-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-edit-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  font-family: inherit;
  color: #fff;
  background: rgba(30, 26, 18, 0.46);
  opacity: 0;
  transition: opacity 0.15s;
}
.book-edit-cover:hover .cover-edit-hint { opacity: 1; }
.cat-edit-head {
  font-size: 12.5px;
  color: #8a8578;
  margin-bottom: 10px;
}
.cat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 10px;
}
.cat-edit-empty {
  font-size: 12.5px;
  color: #b3ad9e;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(60, 50, 30, 0.18);
  background: transparent;
  font-size: 12.5px;
  font-family: inherit;
  color: #5d584c;
  cursor: pointer;
  user-select: none;
}
.cat-chip:hover { background: rgba(60, 50, 30, 0.06); }
.cat-chip.on {
  background: rgba(58, 54, 44, 0.92);
  border-color: transparent;
  color: #f5f1e8;
}
.chip-x { font-size: 10px; opacity: 0.8; }
.cat-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid rgba(60, 50, 30, 0.08);
}
.cat-new-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.cat-new-row input {
  flex: 1;
  min-width: 0;
  padding: 8px 11px;
  border: 1px solid rgba(60, 50, 30, 0.18);
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-family: inherit;
  color: #3d3a30;
  outline: none;
}
.cat-new-row input:focus { border-color: rgba(60, 50, 30, 0.5); }
.cat-new-btn {
  padding: 0 16px;
  border-radius: 8px;
  border: none;
  background: rgba(58, 54, 44, 0.92);
  color: #f5f1e8;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.cat-new-btn:disabled { opacity: 0.45; cursor: default; }
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: scale(0.96);
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 17px;
  border: none;
  border-radius: 999px;
  background: rgba(58, 54, 44, 0.9);
  color: #f5f1e8;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: rgba(40, 37, 30, 0.95); }
.btn-primary:disabled { opacity: 0.55; cursor: default; }
.btn-primary.big { margin-top: 22px; padding: 10px 26px; font-size: 15px; }

/* 备份/恢复：图标按钮 + 下拉菜单 */
.backup-wrap { position: relative; }
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(60, 50, 30, 0.07);
  color: #5d584c;
  cursor: pointer;
}
.btn-icon:hover:not(:disabled) { background: rgba(60, 50, 30, 0.14); }
.btn-icon:disabled { opacity: 0.5; cursor: default; }
.backup-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 120;
  min-width: 168px;
  padding: 5px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(40, 32, 18, 0.2);
  display: flex;
  flex-direction: column;
}
.backup-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: #3d3a30;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.backup-menu button:hover { background: rgba(60, 50, 30, 0.07); }
/* 点菜单外任意处关闭 */
.pop-anchor {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: transparent;
}
.spin { display: inline-flex; animation: btn-spin 0.9s linear infinite; }
@keyframes btn-spin { to { transform: rotate(360deg); } }

.empty {
  margin-top: 12vh;
  text-align: center;
  color: #7a7669;
}
.empty-ico {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a8a18c;
}
.empty-t1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #4b4f57; }
.empty-t2 { font-size: 13px; margin-bottom: 8px; }
.hint { text-align: center; color: #8a8578; padding: 40px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 26px 22px;
}
.book-card {
  display: flex;
  flex-direction: column;
}
.cover-wrap {
  position: relative;
  aspect-ratio: 5 / 7;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(60, 50, 30, 0.12);
  cursor: pointer;
  background: #c9c2b2;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.book-card:hover .cover-wrap {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(60, 50, 30, 0.2);
}
.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-mask {
  position: absolute;
  inset: 0;
  background: rgba(35, 31, 22, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.cover-wrap:hover .cover-mask { opacity: 1; }
.mask-read {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  color: rgba(40, 36, 28, 0.92);
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  padding-left: 3px;
}
.mask-tools {
  position: absolute;
  bottom: 7px;
  right: 7px;
  display: flex;
  flex-direction: row;
  gap: 6px;
}
.mask-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: rgba(40, 36, 28, 0.78);
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.mask-icon:hover { background: #fff; color: #28241c; }
.mask-icon.danger:hover { color: #d14343; }
.badge {
  position: absolute;
  right: 6px;
  top: 6px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #3d3a30;
  border-radius: 999px;
  padding: 2px 9px;
}
.bk-meta {
  margin-top: 12px;
  padding: 0 2px;
}
.bk-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: #3d3a30;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bk-author {
  margin-top: 3px;
  font-size: 12px;
  color: #8a8578;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  padding: 9px 22px;
  border-radius: 9px;
  font-size: 13px;
  color: #fff;
  background: rgba(30, 32, 36, 0.9);
  pointer-events: none;
  max-width: 70%;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
</style>
