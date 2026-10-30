<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NEmpty, NSpin, NTag, NModal } from 'naive-ui'
import type { CalendarEntry, CalendarKind } from '@shared/types'
import {
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { toImgUrl } from '@/utils/image'
import MovieDetailModal from '@/components/MovieDetailModal.vue'
import BookDetailModal from '@/components/book/BookDetailModal.vue'
import GameDetailModal from '@/components/game/GameDetailModal.vue'

const loading = ref(false)
// 显示模式（1=观看/阅读/通关，0=添加日期）持久化，切换界面再回来保持用户选择
const initialMode = (): 0 | 1 => (Number(localStorage.getItem('calendarMode')) === 0 ? 0 : 1)
const mode = ref<0 | 1>(initialMode())
const entries = ref<CalendarEntry[]>([])
const now = new Date()
const cursor = ref(new Date(now.getFullYear(), now.getMonth(), 1))
// 选中日期：默认今天，切月后清空（对齐手机版交互）
const selected = ref<string>(keyOf(new Date()))

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

const monthLabel = computed(
  () => `${cursor.value.getFullYear()} 年 ${cursor.value.getMonth() + 1} 月`
)

// 当月日历单元（含前后补位），周一为首列
const cells = computed<{ day: number; date: string; inMonth: boolean }[]>(() => {
  const y = cursor.value.getFullYear()
  const m = cursor.value.getMonth()
  const first = new Date(y, m, 1)
  // getDay: 0=周日 -> 转为周一首列偏移
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const out: { day: number; date: string; inMonth: boolean }[] = []
  for (let i = 0; i < lead; i++) {
    const d = new Date(y, m, i - lead + 1)
    out.push({ day: d.getDate(), date: keyOf(d), inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    out.push({ day: d, date: keyOf(new Date(y, m, d)), inMonth: true })
  }
  while (out.length % 7 !== 0) {
    const idx = out.length - lead - daysInMonth + 1
    const d = new Date(y, m + 1, idx)
    out.push({ day: d.getDate(), date: keyOf(d), inMonth: false })
  }
  return out
})

const byDate = computed(() => {
  const map = new Map<string, CalendarEntry[]>()
  for (const e of entries.value) {
    const arr = map.get(e.date) ?? []
    arr.push(e)
    map.set(e.date, arr)
  }
  return map
})

// 当月有记录的天数（用于月份概览）
const monthCount = computed(() => {
  const prefix = `${cursor.value.getFullYear()}-${String(cursor.value.getMonth() + 1).padStart(2, '0')}`
  return entries.value.filter((e) => e.date.startsWith(prefix)).length
})

const todayKey = keyOf(new Date())
// 当月周数（4~6 行），网格行高按卡片可用高度平分，窗口缩放不出滚动条
const rowCount = computed(() => Math.ceil(cells.value.length / 7))
const selectedEntries = computed(() => byDate.value.get(selected.value) ?? [])
const selectedTitle = computed(() => {
  const [, m, d] = selected.value.split('-').map(Number)
  return `${m} 月 ${d} 日`
})

function keyOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function labelOf(e: CalendarEntry): string {
  if (e.kind === 'movie') return MOVIE_STATUS_LABELS[e.status as keyof typeof MOVIE_STATUS_LABELS] ?? e.status
  if (e.kind === 'book') return BOOK_STATUS_LABELS[e.status as keyof typeof BOOK_STATUS_LABELS] ?? e.status
  return GAME_STATUS_LABELS[e.status as keyof typeof GAME_STATUS_LABELS] ?? e.status
}
function typeColor(k: CalendarKind): string {
  return k === 'movie' ? '#4a90d9' : k === 'game' ? '#66bb6a' : '#7e57c2'
}
function typeLabel(k: CalendarKind): string {
  return k === 'movie' ? '影视' : k === 'game' ? '游戏' : '书籍'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = await window.mook.stats.calendar(mode.value)
  } finally {
    loading.value = false
  }
}
function changeMode(v: 0 | 1): void {
  if (mode.value === v) return
  mode.value = v
  localStorage.setItem('calendarMode', String(v))
  void load()
}
function prevMonth(): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() - 1, 1)
}
function nextMonth(): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 1)
}
function goToday(): void {
  const n = new Date()
  cursor.value = new Date(n.getFullYear(), n.getMonth(), 1)
  selected.value = keyOf(n)
}
// 点日期弹窗显示当天内容
const dayModalShow = ref(false)
function pickDay(date: string): void {
  selected.value = date
  dayModalShow.value = true
}
function dayEntries(date: string): CalendarEntry[] {
  return byDate.value.get(date) ?? []
}
function coverOf(e?: CalendarEntry): string {
  return e?.coverPath ?? ''
}
// 拼图最多放 4 张，其余数量以 +N 角标表示
function tileEntries(date: string): CalendarEntry[] {
  return dayEntries(date).slice(0, 4)
}

