<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NButton, NSpace, NRate, NTag, NImage, NImageGroup, NPopconfirm } from 'naive-ui'
import type {
  CustomFieldDef,
  CustomFieldType,
  CustomModuleDesign,
  CustomModuleItem,
  CustomFieldValue
} from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import ModuleIcon from './ModuleIcon.vue'

const props = defineProps<{
  show: boolean
  design: CustomModuleDesign | null
  item: CustomModuleItem | null
  moduleIcon?: string | null
}>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'edit', item: CustomModuleItem): void
  (e: 'delete', item: CustomModuleItem): void
}>()

function val(key: string): CustomFieldValue {
  return props.item?.data[key] ?? null
}

function isEmpty(f: { type: string; key: string }): boolean {
  const v = val(f.key)
  if (v == null) return true
  if (typeof v === 'string') return !v.trim()
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('current' in o && 'total' in o) return !o.current && !o.total
    if ('start' in o && 'end' in o) return !o.start && !o.end
  }
  return false
}

const fields = computed<CustomFieldDef[]>(() =>
  (props.design?.fields ?? []).filter((f) => !isEmpty(f))
)
const posterField = computed<CustomFieldDef | null>(() =>
  fields.value.find((f) => f.type === 'poster') ?? null
)
const posterUrl = computed<string | null>(() =>
  posterField.value ? (val(posterField.value.key) as string | null) : null
)

// 摘要型字段（进入两列信息网格）
const INLINE: CustomFieldType[] = [
  'text',
  'multiText',
  'status',
  'rating',
  'count',
  'date',
  'duration',
  'progress',
  'dateRange'
]
const HALF: CustomFieldType[] = ['text', 'date', 'count', 'duration', 'progress', 'dateRange']
const halfCapable = (f: CustomFieldDef): boolean => f.halfWidth && HALF.includes(f.type)
// 整行内容区块
const BLOCK: CustomFieldType[] = ['longText', 'multiImage']

type Section =
  | { kind: 'grid'; rows: CustomFieldDef[][] }
  | { kind: 'block'; field: CustomFieldDef }

const sections = computed<Section[]>(() => {
  const out: Section[] = []
  let buf: CustomFieldDef[] = []
  const flush = (): void => {
    if (!buf.length) return
    // 相邻两个半行字段并排
    const rows: CustomFieldDef[][] = []
    let i = 0
    while (i < buf.length) {
      if (halfCapable(buf[i]) && i + 1 < buf.length && halfCapable(buf[i + 1])) {
        rows.push([buf[i], buf[i + 1]])
        i += 2
      } else {
        rows.push([buf[i]])
        i++
      }
    }
    out.push({ kind: 'grid', rows })
    buf = []
  }
  for (const f of fields.value) {
    if (f.type === 'poster') continue
    if (BLOCK.includes(f.type)) {
      flush()
      out.push({ kind: 'block', field: f })
    } else if (INLINE.includes(f.type)) {
      buf.push(f)
    }
  }
  flush()
  return out
})

const statusField = computed<CustomFieldDef | null>(
  () => fields.value.find((f) => f.type === 'status') ?? null
)
const ratingField = computed<CustomFieldDef | null>(
  () => fields.value.find((f) => f.type === 'rating') ?? null
)
const statusVal = computed<string | null>(() =>
  statusField.value ? (val(statusField.value.key) as string | null) : null
)
const ratingVal = computed<number>(() =>
  ratingField.value ? Number(val(ratingField.value.key) ?? 0) : 0
)

