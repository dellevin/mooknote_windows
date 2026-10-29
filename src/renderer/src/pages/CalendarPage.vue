<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NRadioGroup, NRadio, NEmpty, NSpin, NTag, NTooltip } from 'naive-ui'
import type { CalendarEntry } from '@shared/types'
import {
  MOVIE_STATUS_LABELS,
  BOOK_STATUS_LABELS,
  GAME_STATUS_LABELS
} from '@shared/types'
import { toImgUrl } from '@/utils/image'

const loading = ref(false)
const mode = ref<0 | 1>(1)
const entries = ref<CalendarEntry[]>([])
const cursor = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

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
  const prefix = cursor.value.toISOString().slice(0, 7)
  return entries.value.filter((e) => e.date.startsWith(prefix)).length
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

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = await window.mook.stats.calendar(mode.value)
  } finally {
    loading.value = false
  }
}
function changeMode(v: 0 | 1): void {
  mode.value = v
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
}
function kindColor(k: CalendarEntry['kind']): string {
  return k === 'movie' ? '#3b5bff' : k === 'book' ? '#16a34a' : '#ea580c'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="title">日历</h2>
      <div class="tools">
        <NRadioGroup v-model:value="mode" size="small" @update:value="changeMode">
          <NRadio :value="1">观看 / 阅读 / 通关</NRadio>
          <NRadio :value="0">添加日期</NRadio>
        </NRadioGroup>
      </div>
    </div>

    <div class="cal-head">
      <div class="nav">
        <NButton size="small" quaternary @click="prevMonth">‹</NButton>
        <span class="month">{{ monthLabel }}</span>
        <NButton size="small" quaternary @click="nextMonth">›</NButton>
        <NButton size="small" quaternary @click="goToday">今天</NButton>
      </div>
      <span class="count">本月 {{ monthCount }} 条记录</span>
    </div>

    <NSpin :show="loading">
      <div class="grid">
        <div v-for="w in WEEK" :key="w" class="week-head">{{ w }}</div>
        <template v-for="cell in cells" :key="cell.date">
          <div class="cell" :class="{ out: !cell.inMonth, today: cell.date === keyOf(new Date()) }">
            <div class="day">{{ cell.day }}</div>
            <div class="events">
              <NTooltip v-for="e in (byDate.get(cell.date) ?? []).slice(0, 3)" :key="e.kind + e.id">
                <template #trigger>
                  <div class="event">
                    <img v-if="e.coverPath" :src="toImgUrl(e.coverPath)" />
                    <span class="dot" :style="{ background: kindColor(e.kind) }"></span>
                    <span class="ev-title">{{ e.title }}</span>
                  </div>
                </template>
                <div>
                  <strong>{{ e.title }}</strong>
                  <br />
                  <NTag size="tiny" :bordered="false">{{ labelOf(e) }}</NTag>
                  <span v-if="e.note" style="margin-left: 6px">{{ e.note }}</span>
                </div>
              </NTooltip>
              <div
                v-if="(byDate.get(cell.date) ?? []).length > 3"
                class="more"
              >
                +{{ (byDate.get(cell.date) ?? []).length - 3 }}
              </div>
            </div>
          </div>
        </template>
      </div>
      <NEmpty v-if="!entries.length && !loading" description="该模式下还没有日期记录" class="empty" />
    </NSpin>
  </div>
</template>

<style scoped>
.page {
  padding: 18px 24px 28px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  font-size: 18px;
  color: #1f2329;
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
.month {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  min-width: 130px;
  text-align: center;
}
.count {
  font-size: 12.5px;
  color: #9aa0ac;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.week-head {
  text-align: center;
  font-size: 12.5px;
  color: #8a909c;
  padding: 4px 0;
}
.cell {
  min-height: 104px;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
}
.cell.out {
  background: #fafbfc;
  opacity: 0.5;
}
.cell.today {
  border-color: #3b5bff;
}
.day {
  font-size: 12px;
  color: #9aa0ac;
  margin-bottom: 4px;
}
.today .day {
  color: #3b5bff;
  font-weight: 700;
}
.events {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.event {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #3f444d;
  cursor: default;
  overflow: hidden;
}
.event img {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: cover;
  flex-shrink: 0;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ev-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.more {
  font-size: 11px;
  color: #9aa0ac;
  padding-left: 2px;
}
.empty {
  margin-top: 60px;
}
</style>
