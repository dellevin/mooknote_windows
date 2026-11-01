<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import type {
  StatsOverview,
  StatusCount,
  HomeStats,
  HeatDay,
  Movie,
  Book,
  Game
} from '@shared/types'
import {
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { toImgUrl } from '@/utils/image'
import MovieDetailModal from '@/components/MovieDetailModal.vue'
import BookDetailModal from '@/components/book/BookDetailModal.vue'
import GameDetailModal from '@/components/game/GameDetailModal.vue'

const overview = ref<StatsOverview | null>(null)
const home = ref<HomeStats | null>(null)
const nickname = ref('MookNote')
const loading = ref(true)

// ── 封面瓦片（进行中 / 最近添加共用） ──
type TileKind = 'movie' | 'book' | 'game'
interface Tile {
  id: string
  title: string
  cover: string | null
  kind: TileKind
  createdAt: string
}
const TILE_KIND_LABEL: Record<TileKind, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏'
}

const inProgress = ref<Tile[]>([])
const recent = ref<Tile[]>([])

// 封面行内滚轮 → 横向滚动（仅在内容溢出可横滚时拦截，避免挡住页面纵向滚动）
function onShelfWheel(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement
  if (el.scrollWidth <= el.clientWidth || e.deltaY === 0) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}

// 三个详情弹窗
const detailId = ref<string | null>(null)
const detailKind = ref<TileKind | null>(null)
const detailShow = ref(false)
function openTile(t: Tile): void {
  detailKind.value = t.kind
  detailId.value = t.id
  detailShow.value = true
}

const KINDS: {
  key: 'movies' | 'books' | 'games'
  title: string
  labels: Record<string, string>
}[] = [
  { key: 'movies', title: '影视', labels: MOVIE_STATUS_LABELS },
  { key: 'books', title: '书籍', labels: BOOK_STATUS_LABELS },
  { key: 'games', title: '游戏', labels: GAME_STATUS_LABELS }
]

// ── 贡献热力图：按「周」分列，每列 7 格（周日起），对齐 GitHub ──
interface Cell extends HeatDay {
  level: number
}
interface Week {
  cells: (Cell | null)[]
  month: string | null
}

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function levelOf(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

const weeks = computed<Week[]>(() => {
  const days = home.value?.days ?? []
  if (!days.length) return []
  // 第一天是周几，就在前面补 null 让首列从周日开始
  const firstDow = new Date(days[0].date + 'T00:00:00').getDay()
  const stream: (Cell | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...days.map((d) => ({ ...d, level: levelOf(d.count) }))
  ]
  const out: Week[] = []
  for (let i = 0; i < stream.length; i += 7) {
    const cells = stream.slice(i, i + 7)
    while (cells.length < 7) cells.push(null)
    const first = cells.find((c): c is Cell => !!c)
    out.push({ cells, month: first ? MONTHS[Number(first.date.slice(5, 7)) - 1] : null })
  }
  // 月份标签去重：与上一列出现在同一月则清空
  let last = -1
  for (const w of out) {
    if (!w.month) continue
    const idx = MONTHS.indexOf(w.month)
    if (idx === last) w.month = null
    else last = idx
  }
  return out
})

const longestStreak = computed(() => {
  let best = 0
  let run = 0
  for (const d of home.value?.days ?? []) {
    if (d.count > 0) {
      run++
      best = Math.max(best, run)
    } else run = 0
  }
  return best
})

// ── 热力图格子悬停 / 点击：查看当天条目 ──
type DayKind = 'movie' | 'book' | 'game' | 'person' | 'note'
interface DayItem {
  kind: DayKind
  id: string
  title: string
  cover: string | null
}
const KIND_LABEL: Record<DayKind, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏',
  person: '人物',
  note: '笔记'
}
// 底部分类跳转：只显示当天出现过的分类（人物归入…无列表页，不提供跳转）
const KIND_ROUTE: Partial<Record<DayKind, { label: string; to: string }>> = {
  movie: { label: '影视', to: '/movies' },
  book: { label: '阅读', to: '/books' },
  game: { label: '游戏', to: '/games' },
  note: { label: '笔记', to: '/notes' }
}
const dayCache = new Map<string, DayItem[]>()
const tip = ref<{ x: number; y: number; date: string; items: DayItem[] | null } | null>(null)
const pinned = ref<{ date: string; items: DayItem[] | null } | null>(null)
let tipSeq = 0
const router = useRouter()

