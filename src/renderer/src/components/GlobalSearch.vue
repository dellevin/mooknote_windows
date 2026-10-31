<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NModal,
  NTabs,
  NTabPane,
  NInput,
  NButton,
  NEmpty,
  NTag,
  useMessage
} from 'naive-ui'
import TmdbPanel from '@/components/search/TmdbPanel.vue'
import BgmPanel from '@/components/search/BgmPanel.vue'
import { vipToMovie, vipToBook, normalizeTitle } from '@/components/search/importHelper'
import { MOVIE_STATUS_LABELS, BOOK_STATUS_LABELS } from '@shared/types'
import type { MovieInput, BookInput } from '@shared/types'
import MovieDetailModal from '@/components/MovieDetailModal.vue'
import BookDetailModal from '@/components/book/BookDetailModal.vue'
import GameDetailModal from '@/components/game/GameDetailModal.vue'
import PersonDetailModal from '@/components/people/PersonDetailModal.vue'
import { toImgUrl, remoteImg } from '@/utils/image'
import type { MediaKind } from '@shared/types'

const router = useRouter()
const message = useMessage()

const show = ref(false)
const tab = ref<'local' | 'vip' | 'tmdb' | 'bgm'>('local')
// 每次打开弹窗自增：用作 TMDB/Bangumi 子面板的 key，强制重新挂载、清空上次的搜索状态
const openSeq = ref(0)

// ── 本地搜索：聚合 影视/书籍/游戏/笔记/人物 ──
type LocalEntity = 'movie' | 'book' | 'game' | 'note' | 'person'
const KIND_LABEL: Record<LocalEntity, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏',
  note: '笔记',
  person: '人物'
}
interface LocalItem {
  entity: LocalEntity
  id: string
  to: string
  title: string
  sub: string
  cover: string
}

const TAG_TYPE: Record<
  LocalEntity,
  'default' | 'primary' | 'info' | 'success' | 'warning' | 'error'
> = {
  movie: 'info',
  book: 'success',
  game: 'warning',
  note: 'default',
  person: 'primary'
}

const localKeyword = ref('')
const localLoading = ref(false)
const localSearched = ref(false)
const localResults = ref<LocalItem[]>([])
let searchSeq = 0

