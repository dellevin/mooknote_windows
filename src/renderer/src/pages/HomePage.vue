<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NSpin } from 'naive-ui'
import type {
  StatsOverview,
  StatusCount,
  HomeStats,
  HeatDay
} from '@shared/types'
import {
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'

const overview = ref<StatsOverview | null>(null)
const home = ref<HomeStats | null>(null)
const nickname = ref('MookNote')
const loading = ref(true)

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

function kindRows(key: 'movies' | 'books' | 'games'): StatusCount[] {
  return overview.value?.[key].byStatus ?? []
}
function kindPct(key: 'movies' | 'books' | 'games', count: number): number {
  const total = overview.value?.[key].total ?? 0
  return total > 0 ? (count / total) * 100 : 0
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
                  :class="c ? 'lvl' + c.level : 'blank'"
                  :title="c ? `${c.date} · ${c.count} 条` : ''"
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
  color: #1f2329;
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
  color: #1f2329;
  font-size: 15px;
}

.card {
  background: #fff;
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
  color: #1f2329;
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
.lvl0 {
  background: #ebedf0;
}
.lvl1 {
  background: #9be9a8;
}
.lvl2 {
  background: #40c463;
}
.lvl3 {
  background: #30a14e;
}
.lvl4 {
  background: #216e39;
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
  background: #1f2329;
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
}
</style>