// 点击当天记录 -> 打开对应详情弹窗
const detailShow = ref(false)
const detailId = ref<string | null>(null)
const detailKind = ref<CalendarKind | null>(null)
function openEntry(e: CalendarEntry): void {
  dayModalShow.value = false
  detailKind.value = e.kind
  detailId.value = e.id
  detailShow.value = true
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="title">书影日历</h2>
      <div class="mode-switch">
        <button
          type="button"
          class="seg"
          :class="{ on: mode === 1 }"
          @click="changeMode(1)"
        >
          观看 / 阅读 / 通关
        </button>
        <button
          type="button"
          class="seg"
          :class="{ on: mode === 0 }"
          @click="changeMode(0)"
        >
          添加日期
        </button>
      </div>
    </div>

    <div class="cal-card">
      <div class="cal-head">
        <div class="nav">
          <button type="button" class="nav-btn" title="上个月" @click="prevMonth">‹</button>
          <span class="month">{{ monthLabel }}</span>
          <button type="button" class="nav-btn" title="下个月" @click="nextMonth">›</button>
          <NButton size="tiny" quaternary class="today-btn" @click="goToday">今天</NButton>
        </div>
        <span class="count">本月 {{ monthCount }} 条记录</span>
      </div>

      <NSpin :show="loading" class="cal-spin">
        <div class="grid" :style="{ '--rows': rowCount }">
          <div v-for="w in WEEK" :key="w" class="week-head">{{ w }}</div>
          <template v-for="cell in cells" :key="cell.date">
            <div
              class="cell"
              :class="{
                out: !cell.inMonth,
                today: cell.date === todayKey,
                selected: cell.date === selected,
                filled: dayEntries(cell.date).length > 0
              }"
              @click="pickDay(cell.date)"
            >
              <template v-if="dayEntries(cell.date).length">
                <!-- 封面拼图：1 张铺满 / 2 张左右 / 3 张上二下一 / 4 张四角，超过显示 +N -->
                <div class="collage" :class="`g${Math.min(dayEntries(cell.date).length, 4)}`">
                  <div v-for="e in tileEntries(cell.date)" :key="e.kind + e.id" class="tile">
                    <img v-if="coverOf(e)" :src="toImgUrl(coverOf(e))" alt="" />
                  </div>
                </div>
                <span v-if="cell.date === todayKey" class="today-dot"></span>
                <span class="day-pill" :class="{ today: cell.date === todayKey }">{{ cell.day }}</span>
                <span
                  v-if="dayEntries(cell.date).length > 4"
                  class="more-badge"
                  :style="{ background: typeColor(dayEntries(cell.date)[0].kind) }"
                >+{{ dayEntries(cell.date).length - 4 }}</span>
              </template>
              <span v-else class="day-num" :class="{ today: cell.date === todayKey }">{{ cell.day }}</span>
            </div>
          </template>
        </div>
      </NSpin>
    </div>

    <!-- 点击日期弹窗显示当天内容 -->
    <NModal v-model:show="dayModalShow" :auto-focus="false" mask-closable>
      <div class="day-modal">
        <div class="detail-head">
          <span class="detail-date">{{ selectedTitle }}</span>
          <span class="detail-count">{{ selectedEntries.length }} 条记录</span>
        </div>
        <NEmpty
          v-if="!selectedEntries.length && !loading"
          description="这一天还没有记录"
          class="detail-empty"
        />
        <div v-else class="detail-list">
          <button
            v-for="e in selectedEntries"
            :key="e.kind + e.id"
            type="button"
            class="detail-row"
            :title="e.title"
            @click="openEntry(e)"
          >
            <span class="thumb">
              <img v-if="e.coverPath" :src="toImgUrl(e.coverPath)" alt="" />
              <span v-else class="thumb-fallback"></span>
            </span>
            <span class="row-body">
              <span class="row-title">{{ e.title }}</span>
              <span class="row-meta">
                <span class="kind-dot" :style="{ background: typeColor(e.kind) }"></span>
                <span class="kind-text">{{ typeLabel(e.kind) }}</span>
                <NTag size="tiny" round :bordered="false" class="status-tag">{{ labelOf(e) }}</NTag>
              </span>
            </span>
            <span class="row-chevron">›</span>
          </button>
        </div>
      </div>
    </NModal>

    <MovieDetailModal v-if="detailKind === 'movie'" v-model:show="detailShow" :id="detailId" @changed="load" />
    <BookDetailModal v-else-if="detailKind === 'book'" v-model:show="detailShow" :id="detailId" @changed="load" />
    <GameDetailModal v-else-if="detailKind === 'game'" v-model:show="detailShow" :id="detailId" @changed="load" />
  </div>
</template>