function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y} 年 ${m} 月 ${d} 日`
}
const tipPos = computed(() => {
  if (!tip.value) return {}
  const w = 250
  const left =
    tip.value.x + 14 + w > window.innerWidth ? tip.value.x - w - 10 : tip.value.x + 14
  const top = Math.min(tip.value.y + 14, window.innerHeight - 220)
  return { left: left + 'px', top: top + 'px', width: w + 'px' }
})

async function loadDay(date: string): Promise<DayItem[]> {
  const cached = dayCache.get(date)
  if (cached) return cached
  const items = (await window.mook.stats.dayItems(date)).map((r) => ({
    ...r,
    kind: r.kind as DayKind
  }))
  dayCache.set(date, items)
  return items
}

async function onCellEnter(e: MouseEvent, c: Cell): Promise<void> {
  if (!c.count || pinned.value) {
    tip.value = null
    return
  }
  tip.value = { x: e.clientX, y: e.clientY, date: c.date, items: dayCache.get(c.date) ?? null }
  if (!dayCache.has(c.date)) {
    const seq = ++tipSeq
    const items = await loadDay(c.date)
    if (seq === tipSeq && tip.value?.date === c.date) {
      tip.value = { ...tip.value, items }
    }
  }
}
function onCellMove(e: MouseEvent): void {
  if (tip.value) tip.value = { ...tip.value, x: e.clientX, y: e.clientY }
}
function onCellLeave(): void {
  tipSeq++
  tip.value = null
}

// 点击格子：常驻面板。优先用缓存，否则先展示加载态
async function onCellClick(c: Cell): Promise<void> {
  if (!c.count) return
  onCellLeave()
  pinned.value = { date: c.date, items: dayCache.get(c.date) ?? null }
  if (!dayCache.has(c.date)) {
    pinned.value = { ...pinned.value, items: await loadDay(c.date) }
  }
}
function closePinned(): void {
  pinned.value = null
}

// 常驻面板里点条目：影视/书籍/游戏打开详情；人物/笔记暂无首页详情，不处理
function openDayItem(it: DayItem): void {
  if (it.kind === 'movie' || it.kind === 'book' || it.kind === 'game') {
    detailKind.value = it.kind
    detailId.value = it.id
    detailShow.value = true
  }
}

const pinnedLinks = computed(() => {
  const kinds = new Set<DayKind>(pinned.value?.items?.map((i: DayItem) => i.kind) ?? [])
  return (Object.keys(KIND_ROUTE) as DayKind[])
    .filter((k) => kinds.has(k))
    .map((k) => KIND_ROUTE[k]!)
})

function goKind(to: string): void {
  closePinned()
  void router.push(to)
}

function kindRows(key: 'movies' | 'books' | 'games'): StatusCount[] {
  return overview.value?.[key].byStatus ?? []
}
function kindPct(key: 'movies' | 'books' | 'games', count: number): number {
  const total = overview.value?.[key].total ?? 0
  return total > 0 ? (count / total) * 100 : 0
}

const RECENT_PER_KIND = 6

function toMovieTile(m: Movie): Tile {
  return { id: m.id, title: m.title, cover: m.posterPath, kind: 'movie', createdAt: m.createdAt }
}
function toBookTile(b: Book): Tile {
  return { id: b.id, title: b.title, cover: b.coverPath, kind: 'book', createdAt: b.createdAt }
}
function toGameTile(g: Game): Tile {
  return { id: g.id, title: g.title, cover: g.coverPath, kind: 'game', createdAt: g.createdAt }
}

async function loadShelves(): Promise<void> {
  const [watching, reading, playing, movies, books, games] = await Promise.all([
    window.mook.movie.list({ status: 'watching', sortMode: 0, limit: RECENT_PER_KIND }),
    window.mook.book.list({ status: 'reading', sortMode: 0, limit: RECENT_PER_KIND }),
    window.mook.game.list({ status: 'playing', sortMode: 0, limit: RECENT_PER_KIND }),
    window.mook.movie.list({ sortMode: 1, limit: RECENT_PER_KIND }),
    window.mook.book.list({ sortMode: 1, limit: RECENT_PER_KIND }),
    window.mook.game.list({ sortMode: 1, limit: RECENT_PER_KIND })
  ])
  inProgress.value = [
    ...watching.map(toMovieTile),
    ...reading.map(toBookTile),
    ...playing.map(toGameTile)
  ]
  recent.value = [...movies.map(toMovieTile), ...books.map(toBookTile), ...games.map(toGameTile)]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 12)
}

onMounted(async () => {
  try {
    const [ov, hm, prefs] = await Promise.all([
      window.mook.stats.overview(),
      window.mook.stats.home(),
      window.mook.prefs.all()
    ])
    overview.value = ov
    home.value = hm
    nickname.value = (prefs.nickname as string) || 'MookNote'
    void loadShelves()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <NSpin :show="loading">
      <div class="head">
        <div>
          <h1 class="hello">{{ nickname }}</h1>
          <p class="hello-sub">记录你看过、读过、玩过的一切</p>
        </div>
        <div v-if="home" class="head-stat">
          <strong>{{ home.totalCount }}</strong> 条记录 · {{ home.activeDays }} 个活跃日
        </div>
      </div>

      <section v-if="home" class="card heat-card">
        <div class="card-title">
          <span>{{ home.days[home.days.length - 1]?.count ? '今天也有新记录' : '最近一年的记录' }}</span>
          <span class="muted">最长连续 {{ longestStreak }} 天</span>
        </div>
        <div class="heat-scroll">
          <div class="heat">
            <div class="heat-months">
              <span v-for="(w, i) in weeks" :key="'m' + i" class="heat-month">
                {{ w.month ?? '' }}
              </span>
            </div>
            <div class="heat-grid">
              <div v-for="(w, i) in weeks" :key="'w' + i" class="heat-col">
                <div
                  v-for="(c, j) in w.cells"
                  :key="j"
                  class="heat-cell"
                  :class="[c ? 'lvl' + c.level : 'blank', { hoverable: c && c.count > 0 }]"
                  @mouseenter="c && onCellEnter($event, c)"
                  @mousemove="onCellMove"
                  @mouseleave="onCellLeave"
                  @click="c && onCellClick(c)"
                ></div>
              </div>
            </div>
          </div>
        </div>
        <div class="heat-legend">
          <span class="muted">少</span>
          <span class="heat-cell lvl0"></span>
          <span class="heat-cell lvl1"></span>
          <span class="heat-cell lvl2"></span>
          <span class="heat-cell lvl3"></span>
          <span class="heat-cell lvl4"></span>
          <span class="muted">多</span>
        </div>
      </section>

      <div v-if="inProgress.length || recent.length" class="shelf-row">
        <section v-if="inProgress.length" class="card shelf-card">
          <div class="card-title">
            <span>进行中</span>
            <span class="muted">继续上次的记录</span>
          </div>
          <div class="shelf" @wheel="onShelfWheel">
            <button
              v-for="t in inProgress"
              :key="t.kind + t.id"
              type="button"
              class="tile"
              :title="t.title"
              @click="openTile(t)"
            >
              <img v-if="t.cover" :src="toImgUrl(t.cover)" :alt="t.title" class="tile-img" />
              <div v-else class="tile-img tile-empty">
                <span>{{ t.title.slice(0, 1) }}</span>
              </div>
              <span class="tile-kind" :class="'tk-' + t.kind">{{ TILE_KIND_LABEL[t.kind] }}</span>
              <span class="tile-name">{{ t.title }}</span>
            </button>
          </div>
        </section>

        <section v-if="recent.length" class="card shelf-card">
          <div class="card-title">
            <span>最近添加</span>
            <span class="muted">最新录入的 {{ recent.length }} 条</span>
          </div>
          <div class="shelf" @wheel="onShelfWheel">
            <button
              v-for="t in recent"
              :key="t.kind + t.id"
              type="button"
              class="tile"
              :title="t.title"
              @click="openTile(t)"
            >
              <img v-if="t.cover" :src="toImgUrl(t.cover)" :alt="t.title" class="tile-img" />
              <div v-else class="tile-img tile-empty">
                <span>{{ t.title.slice(0, 1) }}</span>
              </div>
              <span class="tile-kind" :class="'tk-' + t.kind">{{ TILE_KIND_LABEL[t.kind] }}</span>
              <span class="tile-name">{{ t.title }}</span>
            </button>
          </div>
        </section>
      </div>

      <div class="cards">
        <section v-for="kind in KINDS" :key="kind.key" class="card">
          <div class="card-title">
            <span>{{ kind.title }}</span>
            <span class="muted">
              {{ overview?.[kind.key].total }} 部
              <template v-if="overview?.[kind.key].avgRating != null">
                · ★ {{ overview?.[kind.key].avgRating }}
              </template>
            </span>
          </div>
          <div v-for="s in kindRows(kind.key)" :key="s.status" class="mini-row">
            <span class="mini-label">{{ kind.labels[s.status] ?? s.status }}</span>
            <div class="mini-track">
              <div class="mini-fill" :style="{ width: kindPct(kind.key, s.count) + '%' }"></div>
            </div>
            <span class="mini-count">{{ s.count }}</span>
          </div>
        </section>
      </div>
    </NSpin>

    <!-- 热力图当天条目浮层（跟随鼠标，轻量预览） -->
    <Teleport to="body">
      <div v-if="tip" class="heat-tip" :style="tipPos">
        <div class="heat-tip-head">
          <span>{{ fmtDay(tip.date) }}</span>
          <span class="heat-tip-count">{{ tip.items?.length ?? 0 }} 条</span>
        </div>
        <div v-if="tip.items === null" class="heat-tip-loading">加载中…</div>
        <ul v-else-if="tip.items.length" class="heat-tip-list">
          <li v-for="(it, i) in tip.items.slice(0, 8)" :key="i">
            <img
              v-if="it.cover"
              :src="toImgUrl(it.cover)"
              class="heat-tip-cover"
              loading="lazy"
            />
            <span v-else class="heat-tip-cover heat-tip-cover-empty">
              {{ it.title.slice(0, 1) }}
            </span>
            <span class="heat-tip-kind" :class="'k-' + it.kind">{{ KIND_LABEL[it.kind] }}</span>
            <span class="heat-tip-title">{{ it.title }}</span>
          </li>
          <li v-if="tip.items.length > 8" class="heat-tip-more">
            等 {{ tip.items.length }} 条，点击查看
          </li>
        </ul>
        <div v-else class="heat-tip-empty">当天没有记录</div>
      </div>

      <!-- 点击格子后的常驻面板 -->
      <transition name="day-pop">
        <div v-if="pinned" class="day-mask" @click.self="closePinned">
          <div class="day-panel">
            <div class="day-head">
              <div>
                <div class="day-title">{{ fmtDay(pinned.date) }}</div>
                <div class="day-count">{{ pinned.items?.length ?? 0 }} 条记录</div>
              </div>
              <button class="day-close" title="关闭" @click="closePinned">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div v-if="pinned.items === null" class="day-loading">加载中…</div>
            <div v-else-if="!pinned.items.length" class="day-loading">当天没有记录</div>
            <ul v-else class="day-list">
              <li
                v-for="it in pinned.items"
                :key="it.kind + it.id"
                class="day-row"
                :class="{ clickable: it.kind === 'movie' || it.kind === 'book' || it.kind === 'game' }"
                @click="openDayItem(it)"
              >
                <img v-if="it.cover" :src="toImgUrl(it.cover)" class="day-cover" loading="lazy" />
                <span v-else class="day-cover day-cover-empty">{{ it.title.slice(0, 1) }}</span>
                <span class="day-meta">
                  <span class="day-kind" :class="'k-' + it.kind">{{ KIND_LABEL[it.kind] }}</span>
                  <span class="day-name">{{ it.title }}</span>
                </span>
              </li>
            </ul>

            <div v-if="pinnedLinks.length" class="day-footer">
              <button
                v-for="link in pinnedLinks"
                :key="link.to"
                class="day-link"
                @click="goKind(link.to)"
              >
                查看{{ link.label }}界面
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <MovieDetailModal v-if="detailKind === 'movie'" v-model:show="detailShow" :id="detailId" />
    <BookDetailModal v-if="detailKind === 'book'" v-model:show="detailShow" :id="detailId" />
    <GameDetailModal v-if="detailKind === 'game'" v-model:show="detailShow" :id="detailId" />
  </div>
</template>

<style scoped>
.page {
  padding: 26px 30px 40px;
  max-width: 1200px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
}
.hello {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-strong);
}
.hello-sub {
  font-size: 13px;
  color: #8a909c;
  margin-top: 4px;
}
.head-stat {
  font-size: 13px;
  color: #57606a;
  background: #f6f8fa;
  border: 1px solid #d8dee4;
  border-radius: 999px;
  padding: 6px 14px;
  white-space: nowrap;
}
.head-stat strong {
  color: var(--text-strong);
  font-size: 15px;
}

/* 封面横排（进行中 / 最近添加），两块一行各占一半 */
.shelf-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.shelf-card {
  min-width: 0;
}
.shelf {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 104px;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none; /* Firefox */
}
.shelf::-webkit-scrollbar {
  display: none; /* Chrome / Electron */
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.tile-img {
  width: 104px;
  height: 146px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(17, 17, 17, 0.08);
  background: #f0f1f4;
}
.tile-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b6bcc6;
  font-size: 30px;
}
.tile-kind {
  align-self: flex-start;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  color: #fff;
}
.tile-kind.tk-movie {
  background: #3b82f6;
}
.tile-kind.tk-book {
  background: #8b5cf6;
}
.tile-kind.tk-game {
  background: #f59e0b;
}
.tile-name {
  font-size: 12px;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card {
  background: var(--surface);
  border: 1px solid #d8dee4;
  border-radius: 10px;
  padding: 16px 18px;
}
.card-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 14px;
}
.muted {
  font-size: 12px;
  font-weight: 400;
  color: #8a909c;
}

.heat-card {
  margin-bottom: 16px;
}
.heat-scroll {
  overflow-x: auto;
  padding-bottom: 4px;
}
.heat {
  display: flex;
  flex-direction: column;
}
.heat-months {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--heat-gap, 3px);
  margin-bottom: 5px;
}
.heat-month {
  font-size: 10px;
  color: #8a909c;
  white-space: nowrap;
}
.heat-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--heat-gap, 3px);
}
.heat-col {
  display: flex;
  flex-direction: column;
  gap: var(--heat-gap, 3px);
}
.heat-cell {
  aspect-ratio: 1;
  width: 100%;
  min-width: 6px;
  border-radius: 2px;
}
.heat-cell.blank {
  visibility: hidden;
}
.heat-cell.hoverable {
  cursor: pointer;
  outline: 1px solid rgba(0, 0, 0, 0.15);
  outline-offset: -1px;
}
/* 热力色阶跟随皮肤强调色：空槽浅灰，有记录的格子用 accent 由浅到深 */
.lvl0 {
  background: var(--heat-0, #ebedf0);
}
.lvl1 {
  background: color-mix(in srgb, var(--accent) 22%, white);
}
.lvl2 {
  background: color-mix(in srgb, var(--accent) 46%, white);
}
.lvl3 {
  background: color-mix(in srgb, var(--accent) 72%, white);
}
.lvl4 {
  background: color-mix(in srgb, var(--accent) 100%, white);
}
.heat-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
}
.heat-legend .heat-cell {
  width: 11px;
  aspect-ratio: auto;
  height: 11px;
}

/* 悬停浮层 teleport 到 body，需用全局样式 */
.heat-tip {
  position: fixed;
  z-index: 3000;
  max-height: 260px;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(33, 38, 45, 0.94);
  color: #e6e8eb;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  pointer-events: none;
  font-size: 12px;
}
.heat-tip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
  font-weight: 600;
}
.heat-tip-count {
  font-weight: 400;
  color: #9aa3ad;
}
.heat-tip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.heat-tip-list li {
  display: flex;
  align-items: center;
  gap: 7px;
}
.heat-tip-cover {
  width: 22px;
  height: 30px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
}
.heat-tip-cover-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #9aa3ad;
}
.heat-tip-kind {
  flex-shrink: 0;
  font-size: 10.5px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  color: #fff;
}
.heat-tip-kind.k-movie {
  background: #3b82f6;
}
.heat-tip-kind.k-book {
  background: #8b5cf6;
}
.heat-tip-kind.k-game {
  background: #f59e0b;
}
.heat-tip-kind.k-person {
  background: #14b8a6;
}
.heat-tip-kind.k-note {
  background: #6b7280;
}
.heat-tip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.heat-tip-more {
  color: #9aa3ad;
}
.heat-tip-empty,
.heat-tip-loading {
  color: #9aa3ad;
  padding: 2px 0;
}

/* 点击格子后的常驻面板 */
.day-mask {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 17, 17, 0.22);
}
.day-panel {
  width: 380px;
  max-width: calc(100vw - 40px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--surface, #fff);
  box-shadow: 0 12px 36px rgba(17, 17, 17, 0.2);
  overflow: hidden;
}
.day-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.day-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
}
.day-count {
  margin-top: 2px;
  font-size: 12px;
  color: #8a909c;
}
.day-close {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #8a909c;
  cursor: pointer;
}
.day-close:hover {
  background: rgba(17, 17, 17, 0.06);
  color: var(--text-strong, #1f2329);
}
.day-loading {
  padding: 4px 16px 18px;
  font-size: 13px;
  color: #8a909c;
}
.day-list {
  list-style: none;
  margin: 0;
  padding: 0 10px;
  overflow-y: auto;
}
.day-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
}
.day-row.clickable {
  cursor: pointer;
}
.day-row.clickable:hover {
  background: rgba(17, 17, 17, 0.05);
}
.day-cover {
  width: 34px;
  height: 46px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid rgba(17, 17, 17, 0.08);
  background: #f0f1f4;
}
.day-cover-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: #b6bcc6;
}
.day-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.day-kind {
  flex-shrink: 0;
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  color: #fff;
}
.day-kind.k-movie {
  background: #3b82f6;
}
.day-kind.k-book {
  background: #8b5cf6;
}
.day-kind.k-game {
  background: #f59e0b;
}
.day-kind.k-person {
  background: #14b8a6;
}
.day-kind.k-note {
  background: #6b7280;
}
.day-name {
  font-size: 13px;
  color: var(--text-strong, #1f2329);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(17, 17, 17, 0.07);
}
.day-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-family: inherit;
  color: var(--text-strong, #1f2329);
  background: rgba(17, 17, 17, 0.04);
  border: 1px solid rgba(17, 17, 17, 0.1);
  border-radius: 999px;
  cursor: pointer;
}
.day-link:hover {
  background: rgba(17, 17, 17, 0.08);
}
.day-pop-enter-active,
.day-pop-leave-active {
  transition: opacity 0.15s ease;
}
.day-pop-enter-active .day-panel,
.day-pop-leave-active .day-panel {
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.day-pop-enter-from,
.day-pop-leave-to {
  opacity: 0;
}
.day-pop-enter-from .day-panel,
.day-pop-leave-to .day-panel {
  transform: scale(0.96) translateY(6px);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.mini-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 7px;
}
.mini-row:last-child {
  margin-bottom: 0;
}
.mini-label {
  width: 52px;
  font-size: 12px;
  color: #57606a;
  flex-shrink: 0;
}
.mini-track {
  flex: 1;
  height: 8px;
  background: #f0f1f4;
  border-radius: 4px;
  overflow: hidden;
}
.mini-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.3s;
}
.mini-count {
  width: 26px;
  text-align: right;
  font-size: 12px;
  color: #57606a;
}

@media (max-width: 1080px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .shelf-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