function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} 小时 ${m} 分` : `${m} 分钟`
}
function isoDate(s: unknown): string {
  return typeof s === 'string' && s ? formatDate(s) : ''
}
function progressPct(v: unknown): number {
  const o = v as { current?: number; total?: number } | null
  if (!o || !o.total) return 0
  return Math.min(100, Math.round(((o.current ?? 0) / o.total) * 100))
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div v-if="item" class="detail">
      <!-- 头部：海报 + 标题摘要 -->
      <header class="d-head">
        <div class="d-poster">
          <img v-if="posterUrl" :src="toImgUrl(posterUrl)" alt="封面" />
          <div v-else class="d-poster-empty">
            <ModuleIcon :icon="moduleIcon ?? null" :size="34" />
          </div>
        </div>
        <div class="d-head-main">
          <h2 class="d-title">{{ item.title || '无标题条目' }}</h2>
          <div class="d-summary">
            <NTag v-if="statusVal" size="small" type="info" :bordered="false" round>
              {{ statusVal }}
            </NTag>
            <div v-if="ratingField" class="d-rating">
              <NRate :value="ratingVal" readonly allow-half size="small" />
              <span v-if="ratingVal" class="d-rating-num">{{ ratingVal.toFixed(1) }}</span>
            </div>
          </div>
          <div class="d-meta">更新于 {{ formatDate(item.updatedAt) }}</div>
          <div class="d-actions">
            <NButton size="small" type="primary" @click="emit('edit', item)">编辑条目</NButton>
            <NPopconfirm to="body" @positive-click="emit('delete', item)">
              <template #trigger>
                <NButton size="small" type="error" quaternary>移入回收站</NButton>
              </template>
              确定将「{{ item.title || '无标题条目' }}」移入回收站吗？
            </NPopconfirm>
          </div>
        </div>
      </header>

      <!-- 内容 -->
      <div class="d-body">
        <template v-for="(sec, si) in sections" :key="si">
          <!-- 摘要信息网格 -->
          <div v-if="sec.kind === 'grid'" class="info-grid">
            <template v-for="(row, ri) in sec.rows" :key="ri">
              <div
                v-for="f in row"
                :key="f.key"
                class="info-cell"
                :class="{
                  wide: row.length === 1 && !halfCapable(f),
                  'half-left': row.length === 1 && halfCapable(f) && f.halfOnLeft,
                  'half-right': row.length === 1 && halfCapable(f) && !f.halfOnLeft
                }"
              >
                <div class="info-label">
                  <ModuleIcon v-if="f.icon" :icon="f.icon" :size="12" class="info-ic" />
                  <span>{{ f.label }}</span>
                </div>
                <div class="info-val">
                  <template v-if="f.type === 'multiText'">
                    <div class="tag-row">
                      <NTag
                        v-for="t in (val(f.key) as string[])"
                        :key="t"
                        size="small"
                        :bordered="false"
                      >
                        {{ t }}
                      </NTag>
                    </div>
                  </template>
                  <template v-else-if="f.type === 'status'">
                    <NTag size="small" type="info" :bordered="false">{{ val(f.key) }}</NTag>
                  </template>
                  <template v-else-if="f.type === 'rating'">
                    <NRate
                      :value="(val(f.key) as number) ?? 0"
                      readonly
                      allow-half
                      size="small"
                    />
                  </template>
                  <template v-else-if="f.type === 'count'">
                    <span class="num-strong">{{ val(f.key) }}</span> 次
                  </template>
                  <template v-else-if="f.type === 'date'">{{ isoDate(val(f.key)) }}</template>
                  <template v-else-if="f.type === 'duration'">
                    {{ durationText(val(f.key) as number) }}
                  </template>
                  <template v-else-if="f.type === 'progress'">
                    <div class="prog">
                      <div class="prog-bar">
                        <div class="prog-fill" :style="{ width: progressPct(val(f.key)) + '%' }" />
                      </div>
                      <span class="prog-tx">
                        {{ (val(f.key) as any).current }} / {{ (val(f.key) as any).total }}
                      </span>
                    </div>
                  </template>
                  <template v-else-if="f.type === 'dateRange'">
                    {{ isoDate((val(f.key) as any).start) }} ~
                    {{ isoDate((val(f.key) as any).end) }}
                  </template>
                  <template v-else>{{ val(f.key) }}</template>
                </div>
              </div>
            </template>
          </div>

          <!-- 长文本 -->
          <section v-else-if="sec.field.type === 'longText'" class="content-block">
            <div class="block-label">
              <ModuleIcon v-if="sec.field.icon" :icon="sec.field.icon" :size="12" class="info-ic" />
              <span>{{ sec.field.label }}</span>
            </div>
            <p class="longtext">{{ val(sec.field.key) }}</p>
          </section>

          <!-- 多图 -->
          <section v-else class="content-block">
            <div class="block-label">
              <ModuleIcon v-if="sec.field.icon" :icon="sec.field.icon" :size="12" class="info-ic" />
              <span>{{ sec.field.label }}</span>
              <span class="block-count">{{ (val(sec.field.key) as string[]).length }} 张</span>
            </div>
            <NImageGroup>
              <div class="img-grid">
                <NImage
                  v-for="img in (val(sec.field.key) as string[])"
                  :key="img"
                  :src="toImgUrl(img)"
                  object-fit="cover"
                  class="thumb"
                />
              </div>
            </NImageGroup>
          </section>
        </template>
      </div>

      <footer class="d-foot">
        <NButton size="small" @click="emit('update:show', false)">关闭</NButton>
      </footer>
    </div>
  </NModal>
</template>

<style scoped>
.detail {
  width: 780px;
  max-width: 94vw;
  max-height: 88vh;
  background: var(--surface);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--fluent-shadow);
}

/* 头部 */
.d-head {
  display: flex;
  gap: 20px;
  padding: 20px 22px 18px;
  border-bottom: 1px solid var(--fluent-stroke);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-bg) 70%, var(--surface)) 0%,
    var(--surface) 100%
  );
}
.d-poster {
  flex-shrink: 0;
}
.d-poster img,
.d-poster-empty {
  width: 124px;
  height: 166px;
  border-radius: 8px;
  display: block;
}
.d-poster img {
  object-fit: cover;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
}
.d-poster-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  background: var(--app-bg);
  border: 1px dashed var(--stroke-strong);
}
.d-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.d-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-strong);
  line-height: 1.35;
  margin: 2px 0 10px;
  word-break: break-all;
}
.d-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}
.d-rating {
  display: flex;
  align-items: center;
  gap: 6px;
}
.d-rating-num {
  font-size: 13px;
  font-weight: 600;
  color: #c98a00;
}
.d-meta {
  font-size: 12px;
  color: var(--text-dim);
}
.d-actions {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

/* 主体 */
.d-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 22px 20px;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin-bottom: 14px;
}
.info-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 12px;
  background: var(--app-bg);
  border: 1px solid var(--fluent-stroke);
  border-radius: 7px;
}
.info-cell.wide {
  grid-column: 1 / -1;
}
.info-cell.half-left {
  grid-column: 1;
}
.info-cell.half-right {
  grid-column: 2;
}
.info-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-dim);
}
.info-ic {
  opacity: 0.75;
}
.info-val {
  font-size: 13.5px;
  color: var(--text-strong);
  min-height: 20px;
  display: flex;
  align-items: center;
}
.num-strong {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-strong);
  margin-right: 2px;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

/* 进度条 */
.prog {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.prog-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--rail-item-hover);
  overflow: hidden;
}
.prog-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.3s var(--fluent-ease);
}
.prog-tx {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-dim);
}

/* 整行区块 */
.content-block {
  margin-bottom: 16px;
}
.block-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
.block-count {
  font-weight: 400;
  color: var(--text-dim);
}
.longtext {
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 12px 14px;
  background: var(--app-bg);
  border: 1px solid var(--fluent-stroke);
  border-radius: 7px;
}
.img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 92px);
  gap: 8px;
}
.thumb {
  width: 92px;
  height: 92px;
  border-radius: 7px;
}

/* 底部 */
.d-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 12px 22px;
  border-top: 1px solid var(--fluent-stroke);
  background: color-mix(in srgb, var(--app-bg) 55%, var(--surface));
}
</style>