<style scoped>
.page {
  padding: 18px 24px 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.title {
  font-size: 18px;
  font-weight: 700;
  color: #1f2329;
  margin: 0;
}
/* 分段控件 */
.mode-switch {
  display: inline-flex;
  background: #f2f4f8;
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}
.seg {
  border: none;
  background: transparent;
  font-size: 12.5px;
  color: #6b7180;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    box-shadow 0.15s;
}
.seg.on {
  background: #fff;
  color: #1f2329;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(31, 35, 41, 0.12);
}

/* 日历玻璃卡：占满页面剩余高度，网格内部均分，不出现页面滚动条 */
.cal-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 14px 16px 16px;
}
.cal-spin {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cal-spin :deep(.n-spin-container),
.cal-spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nav-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: rgba(242, 244, 248, 0.9);
  color: #5b616c;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.nav-btn:hover {
  background: #e7eaf1;
}
.month {
  font-size: 16px;
  font-weight: 700;
  color: #1f2329;
  letter-spacing: 0.3px;
  min-width: 140px;
  text-align: center;
}
.today-btn {
  margin-left: 4px;
}
.count {
  font-size: 12.5px;
  color: #9aa0ac;
}

/* 行高按卡片剩余高度平分：(100% - 周标题行 - 行距总和) / 当月周数 */
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: 26px repeat(var(--rows, 5), minmax(0, 1fr));
  gap: 6px;
}
.week-head {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: rgba(31, 35, 41, 0.4);
}
.cell {
  position: relative;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid transparent;
  background: #f7f8fa;
  cursor: pointer;
  /* 封面严格限制在格子内，后牌只在格内错位露边，不伸出 */
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    transform 0.12s;
}
.cell:hover {
  border-color: #dfe3ee;
  z-index: 2;
}
.cell.out {
  opacity: 0.45;
}
.cell.selected {
  border-color: #3b5bff;
  box-shadow: 0 0 0 2px rgba(59, 91, 255, 0.18);
  z-index: 3;
}
/* 封面格无背景，避免伸出的后牌下面露出灰底；层级高于空格，避免后牌被邻格灰底盖住 */
.cell.filled {
  background: transparent;
  z-index: 1;
}
.cell.today:not(.filled) {
  border-color: rgba(255, 213, 79, 0.7);
  background: rgba(255, 213, 79, 0.08);
}
.day-num {
  font-size: 13px;
  font-weight: 500;
  color: rgba(31, 35, 41, 0.42);
}
.day-num.today {
  color: #c99400;
  font-weight: 700;
}

/* 封面拼图：1 张铺满 / 2 张左右 / 3 张上二下一 / 4 张四角；超过 4 张显示 +N */
.collage {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 2px;
  padding: 2px;
  background: #fff;
}
.collage.g1 {
  grid: 1fr / 1fr;
}
.collage.g2 {
  grid: 1fr / 1fr 1fr;
}
.collage.g3,
.collage.g4 {
  grid: 1fr 1fr / 1fr 1fr;
}
/* 3 张：第三张占满下方整行 */
.collage.g3 .tile:last-child {
  grid-column: 1 / -1;
}
.tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 4px;
  background: #e9ecf2;
}
.collage.g1 .tile {
  border-radius: 10px;
}
.tile img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}
/* 单张时底部渐变，保证日期药丸可读 */
.collage.g1 .tile::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 28px;
  background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.5));
}
.day-pill {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 1px 7px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  pointer-events: none;
  z-index: 4;
}
.day-pill.today {
  color: #ffd54f;
}
.today-dot {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffd54f;
  border: 1px solid rgba(0, 0, 0, 0.2);
  z-index: 4;
}
.more-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 4;
  padding: 1px 6px;
  border-radius: 7px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

/* 当天记录弹窗 */
.day-modal {
  width: 440px;
  max-width: calc(100vw - 48px);
  max-height: 70vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(31, 35, 41, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}
.detail-date {
  font-size: 15px;
  font-weight: 700;
  color: #1f2329;
}
.detail-count {
  font-size: 11px;
  font-weight: 600;
  color: #3b5bff;
  background: rgba(59, 91, 255, 0.1);
  border-radius: 8px;
  padding: 2px 9px;
}
.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
}
.detail-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 12px;
  padding: 8px 8px;
  border: none;
  background: transparent;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
}
.detail-row + .detail-row {
  border-top: 1px solid rgba(31, 35, 41, 0.06);
}
.detail-row:hover {
  background: #f7f8fb;
}
.thumb {
  width: 46px;
  height: 62px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: #eef0f4;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.row-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kind-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.kind-text {
  font-size: 12px;
  color: rgba(31, 35, 41, 0.45);
}
.status-tag {
  margin-left: 2px;
}
.row-chevron {
  color: rgba(31, 35, 41, 0.25);
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}
.detail-empty {
  margin: 24px auto 28px;
}
</style>