async function searchLocal(): Promise<void> {
  const q = localKeyword.value.trim()
  const seq = ++searchSeq
  if (!q) {
    localResults.value = []
    localSearched.value = false
    localLoading.value = false
    return
  }
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
    if (seq !== searchSeq) return
    const items: LocalItem[] = []
    for (const m of movies) {
      if (m.isDeleted) continue
      items.push({
        entity: 'movie',
        id: m.id,
        to: '/movies',
        title: m.title,
        sub: m.directors?.join('、') ?? '',
        cover: toImgUrl(m.posterPath)
      })
    }
    for (const b of books) {
      if (b.isDeleted) continue
      items.push({
        entity: 'book',
        id: b.id,
        to: '/books',
        title: b.title,
        sub: b.authors?.join('、') ?? '',
        cover: toImgUrl(b.coverPath)
      })
    }
    for (const g of games) {
      if (g.isDeleted) continue
      items.push({
        entity: 'game',
        id: g.id,
        to: '/games',
        title: g.title,
        sub: g.developer?.join('、') ?? '',
        cover: toImgUrl(g.coverPath)
      })
    }
    for (const n of notes) {
      if (n.isDeleted) continue
      items.push({
        entity: 'note',
        id: n.id,
        to: '/notes',
        title: n.title || '无标题笔记',
        sub: n.content?.replace(/[#>*`\n]/g, ' ').slice(0, 60) ?? '',
        cover: ''
      })
    }
    for (const p of people) {
      if (p.isDeleted) continue
      items.push({
        entity: 'person',
        id: p.id,
        to: '/people',
        title: p.name,
        sub: p.occupation?.join('、') ?? '',
        cover: toImgUrl(p.photoPath)
      })
    }
    localResults.value = items.slice(0, 60)
  } catch (e) {
    if (seq === searchSeq) message.error('本地搜索失败：' + String(e))
  } finally {
    if (seq === searchSeq) localLoading.value = false
  }
}

// 详情弹窗（影视/书籍/游戏/人物直接弹详情；笔记无详情弹窗，跳转笔记页）
const detailShow = ref(false)
const detailEntity = ref<Exclude<LocalEntity, 'note'> | null>(null)
const detailId = ref<string | null>(null)

function openLocal(it: LocalItem): void {
  if (it.entity === 'note') {
    show.value = false
    void router.push(it.to)
    return
  }
  show.value = false
  detailEntity.value = it.entity
  detailId.value = it.id
  detailShow.value = true
}
function openWork(kind: MediaKind, id: string): void {
  detailEntity.value = kind
  detailId.value = id
  detailShow.value = true
}
function onDetailChanged(): void {
  // 详情内删除/编辑后无需刷新搜索结果外的状态，结果列表下次输入时重建
}

// ── 增强搜索：影视 / 书籍 ──
type VipItem = {
  id: string
  title: string
  cover: string
  subtitle: string
  extra: string
  raw: Record<string, unknown>
}
const vipKind = ref<'movie' | 'book'>('movie')
const vipKeyword = ref('')
const vipLoading = ref(false)
const vipSearched = ref(false)
const vipResults = ref<VipItem[]>([])
const vipPage = ref(1)
const vipTotalPages = ref(1)
// vip 条目 id -> 本地库条目 id（同名即视为已在库）
const vipExisting = ref<Record<string, string>>({})

async function refreshVipExisting(q: string, results: VipItem[]): Promise<void> {
  const locals =
    vipKind.value === 'movie'
      ? await window.mook.movie.list({ keyword: q })
      : await window.mook.book.list({ keyword: q })
  const byTitle = new Map<string, string>()
  for (const it of locals) {
    if (it.isDeleted) continue
    byTitle.set(normalizeTitle(it.title), it.id)
  }
  const map: Record<string, string> = {}
  for (const r of results) {
    const localId = byTitle.get(normalizeTitle(r.title))
    if (localId) map[r.id] = localId
  }
  vipExisting.value = map
}

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
    await refreshVipExisting(q, r.results)
  } catch (e) {
    message.error('增强搜索失败：' + String(e))
  } finally {
    vipLoading.value = false
  }
}

// VIP 详情弹窗（VIP 无详情接口，用搜索结果 + raw 字段展示）
const vipDetailShow = ref(false)
const vipDetail = ref<VipItem | null>(null)
const vipChoosing = ref(false)
const adding = ref(false)
const addStatus = ref<MovieInput['status'] | BookInput['status'] | null>(null)

function clickVip(r: VipItem): void {
  vipDetail.value = r
  vipChoosing.value = false
  vipDetailShow.value = true
}

function vRaw(k: string): string {
  const o = vipDetail.value?.raw
  return o && typeof o[k] === 'string' ? (o[k] as string) : ''
}
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function vipSummary(): string {
  return stripHtml(vRaw('vod_content') || vRaw('vod_blurb') || vRaw('summary'))
}
function vipPeople(label: string): string {
  return vRaw(label)
}

async function addVip(status: MovieInput['status'] | BookInput['status']): Promise<void> {
  const r = vipDetail.value
  if (!r) return
  adding.value = true
  addStatus.value = status
  try {
    if (vipKind.value === 'movie') {
      const id = await window.mook.movie.newId()
      const input = vipToMovie(r.raw, id, status as MovieInput['status'])
      if (r.cover) {
        const local = await window.mook.search.downloadImage(r.cover, 'vip', 'movies', id)
        input.posterPath = local
      }
      await window.mook.movie.create(JSON.parse(JSON.stringify(input)) as MovieInput)
      message.success(`已添加到「${MOVIE_STATUS_LABELS[status as MovieInput['status']]}」`)
    } else {
      const id = await window.mook.book.newId()
      const input = vipToBook(r.raw, id, status as BookInput['status'])
      if (r.cover) {
        const local = await window.mook.search.downloadImage(r.cover, 'vip', 'books', id)
        input.coverPath = local
      }
      await window.mook.book.create(JSON.parse(JSON.stringify(input)) as BookInput)
      message.success(`已添加到「${BOOK_STATUS_LABELS[status as BookInput['status']]}」`)
    }
    vipChoosing.value = false
    await refreshVipExisting(vipKeyword.value.trim(), vipResults.value)
  } catch (e) {
    message.error('添加失败：' + String(e))
  } finally {
    adding.value = false
    addStatus.value = null
  }
}

