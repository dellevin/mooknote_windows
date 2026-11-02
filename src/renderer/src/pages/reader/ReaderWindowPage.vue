<script setup lang="ts">
// 电子书阅读独立窗口：书架视图。
// 打开书时由主进程把整个窗口切换到 foliate-js 阅读页（reader.html），
// 返回书架时再切回本页，因此本页不内嵌阅读 iframe。
import { onMounted, ref } from 'vue'
import type { ReaderBook } from '@shared/types'

const books = ref<ReaderBook[]>([])
const loading = ref(false)
const importing = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
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
  const ok = await window.mook.reader.openBook(book.id)
  if (!ok) showToast('书籍文件不存在')
}

async function removeBook(book: ReaderBook): Promise<void> {
  if (!window.confirm(`确定从书架移除《${book.title}》吗？书库文件也会被删除。`)) return
  await window.mook.reader.delete(book.id)
  await loadBooks()
}

async function changeCover(book: ReaderBook): Promise<void> {
  const updated = await window.mook.reader.pickCover(book.id)
  if (updated) {
    await loadBooks()
    showToast('封面已更新')
  }
}

// 无封面时生成占位图（纸色渐变 + 书名首字）
function placeholderCover(title: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 420
  const ctx = canvas.getContext('2d')!
  const hue = [...title].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 360
  const grad = ctx.createLinearGradient(0, 0, 300, 420)
  grad.addColorStop(0, `hsl(${hue}, 28%, 78%)`)
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 24%, 66%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 300, 420)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = 'bold 120px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText([...title][0] ?? '书', 150, 190)
  ctx.font = '600 26px serif'
  const name = title.length > 10 ? title.slice(0, 10) + '…' : title
  ctx.fillText(name, 150, 340)
  return canvas.toDataURL('image/png')
}

onMounted(loadBooks)
</script>

<template>
  <div class="reader-win">
    <!-- 书架视图（打开书时窗口整页切换到 foliate-js reader.html） -->
    <div class="shelf">
      <div class="shelf-head">
        <div class="sh-title">
          <span class="sh-logo">📖</span>
          我的书架
          <span class="sh-count" v-if="books.length">{{ books.length }}</span>
        </div>
        <button class="btn-primary" :disabled="importing" @click="importBooks">
          {{ importing ? '正在导入…' : '＋ 导入电子书' }}
        </button>
      </div>

      <div v-if="loading" class="hint">加载中…</div>
      <div v-else-if="!books.length" class="empty">
        <div class="empty-ico">📚</div>
        <div class="empty-t1">书架还是空的</div>
        <div class="empty-t2">支持 EPUB / PDF / MOBI / AZW3 / FB2 / CBZ / TXT（TXT 导入时自动转换）</div>
        <button class="btn-primary big" @click="importBooks">导入第一本书</button>
      </div>

      <div v-else class="grid">
        <div v-for="book in books" :key="book.id" class="book-card">
          <div class="cover-wrap" @click="openBook(book)">
            <img class="cover" :src="book.coverPath ?? placeholderCover(book.title)" draggable="false" />
            <span v-if="book.percentage > 0" class="badge">
              {{ book.percentage >= 1 ? '已读完' : Math.round(book.percentage * 100) + '%' }}
            </span>
            <div class="cover-mask">
              <span class="mask-btn">阅读</span>
            </div>
          </div>
          <div class="bk-meta">
            <div class="bk-title" :title="book.title">{{ book.title }}</div>
            <div class="bk-author">{{ book.author || '未知作者' }}</div>
          </div>
          <div class="bk-actions">
            <button class="mini" title="更换封面" @click="changeCover(book)">封面</button>
            <button class="mini danger" title="移除" @click="removeBook(book)">移除</button>
          </div>
        </div>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
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
}

/* ---- 书架 ---- */
.shelf {
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
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sh-logo { font-size: 24px; }
.sh-count {
  font-size: 13px;
  font-weight: 500;
  background: rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  padding: 1px 9px;
}
.btn-primary {
  padding: 9px 20px;
  border: none;
  border-radius: 10px;
  background: #4a6fa5;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #3d5e8f; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.btn-primary.big { margin-top: 18px; padding: 11px 28px; font-size: 15px; }

.empty {
  margin-top: 12vh;
  text-align: center;
  color: #7a7669;
}
.empty-ico { font-size: 56px; margin-bottom: 14px; }
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
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  background: #c9c2b2;
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
  background: rgba(0, 0, 0, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.cover-wrap:hover .cover-mask { opacity: 1; }
.mask-btn {
  color: #fff;
  font-size: 14px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 18px;
  padding: 5px 18px;
}
.badge {
  position: absolute;
  right: 6px;
  top: 6px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  border-radius: 8px;
  padding: 2px 8px;
}
.bk-meta {
  margin-top: 10px;
}
.bk-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
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
.bk-actions {
  margin-top: 6px;
  display: flex;
  gap: 8px;
}
.mini {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  background: transparent;
  color: #5a5e66;
  font-family: inherit;
  cursor: pointer;
}
.mini:hover { background: rgba(0, 0, 0, 0.06); }
.mini.danger:hover { color: #c0392b; border-color: #c0392b; }

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
