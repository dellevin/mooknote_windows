<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NModal,
  NTabs,
  NTabPane,
  NInput,
  NButton,
  NSpin,
  NEmpty,
  NTag,
  useMessage
} from 'naive-ui'
import TmdbPanel from '@/components/search/TmdbPanel.vue'
import BgmPanel from '@/components/search/BgmPanel.vue'
import { toImgUrl } from '@/utils/image'

const router = useRouter()
const message = useMessage()

const show = ref(false)
const tab = ref<'local' | 'vip' | 'tmdb' | 'bgm'>('local')

// ── 本地搜索：聚合 影视/书籍/游戏/笔记/人物 ──
interface LocalItem {
  kind: string
  to: string
  title: string
  sub: string
  cover: string
}

const localKeyword = ref('')
const localLoading = ref(false)
const localSearched = ref(false)
const localResults = ref<LocalItem[]>([])

async function searchLocal(): Promise<void> {
  const q = localKeyword.value.trim()
  if (!q) return
  localLoading.value = true
  localSearched.value = true
  try {
    const [movies, books, games, notes, people] = await Promise.all([
      window.mook.movie.list({ keyword: q }),
      window.mook.book.list({ keyword: q }),
      window.mook.game.list({ keyword: q }),
      window.mook.note.list({ keyword: q, limit: 20 }),
      window.mook.person.list(q)
    ])
    const items: LocalItem[] = []
    for (const m of movies) {
      if (m.isDeleted) continue
      items.push({
        kind: '影视',
        to: '/movies',
        title: m.title,
        sub: m.directors?.join('、') ?? '',
        cover: toImgUrl(m.posterPath)
      })
    }
    for (const b of books) {
      if (b.isDeleted) continue
      items.push({
        kind: '书籍',
        to: '/books',
        title: b.title,
        sub: b.authors?.join('、') ?? '',
        cover: toImgUrl(b.coverPath)
      })
    }
    for (const g of games) {
      if (g.isDeleted) continue
      items.push({
        kind: '游戏',
        to: '/games',
        title: g.title,
        sub: g.developer?.join('、') ?? '',
        cover: toImgUrl(g.coverPath)
      })
    }
    for (const n of notes) {
      if (n.isDeleted) continue
      items.push({
        kind: '笔记',
        to: '/notes',
        title: n.title || '无标题笔记',
        sub: n.content?.replace(/[#>*`\n]/g, ' ').slice(0, 60) ?? '',
        cover: ''
      })
    }
    for (const p of people) {
      if (p.isDeleted) continue
      items.push({
        kind: '人物',
        to: '/people',
        title: p.name,
        sub: p.occupation?.join('、') ?? '',
        cover: toImgUrl(p.photoPath)
      })
    }
    localResults.value = items.slice(0, 60)
  } catch (e) {
    message.error('本地搜索失败：' + String(e))
  } finally {
    localLoading.value = false
  }
}

function openLocal(it: LocalItem): void {
  show.value = false
  void router.push(it.to)
}

// ── 增强搜索：影视 / 书籍 ──
type VipItem = {
  id: string
  title: string
  cover: string
  subtitle: string
  extra: string
}
const vipKind = ref<'movie' | 'book'>('movie')
const vipKeyword = ref('')
const vipLoading = ref(false)
const vipSearched = ref(false)
const vipResults = ref<VipItem[]>([])
const vipPage = ref(1)
const vipTotalPages = ref(1)

async function searchVip(targetPage = 1): Promise<void> {
  const q = vipKeyword.value.trim()
  if (!q) return
  vipLoading.value = true
  vipSearched.value = true
  try {
    const r = await window.mook.search.vipSearch(vipKind.value, q, targetPage)
    vipResults.value = r.results
    vipPage.value = r.page
    vipTotalPages.value = r.totalPages
  } catch (e) {
    message.error('增强搜索失败：' + String(e))
  } finally {
    vipLoading.value = false
  }
}

function switchVipKind(k: 'movie' | 'book'): void {
  vipKind.value = k
  vipResults.value = []
  vipSearched.value = false
}

function reset(): void {
  localResults.value = []
  localSearched.value = false
  vipResults.value = []
  vipSearched.value = false
}
</script>

<template>
  <!-- 右下角悬浮搜索按钮：Teleport 到 body，与页面「添加」按钮同一定位参照（视口） -->
  <Teleport to="body">
    <button type="button" class="fab" title="搜索" @click="show = true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </Teleport>

  <NModal
    v-model:show="show"
    preset="card"
    title="搜索"
    :style="{ width: '880px', maxWidth: 'calc(100vw - 48px)' }"
    @after-leave="reset"
  >
    <NTabs v-model:value="tab" type="line" animated>
      <!-- 本地 -->
      <NTabPane name="local" tab="本地搜索">
        <div class="bar">
          <NInput
            v-model:value="localKeyword"
            size="small"
            clearable
            placeholder="搜索本地影视 / 书籍 / 游戏 / 笔记 / 人物"
            @keyup.enter="searchLocal"
          />
          <NButton size="small" type="primary" :loading="localLoading" @click="searchLocal">
            搜索
          </NButton>
        </div>
        <NSpin :show="localLoading">
          <NEmpty
            v-if="localSearched && !localResults.length && !localLoading"
            description="没有结果"
            class="empty"
          />
          <div v-if="localResults.length" class="local-list">
            <div
              v-for="(it, i) in localResults"
              :key="i"
              class="local-row"
              @click="openLocal(it)"
            >
              <div class="lr-cover">
                <img v-if="it.cover" :src="it.cover" />
                <span v-else>{{ it.title.slice(0, 1) }}</span>
              </div>
              <div class="lr-main">
                <div class="lr-title">{{ it.title }}</div>
                <div class="lr-sub">{{ it.sub }}</div>
              </div>
              <NTag size="small" :bordered="false">{{ it.kind }}</NTag>
            </div>
          </div>
        </NSpin>
      </NTabPane>

      <!-- 增强 -->
      <NTabPane name="vip" tab="增强搜索">
        <div class="bar">
          <div class="kind-toggle">
            <NButton
              size="small"
              :type="vipKind === 'movie' ? 'primary' : 'default'"
              @click="switchVipKind('movie')"
            >
              影视
            </NButton>
            <NButton
              size="small"
              :type="vipKind === 'book' ? 'primary' : 'default'"
              @click="switchVipKind('book')"
            >
              书籍
            </NButton>
          </div>
          <NInput
            v-model:value="vipKeyword"
            size="small"
            clearable
            class="vip-input"
            :placeholder="vipKind === 'movie' ? '搜索增强影视库（7w+ 数据）' : '搜索增强书籍库（300w+ 数据）'"
            @keyup.enter="searchVip(1)"
          />
          <NButton size="small" type="primary" :loading="vipLoading" @click="searchVip(1)">
            搜索
          </NButton>
        </div>
        <NSpin :show="vipLoading">
          <NEmpty
            v-if="vipSearched && !vipResults.length && !vipLoading"
            description="没有结果"
            class="empty"
          />
          <div v-if="vipResults.length" class="grid">
            <div v-for="r in vipResults" :key="r.id" class="v-card">
              <div class="poster">
                <img v-if="r.cover" :src="r.cover" referrerpolicy="no-referrer" />
                <div v-else class="fallback">🔍</div>
              </div>
              <div class="v-title" :title="r.title">{{ r.title }}</div>
              <div class="v-sub">{{ r.subtitle }}</div>
              <div v-if="r.extra" class="v-extra" :title="r.extra">{{ r.extra }}</div>
            </div>
          </div>
          <div v-if="vipTotalPages > 1" class="pager">
            <NButton size="tiny" :disabled="vipPage <= 1" @click="searchVip(vipPage - 1)">
              上一页
            </NButton>
            <span class="pg">{{ vipPage }} / {{ vipTotalPages }}</span>
            <NButton
              size="tiny"
              :disabled="vipPage >= vipTotalPages"
              @click="searchVip(vipPage + 1)"
            >
              下一页
            </NButton>
          </div>
        </NSpin>
      </NTabPane>

      <!-- TMDB -->
      <NTabPane name="tmdb" tab="TMDB搜索">
        <TmdbPanel />
      </NTabPane>

      <!-- Bangumi -->
      <NTabPane name="bgm" tab="Bangumi搜索">
        <BgmPanel />
      </NTabPane>
    </NTabs>
  </NModal>
</template>

<style scoped>
.fab {
  position: fixed;
  right: 30px;
  bottom: 26px;
  width: 58px;
  height: 58px;
  border-radius: 19px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #1f2329;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  z-index: 900;
  transition: transform 0.14s ease;
}
.fab:hover {
  background: #000;
  transform: translateY(-2px) scale(1.04);
}
.fab:active {
  transform: scale(0.95);
}
.bar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  align-items: center;
}
.kind-toggle {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.vip-input {
  flex: 1;
  min-width: 0;
}
.empty {
  margin: 50px 0;
}
.local-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 60vh;
  overflow-y: auto;
}
.local-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.local-row:hover {
  background: #f4f5f7;
}
.lr-cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  overflow: hidden;
  background: #eef0f4;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #9aa0ac;
  font-size: 16px;
}
.lr-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lr-main {
  flex: 1;
  min-width: 0;
}
.lr-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.lr-sub {
  font-size: 12px;
  color: #9aa0ac;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 14px;
  max-height: 60vh;
  overflow-y: auto;
}
.poster {
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #f2f3f7;
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: #c2c7d2;
}
.v-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.v-sub {
  font-size: 12px;
  color: #7a808a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.v-extra {
  font-size: 11px;
  color: #b0b5bd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}
.pg {
  font-size: 12.5px;
  color: #5b616c;
}
</style>