function switchVipKind(k: 'movie' | 'book'): void {
  if (vipKind.value === k) return
  vipKind.value = k
  vipResults.value = []
  vipSearched.value = false
  vipExisting.value = {}
}

function reset(): void {
  tab.value = 'local'
  localKeyword.value = ''
  localResults.value = []
  localSearched.value = false
  vipKeyword.value = ''
  vipResults.value = []
  vipSearched.value = false
  vipExisting.value = {}
  vipPage.value = 1
  vipTotalPages.value = 1
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
    @update:show="(v: boolean) => { if (v) openSeq++; else reset() }"
  >
    <NTabs v-model:value="tab" type="line" animated>
      <!-- 本地 -->
      <NTabPane name="local" tab="本地搜索">
        <div class="local-search">
          <svg class="ls-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <NInput
            v-model:value="localKeyword"
            size="large"
            clearable
            :bordered="false"
            placeholder="搜索本地影视 / 书籍 / 游戏 / 笔记 / 人物，回车搜索"
            @keyup.enter="searchLocal"
          />
          <NButton size="small" type="primary" :loading="localLoading" @click="searchLocal">
            搜索
          </NButton>
        </div>
        <div class="result-area">
          <div v-if="localLoading" class="local-list">
            <div v-for="n in 8" :key="n" class="local-row sk-row">
              <div class="lr-cover sk" />
              <div class="lr-main">
                <div class="sk sk-line w60" />
                <div class="sk sk-line w40" />
              </div>
              <div class="sk sk-tag" />
            </div>
          </div>
          <template v-else>
          <div v-if="!localSearched" class="local-hint">
            输入关键词，回车或点击搜索全部本地内容
          </div>
          <NEmpty
            v-else-if="!localResults.length"
            description="没有结果"
            class="empty"
          />
          <div v-if="localResults.length" class="local-list">
            <div
              v-for="it in localResults"
              :key="it.entity + it.id"
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
              <NTag
                size="small"
                :bordered="false"
                :type="TAG_TYPE[it.entity]"
              >{{ KIND_LABEL[it.entity] }}</NTag>
            </div>
          </div>
          </template>
        </div>
      </NTabPane>

      <!-- 增强 -->
      <NTabPane name="vip" tab="增强搜索">
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
        <div class="local-search">
          <svg class="ls-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <NInput
            v-model:value="vipKeyword"
            size="large"
            clearable
            :bordered="false"
            :placeholder="vipKind === 'movie' ? '搜索增强影视库（7w+ 数据），回车搜索' : '搜索增强书籍库（300w+ 数据），回车搜索'"
            @keyup.enter="searchVip(1)"
          />
          <NButton size="small" type="primary" :loading="vipLoading" @click="searchVip(1)">
            搜索
          </NButton>
        </div>
        <div class="result-area">
          <div v-if="vipLoading" class="grid">
            <div v-for="n in 10" :key="n" class="v-card">
              <div class="poster sk" />
              <div class="sk sk-line w80" />
              <div class="sk sk-line w50" />
            </div>
          </div>
          <template v-else>
            <div v-if="!vipSearched" class="local-hint">
              输入关键词，回车或点击搜索增强内容库
            </div>
            <NEmpty v-else-if="!vipResults.length" description="没有结果" class="empty" />
            <div v-if="vipResults.length" class="grid">
              <div
                v-for="r in vipResults"
                :key="r.id"
                class="v-card"
                @click="clickVip(r)"
              >
                <div class="poster">
                  <img v-if="r.cover" :src="remoteImg(r.cover, 'vip')" referrerpolicy="no-referrer" />
                  <div v-else class="fallback">🔍</div>
                  <span v-if="vipExisting[r.id]" class="in-lib">已在库</span>
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
          </template>
        </div>
      </NTabPane>

      <!-- TMDB -->
      <NTabPane name="tmdb" tab="TMDB搜索">
        <TmdbPanel :key="'tmdb-' + openSeq" />
      </NTabPane>

      <!-- Bangumi -->
      <NTabPane name="bgm" tab="Bangumi搜索">
        <BgmPanel :key="'bgm-' + openSeq" />
      </NTabPane>
    </NTabs>

  </NModal>

  <!-- 增强搜索详情：查看后再决定是否添加到本地 -->
  <NModal
    :show="vipDetailShow"
    @update:show="(v: boolean) => (vipDetailShow = v)"
    :auto-focus="false"
  >
    <div class="vip-detail" v-if="vipDetail">
      <div class="vd-head">
        <img v-if="vipDetail.cover" :src="remoteImg(vipDetail.cover, 'vip')" referrerpolicy="no-referrer" class="vd-poster" />
        <div v-else class="vd-poster vd-fallback">🔍</div>
        <div class="vd-info">
          <h3>{{ vipDetail.title }}</h3>
          <div class="vd-orig" v-if="vipDetail.subtitle">{{ vipDetail.subtitle }}</div>
          <div class="vd-extra" v-if="vipDetail.extra">{{ vipDetail.extra }}</div>
          <div class="vd-people" v-if="vipKind === 'movie' && vipPeople('vod_actor')">
            <label>主演：</label>{{ vipPeople('vod_actor') }}
          </div>
          <div class="vd-people" v-if="vipKind === 'book' && vipPeople('author')">
            <label>作者：</label>{{ vipPeople('author') }}
          </div>
          <div class="vd-people" v-if="vipKind === 'book' && vRaw('isbn')">
            <label>ISBN：</label>{{ vRaw('isbn') }}
          </div>
        </div>
      </div>

      <p class="vd-overview">{{ vipSummary() || '暂无简介' }}</p>

      <div class="vd-foot">
        <span v-if="vipExisting[vipDetail.id]" class="collected">已收藏该条目</span>
        <div v-else class="vd-add">
          <template v-if="vipChoosing">
            <template v-if="vipKind === 'movie'">
              <NButton size="small" :loading="addStatus === 'want_to_watch'" @click="addVip('want_to_watch')">想看</NButton>
              <NButton size="small" :loading="addStatus === 'watching'" @click="addVip('watching')">在看</NButton>
              <NButton size="small" :loading="addStatus === 'watched'" @click="addVip('watched')">已看</NButton>
            </template>
            <template v-else>
              <NButton size="small" :loading="addStatus === 'want_to_read'" @click="addVip('want_to_read')">想读</NButton>
              <NButton size="small" :loading="addStatus === 'reading'" @click="addVip('reading')">在读</NButton>
              <NButton size="small" :loading="addStatus === 'read'" @click="addVip('read')">读过</NButton>
            </template>
            <NButton size="small" :disabled="adding" @click="vipChoosing = false">取消</NButton>
          </template>
          <NButton v-else size="small" type="primary" @click="vipChoosing = true">
            添加到本地库
          </NButton>
        </div>
      </div>
    </div>
  </NModal>

  <!-- 本地搜索结果详情：影视/书籍/游戏/人物 -->
  <MovieDetailModal
    v-if="detailEntity === 'movie'"
    v-model:show="detailShow"
    :id="detailId"
    @changed="onDetailChanged"
  />
  <BookDetailModal
    v-else-if="detailEntity === 'book'"
    v-model:show="detailShow"
    :id="detailId"
    @changed="onDetailChanged"
  />
  <GameDetailModal
    v-else-if="detailEntity === 'game'"
    v-model:show="detailShow"
    :id="detailId"
    @changed="onDetailChanged"
  />
  <PersonDetailModal
    v-else-if="detailEntity === 'person'"
    v-model:show="detailShow"
    :id="detailId"
    @open-work="openWork"
    @changed="onDetailChanged"
  />
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
  color: var(--on-accent);
  background: var(--accent);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  z-index: 900;
  transition: transform 0.14s ease;
}
.fab:hover {
  background: var(--accent-hover);
  transform: translateY(-2px) scale(1.04);
}
.fab:active {
  transform: scale(0.95);
}
.local-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  margin: 2px 0 14px;
  height: 46px;
  border-radius: 12px;
  background: #f4f5f8;
  border: 1px solid transparent;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    box-shadow 0.15s;
}
.local-search:focus-within {
  background: var(--surface);
  border-color: color-mix(in srgb, var(--accent-ink) 45%, var(--surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-ink) 8%, transparent);
}
.ls-icon {
  width: 18px;
  height: 18px;
  color: #9aa0ac;
  flex-shrink: 0;
}
.local-search :deep(.n-input) {
  flex: 1;
  min-width: 0;
}
.local-search :deep(.n-input .n-input__border),
.local-search :deep(.n-input .n-input__state-border) {
  display: none;
}
.local-hint {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: #b0b5bd;
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
  margin-bottom: 12px;
}
.empty {
  height: 56vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 骨架屏 */
.sk {
  position: relative;
  overflow: hidden;
  background: #eef0f4;
}
.sk::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.65),
    transparent
  );
  animation: sk-shimmer 1.3s infinite;
}
@keyframes sk-shimmer {
  100% {
    transform: translateX(100%);
  }
}
.sk-row {
  pointer-events: none;
}
.sk-line {
  height: 12px;
  border-radius: 5px;
  margin-bottom: 7px;
}
.sk-line:last-child {
  margin-bottom: 0;
}
.w40 {
  width: 40%;
}
.w50 {
  width: 50%;
}
.w60 {
  width: 60%;
}
.w80 {
  width: 80%;
}
.sk-tag {
  width: 38px;
  height: 20px;
  border-radius: 5px;
  flex-shrink: 0;
}
.local-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 56vh;
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
  color: var(--text-strong);
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
  height: 56vh;
  overflow-y: auto;
  align-content: start;
  padding-right: 4px;
}
.poster {
  position: relative;
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
.v-card {
  cursor: pointer;
}
.in-lib {
  position: absolute;
  right: 6px;
  top: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: #fff;
  background: rgba(31, 35, 41, 0.72);
  backdrop-filter: blur(6px);
}
.vip-detail {
  width: 720px;
  max-width: 94vw;
  max-height: 86vh;
  overflow-y: auto;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.vd-head {
  display: flex;
  gap: 18px;
}
.vd-poster {
  width: 150px;
  border-radius: 10px;
  flex-shrink: 0;
}
.vd-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  aspect-ratio: 2 / 3;
  height: auto;
  background: #f2f3f7;
}
.vd-info h3 {
  font-size: 19px;
  margin-bottom: 4px;
}
.vd-orig {
  font-size: 13px;
  color: #5b616c;
  margin-bottom: 6px;
}
.vd-extra {
  font-size: 12.5px;
  color: #9aa0ac;
  margin-bottom: 8px;
}
.vd-people {
  margin-top: 6px;
  font-size: 13.5px;
  color: #3f444d;
  line-height: 1.7;
}
.vd-people label {
  color: #9aa0ac;
}
.vd-overview {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.8;
  color: #3f444d;
  white-space: pre-wrap;
}
.vd-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #f2f3f6;
}
.collected {
  font-size: 13px;
  color: #9aa0ac;
}
.vd-add {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
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
  color: var(--text-strong);
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
