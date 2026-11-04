<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NSwitch, NEmpty, useMessage } from 'naive-ui'
import {
  faImage,
  faFlag,
  faStar,
  faHashtag,
  faFont,
  faListUl,
  faCalendar,
  faAlignLeft,
  faClock,
  faHourglassHalf,
  faCalendarDays,
  faImages,
  type IconDefinition
} from '@fortawesome/free-solid-svg-icons'
import type {
  CustomFieldDef,
  CustomFieldType,
  CustomModuleDesign
} from '@shared/types'
import { plain } from '@/utils/image'
import { CUSTOM_MODULE_ICONS, iconValue } from '@/utils/customIcons'
import ModuleIcon from './ModuleIcon.vue'
import FaGlyph from './FaGlyph.vue'
import FieldPreview from './FieldPreview.vue'

const props = defineProps<{
  moduleId: string
  design: CustomModuleDesign | null // null = 新建设计
}>()
const emit = defineEmits<{
  (e: 'saved', design: CustomModuleDesign): void
  (e: 'cancel'): void
}>()

const message = useMessage()
const id = ref('')
const name = ref('')
const fields = ref<CustomFieldDef[]>([])
const isNew = ref(true)
const saving = ref(false)

// ─── 字段类型元信息 ───
const SINGLETON: CustomFieldType[] = ['poster', 'status', 'rating', 'count']
const TEXT_TYPES: CustomFieldType[] = ['text', 'multiText', 'longText']
const HALF_TYPES: CustomFieldType[] = [
  'text',
  'multiText',
  'date',
  'count',
  'duration',
  'progress',
  'dateRange'
]

interface TypeMeta {
  type: CustomFieldType
  label: string
  desc: string
  icon: IconDefinition
  defLabel: string
}
const TYPE_METAS: TypeMeta[] = [
  { type: 'poster', label: '封面图', desc: '导入一张封面图', icon: faImage, defLabel: '封面' },
  { type: 'status', label: '状态', desc: '自定义状态选项（如 想看/在看/看过）', icon: faFlag, defLabel: '状态' },
  { type: 'rating', label: '评分', desc: '星级评分', icon: faStar, defLabel: '评分' },
  { type: 'count', label: '次数', desc: '次数统计（加减号控制）', icon: faHashtag, defLabel: '次数' },
  { type: 'text', label: '单行文本', desc: '一行短文本（如 名称）', icon: faFont, defLabel: '名称' },
  { type: 'multiText', label: '多行标签', desc: '多个文本条目（如 导演、编剧）', icon: faListUl, defLabel: '标签' },
  { type: 'date', label: '日期', desc: '选择一个日期', icon: faCalendar, defLabel: '时间' },
  { type: 'longText', label: '长文本', desc: '多行长文本（如 简介）', icon: faAlignLeft, defLabel: '简介' },
  { type: 'duration', label: '时长', desc: '以分钟记录时长（如 影视总时长）', icon: faClock, defLabel: '时长' },
  { type: 'progress', label: '进度', desc: '当前/总量进度（如 看到 12/24 集）', icon: faHourglassHalf, defLabel: '进度' },
  { type: 'dateRange', label: '日期区间', desc: '开始 ~ 结束日期', icon: faCalendarDays, defLabel: '起止日期' },
  { type: 'multiImage', label: '多图', desc: '导入多张图片', icon: faImages, defLabel: '多图' }
]
interface PaletteGroup {
  title: string
  types: CustomFieldType[]
}
const PALETTE: PaletteGroup[] = [
  { title: '基础字段', types: ['poster', 'status', 'rating', 'count'] },
  { title: '文本字段', types: ['text', 'multiText', 'longText'] },
  { title: '时间与进度', types: ['date', 'duration', 'progress', 'dateRange'] },
  { title: '媒体', types: ['multiImage'] }
]
const metaOf = (t: CustomFieldType): TypeMeta =>
  TYPE_METAS.find((m) => m.type === t) ?? TYPE_METAS[0]
const halfCapable = (t: CustomFieldType): boolean => HALF_TYPES.includes(t)
const pairable = (f: CustomFieldDef): boolean => f.halfWidth && halfCapable(f.type)
const singletonUsed = (t: CustomFieldType): boolean =>
  SINGLETON.includes(t) && fields.value.some((f) => f.type === t)

watch(
  () => [props.moduleId, props.design] as const,
  async ([, design]) => {
    if (design) {
      isNew.value = false
      id.value = design.id
      name.value = design.name
      fields.value = design.fields.map((f) => ({
        ...f,
        label: f.label.trim() || metaOf(f.type).defLabel || metaOf(f.type).label,
        options: [...f.options]
      }))
    } else {
      isNew.value = true
      id.value = await window.mook.customDesign.newId()
      name.value = ''
      fields.value = []
    }
    selectedKey.value = null
  },
  { immediate: true }
)

// ─── 创建字段 ───
function createField(t: CustomFieldType): CustomFieldDef {
  const meta = metaOf(t)
  return {
    key: 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8),
    type: t,
    label: meta.defLabel,
    required: false,
    options: t === 'status' ? ['想看', '在看', '看过'] : [],
    isTitle: false,
    halfWidth: false,
    halfOnLeft: true,
    icon: ''
  }
}
function appendField(t: CustomFieldType, select = true): void {
  if (singletonUsed(t)) return
  const f = createField(t)
  fields.value.push(f)
  if (select) selectedKey.value = f.key
}

// ─── 选中 / 属性面板（直接编辑） ───
const selectedKey = ref<string | null>(null)
const sel = computed<CustomFieldDef | null>(
  () => fields.value.find((f) => f.key === selectedKey.value) ?? null
)
function selectField(f: CustomFieldDef): void {
  selectedKey.value = f.key
}
watch(fields, (list: CustomFieldDef[]) => {
  if (selectedKey.value && !list.some((f) => f.key === selectedKey.value)) {
    selectedKey.value = null
  }
})
function toggleTitle(on: boolean): void {
  if (!sel.value) return
  sel.value.isTitle = on
  if (on) for (const f of fields.value) if (f.key !== sel.value!.key) f.isTitle = false
}
function deleteSelected(): void {
  const k = selectedKey.value
  if (!k) return
  fields.value = fields.value.filter((f) => f.key !== k)
  selectedKey.value = null
}
const optionInput = ref('')
function addOption(): void {
  const v = optionInput.value.trim()
  if (!v || !sel.value || sel.value.options.includes(v)) return
  sel.value.options.push(v)
  optionInput.value = ''
}
function removeOption(o: string): void {
  if (!sel.value) return
  sel.value.options = sel.value.options.filter((x) => x !== o)
}

// ─── 半行分组（相邻两个半行字段并排） ───
type Row = CustomFieldDef[]
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  let i = 0
  while (i < fields.value.length) {
    if (
      pairable(fields.value[i]) &&
      i + 1 < fields.value.length &&
      pairable(fields.value[i + 1])
    ) {
      out.push([fields.value[i], fields.value[i + 1]])
      i += 2
    } else {
      out.push([fields.value[i]])
      i++
    }
  }
  return out
})
// 每行在扁平 fields 中的起始下标（缝隙落点用）
const starts = computed<number[]>(() => {
  const s: number[] = []
  let acc = 0
  for (const r of rows.value) {
    s.push(acc)
    acc += r.length
  }
  return s
})

// ─── 拖拽排序（画布内 / 字段库拖入） ───
const dragKey = ref<string | null>(null)
const paletteType = ref<CustomFieldType | null>(null)
const gapOver = ref<number | null>(null)
const fieldOver = ref<string | null>(null)
const slotOver = ref<string | null>(null)
const dragging = computed<boolean>(() => !!(dragKey.value || paletteType.value))

function onDragStart(e: DragEvent, f: CustomFieldDef): void {
  dragKey.value = f.key
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', f.key)
  }
}
function onPaletteDragStart(e: DragEvent, t: CustomFieldType): void {
  if (singletonUsed(t)) {
    e.preventDefault()
    return
  }
  paletteType.value = t
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', 'palette:' + t)
  }
}
function onDragEnd(): void {
  dragKey.value = null
  paletteType.value = null
  gapOver.value = null
  fieldOver.value = null
  slotOver.value = null
}
function draggedField(): CustomFieldDef | undefined {
  return fields.value.find((f) => f.key === dragKey.value)
}
function applyInsert(list: CustomFieldDef[], index: number, moved: CustomFieldDef): void {
  list.splice(Math.min(index, list.length), 0, moved)
}
function dropGap(index: number): void {
  // 字段库拖入
  if (paletteType.value) {
    const list = [...fields.value]
    applyInsert(list, index, createField(paletteType.value))
    fields.value = list
    onDragEnd()
    return
  }
  const d = draggedField()
  if (!d) return
  const list = fields.value.filter((f) => f.key !== d.key)
  let idx = index
  const from = fields.value.findIndex((f) => f.key === d.key)
  if (from < idx) idx--
  applyInsert(list, idx, { ...d, halfWidth: false })
  fields.value = list
  onDragEnd()
}
function dropField(target: CustomFieldDef): void {
  // 字段库拖入
  if (paletteType.value) {
    const t = paletteType.value
    const list = [...fields.value]
    const idx = list.findIndex((f) => f.key === target.key)
    if (idx === -1) return
    const nf = createField(t)
    if (halfCapable(t) && halfCapable(target.type)) {
      nf.halfWidth = true
      if (!target.halfWidth) list[idx] = { ...target, halfWidth: true }
    }
    list.splice(idx, 0, nf)
    fields.value = list
    selectedKey.value = nf.key
    onDragEnd()
    return
  }
  const d = draggedField()
  if (!d || d.key === target.key) return
  const list = fields.value.filter((f) => f.key !== d.key)
  const idx = list.findIndex((f) => f.key === target.key)
  if (idx === -1) return
  let moved: CustomFieldDef = d
  if (halfCapable(d.type) && halfCapable(target.type)) {
    moved = { ...d, halfWidth: true }
    if (!target.halfWidth) list[idx] = { ...target, halfWidth: true }
  } else if (d.halfWidth) {
    moved = { ...d, halfWidth: false }
  }
  list.splice(idx, 0, moved)
  fields.value = list
  onDragEnd()
}
function dropSlot(target: CustomFieldDef): void {
  // 字段库拖入半行空位
  if (paletteType.value) {
    const t = paletteType.value
    if (!halfCapable(t)) {
      onDragEnd()
      return
    }
    const list = [...fields.value]
    const idx = list.findIndex((f) => f.key === target.key)
    if (idx === -1) return
    const nf = { ...createField(t), halfWidth: true }
    if (!target.halfWidth) list[idx] = { ...target, halfWidth: true }
    list.splice(target.halfOnLeft ? idx + 1 : idx, 0, nf)
    fields.value = list
    selectedKey.value = nf.key
    onDragEnd()
    return
  }
  const d = draggedField()
  if (!d || d.key === target.key) return
  const list = fields.value.filter((f) => f.key !== d.key)
  const idx = list.findIndex((f) => f.key === target.key)
  if (idx === -1) return
  list.splice(target.halfOnLeft ? idx + 1 : idx, 0, { ...d, halfWidth: true })
  fields.value = list
  onDragEnd()
}
function toggleSide(f: CustomFieldDef): void {
  const idx = fields.value.findIndex((x) => x.key === f.key)
  if (idx !== -1) fields.value[idx] = { ...f, halfOnLeft: !f.halfOnLeft }
}
function onSlotOver(f: CustomFieldDef): void {
  if (paletteType.value) {
    if (halfCapable(paletteType.value)) slotOver.value = f.key
    return
  }
  const d = draggedField()
  if (d && d.key !== f.key && halfCapable(d.type)) slotOver.value = f.key
}
function gapDragOver(index: number): void {
  if (dragging.value) gapOver.value = index
}
function fieldDragOver(f: CustomFieldDef): void {
  if (dragging.value && dragKey.value !== f.key) fieldOver.value = f.key
}

// ─── 保存 ───
async function save(): Promise<void> {
  const designName = name.value.trim()
  if (!designName) {
    message.warning('请填写设计名称')
    return
  }
  if (!fields.value.length) {
    message.warning('请至少添加一个字段')
    return
  }
  // 空名称字段自动补上该类型的默认名称
  for (const f of fields.value) {
    if (!f.label.trim()) f.label = metaOf(f.type).defLabel || metaOf(f.type).label
    if (f.type === 'status' && !f.options.length) {
      selectedKey.value = f.key
      message.warning(`「${f.label}」至少需要一个状态选项`)
      return
    }
  }
  // 标题兜底：无标题字段时取第一个文本字段
  if (!fields.value.some((f) => f.type === 'text' && f.isTitle)) {
    const first = fields.value.find((f) => f.type === 'text')
    if (first) first.isTitle = true
  }
  saving.value = true
  try {
    const saved = await window.mook.customDesign.save(
      plain({
        id: id.value,
        moduleId: props.moduleId,
        name: designName,
        fields: fields.value
      }),
      isNew.value
    )
    emit('saved', saved)
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="designer">
    <!-- 顶部命令栏 -->
    <header class="cmdbar">
      <button type="button" class="cmd-back" @click="emit('cancel')">
        <span class="back-ic">‹</span>
        <span>返回</span>
      </button>
      <div class="cmd-divider" />
      <span class="cmd-title">表单设计</span>
      <NInput
        v-model:value="name"
        placeholder="设计名称（如：默认设计）"
        size="small"
        class="name-input"
      />
      <span class="field-count">{{ fields.length }} 个字段</span>
      <div class="cmd-right">
        <NButton size="small" @click="emit('cancel')">取消</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="save">保存设计</NButton>
      </div>
    </header>

    <div class="body">
      <!-- 左：字段库 -->
      <aside class="pane palette">
        <div class="pane-head">
          <span class="pane-title">字段库</span>
          <span class="pane-sub">点击或拖入画布</span>
        </div>
        <div class="pane-scroll">
          <div v-for="g in PALETTE" :key="g.title" class="pal-group">
            <div class="pal-group-tx">{{ g.title }}</div>
            <button
              v-for="t in g.types"
              :key="t"
              type="button"
              class="pal-item"
              :disabled="singletonUsed(t)"
              :title="metaOf(t).desc"
              draggable="true"
              @dragstart="onPaletteDragStart($event, t)"
              @dragend="onDragEnd"
              @click="appendField(t)"
            >
              <span class="pal-ic"><FaGlyph :def="metaOf(t).icon" :size="14" /></span>
              <span class="pal-meta">
                <span class="pal-name">{{ metaOf(t).label }}</span>
                <span class="pal-desc">{{
                  singletonUsed(t) ? '已添加（仅可一个）' : metaOf(t).desc
                }}</span>
              </span>
            </button>
          </div>
        </div>
      </aside>

      <!-- 中：画布 -->
      <main class="canvas-wrap">
        <div class="canvas-scroll">
          <!-- 空状态 -->
          <div v-if="!fields.length" class="drop-empty">
            <div class="empty-card">
              <NEmpty description="从左侧字段库拖入字段，开始设计表单">
                <template #extra>
                  <span class="empty-tip">支持拖动调整顺序 · 两个半行字段可并排</span>
                </template>
              </NEmpty>
            </div>
          </div>

          <!-- 表单纸 -->
          <div v-else class="sheet">
            <div class="sheet-head">
              <span class="sheet-title">{{ name || '未命名设计' }}</span>
              <span class="sheet-sub">表单预览 · 点击字段可在右侧编辑</span>
            </div>

            <template v-for="(row, ri) in rows" :key="starts[ri]">
              <!-- 行前缝隙 -->
              <div
                class="gap"
                :class="{ on: gapOver === starts[ri] }"
                @dragover.prevent="gapDragOver(starts[ri])"
                @dragleave="gapOver = null"
                @drop.prevent="dropGap(starts[ri])"
              />
              <div class="row" :class="{ pair: row.length === 2 }">
                <template v-for="f in row" :key="f.key">
                  <!-- 单个半行字段：卡片 + 虚框占位（点击占位切换左右） -->
                  <template v-if="row.length === 1 && pairable(f)">
                    <template v-if="f.halfOnLeft">
                      <div
                        class="field-card"
                        :class="{
                          dragging: dragKey === f.key,
                          over: fieldOver === f.key,
                          selected: selectedKey === f.key
                        }"
                        draggable="true"
                        @dragstart="onDragStart($event, f)"
                        @dragend="onDragEnd"
                        @dragover.prevent="fieldDragOver(f)"
                        @dragleave="fieldOver = null"
                        @drop.prevent="dropField(f)"
                        @click="selectField(f)"
                      >
                        <span class="drag-handle">⠿</span>
                        <FieldPreview :field="f" />
                      </div>
                      <div
                        class="half-slot"
                        :class="{ on: slotOver === f.key }"
                        @dragover.prevent="onSlotOver(f)"
                        @dragleave="slotOver = null"
                        @drop.prevent="dropSlot(f)"
                        @click="toggleSide(f)"
                        title="点击切换字段靠右侧；可拖入字段并排"
                      >
                        ＋
                      </div>
                    </template>
                    <template v-else>
                      <div
                        class="half-slot"
                        :class="{ on: slotOver === f.key }"
                        @dragover.prevent="onSlotOver(f)"
                        @dragleave="slotOver = null"
                        @drop.prevent="dropSlot(f)"
                        @click="toggleSide(f)"
                        title="点击切换字段靠左侧；可拖入字段并排"
                      >
                        ＋
                      </div>
                      <div
                        class="field-card"
                        :class="{
                          dragging: dragKey === f.key,
                          over: fieldOver === f.key,
                          selected: selectedKey === f.key
                        }"
                        draggable="true"
                        @dragstart="onDragStart($event, f)"
                        @dragend="onDragEnd"
                        @dragover.prevent="fieldDragOver(f)"
                        @dragleave="fieldOver = null"
                        @drop.prevent="dropField(f)"
                        @click="selectField(f)"
                      >
                        <span class="drag-handle">⠿</span>
                        <FieldPreview :field="f" />
                      </div>
                    </template>
                  </template>

                  <!-- 普通字段（整行或成对半行） -->
                  <div
                    v-else
                    class="field-card"
                    :class="{
                      dragging: dragKey === f.key,
                      over: fieldOver === f.key,
                      selected: selectedKey === f.key
                    }"
                    draggable="true"
                    @dragstart="onDragStart($event, f)"
                    @dragend="onDragEnd"
                    @dragover.prevent="fieldDragOver(f)"
                    @dragleave="fieldOver = null"
                    @drop.prevent="dropField(f)"
                    @click="selectField(f)"
                  >
                    <span class="drag-handle">⠿</span>
                    <FieldPreview :field="f" />
                  </div>
                </template>
              </div>
            </template>
            <!-- 末尾缝隙 -->
            <div
              class="gap"
              :class="{ on: gapOver === fields.length }"
              @dragover.prevent="gapDragOver(fields.length)"
              @dragleave="gapOver = null"
              @drop.prevent="dropGap(fields.length)"
            />
          </div>
        </div>
      </main>

      <!-- 右：属性 -->
      <aside class="pane props">
        <template v-if="sel">
          <div class="pane-head">
            <span class="pane-title">字段属性</span>
            <span class="pane-tag">{{ metaOf(sel.type).label }}</span>
          </div>
          <div class="pane-scroll">
            <div class="prop-sec">
              <label class="prop-lab">字段名称</label>
              <NInput v-model:value="sel.label" maxlength="10" show-count placeholder="字段名称" />
            </div>

            <div v-if="sel.type === 'text'" class="prop-row">
              <div class="prop-text">
                <span class="prop-lab">设为标题</span>
                <span class="prop-sub">列表页以此字段作为条目标题</span>
              </div>
              <NSwitch :value="sel.isTitle" @update:value="toggleTitle" />
            </div>

            <div v-if="TEXT_TYPES.includes(sel.type)" class="prop-row">
              <div class="prop-text">
                <span class="prop-lab">必填</span>
                <span class="prop-sub">新建条目时必须填写</span>
              </div>
              <NSwitch v-model:value="sel.required" />
            </div>

            <div v-if="halfCapable(sel.type)" class="prop-row">
              <div class="prop-text">
                <span class="prop-lab">半行显示</span>
                <span class="prop-sub">与相邻的半行字段并排为一行</span>
              </div>
              <NSwitch v-model:value="sel.halfWidth" />
            </div>

            <div v-if="sel.type === 'status'" class="prop-sec">
              <label class="prop-lab">状态选项</label>
              <div class="opt-chips">
                <span v-for="o in sel.options" :key="o" class="opt-chip">
                  {{ o }}
                  <button type="button" class="opt-x" @click="removeOption(o)">✕</button>
                </span>
              </div>
              <div class="opt-add">
                <NInput
                  v-model:value="optionInput"
                  size="small"
                  maxlength="8"
                  placeholder="新选项名称"
                  @keydown.enter.prevent="addOption"
                />
                <NButton size="small" @click="addOption">添加</NButton>
              </div>
            </div>

            <div v-if="sel.type !== 'poster'" class="prop-sec">
              <label class="prop-lab">字段图标</label>
              <div class="icon-grid">
                <button
                  v-for="d in CUSTOM_MODULE_ICONS"
                  :key="iconValue(d)"
                  type="button"
                  class="icon-cell"
                  :class="{ on: sel.icon === iconValue(d) }"
                  @click="sel.icon = sel.icon === iconValue(d) ? '' : iconValue(d)"
                >
                  <ModuleIcon :icon="iconValue(d)" :size="14" />
                </button>
              </div>
            </div>

            <div class="prop-delete">
              <NButton size="small" type="error" ghost block @click="deleteSelected">
                删除该字段
              </NButton>
            </div>
          </div>
        </template>

        <div v-else class="pane-head">
          <span class="pane-title">字段属性</span>
        </div>
        <div v-if="!sel" class="props-empty">
          <p>在画布中点击任一字段，即可在此编辑名称、必填、半行显示、图标等属性。</p>
          <ul>
            <li>拖动字段卡片调整排列顺序</li>
            <li>拖到另一字段上可并排为半行</li>
            <li>拖到行缝隙则独占一行</li>
            <li>也可直接从左侧字段库拖入</li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.designer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

/* ─── 顶部命令栏 ─── */
.cmdbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--fluent-stroke);
  background: var(--surface);
}
.cmd-back {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 12px 0 8px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--fluent-stroke);
  border-radius: 5px;
  cursor: pointer;
  transition:
    background-color var(--d1) var(--fluent-ease),
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease);
}
.cmd-back:hover {
  color: var(--text-strong);
  background: var(--tb-btn-hover-bg);
  border-color: var(--stroke-strong);
}
.back-ic {
  font-size: 18px;
  line-height: 1;
  font-weight: 500;
  margin-top: -1px;
}
.cmd-divider {
  width: 1px;
  height: 20px;
  background: var(--fluent-stroke);
}
.cmd-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
  flex-shrink: 0;
}
.name-input {
  width: 240px;
  flex-shrink: 0;
}
.field-count {
  font-size: 12px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.cmd-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── 三栏主体 ─── */
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.pane {
  width: 232px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
.palette {
  border-right: 1px solid var(--fluent-stroke);
}
.props {
  width: 272px;
  border-left: 1px solid var(--fluent-stroke);
}
.pane-head {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--fluent-stroke);
}
.pane-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.pane-sub {
  font-size: 11px;
  color: var(--text-dim);
}
.pane-tag {
  font-size: 11px;
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
  border-radius: 4px;
  padding: 2px 8px;
}
.pane-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 10px 16px;
}

/* ─── 字段库 ─── */
.pal-group {
  margin-bottom: 12px;
}
.pal-group-tx {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  padding: 4px 6px;
  letter-spacing: 0.04em;
}
.pal-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  text-align: left;
  padding: 8px;
  margin-bottom: 3px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: grab;
  transition:
    background-color var(--d1) var(--fluent-ease),
    border-color var(--d1) var(--fluent-ease);
}
.pal-item:hover:not(:disabled) {
  background: var(--rail-item-hover);
  border-color: var(--fluent-stroke);
}
.pal-item:active:not(:disabled) {
  cursor: grabbing;
}
.pal-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pal-ic {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text);
  background: var(--rail-item-hover);
}
.pal-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pal-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-strong);
  line-height: 1.35;
}
.pal-desc {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ─── 画布 ─── */
.canvas-wrap {
  flex: 1;
  min-width: 0;
  background: var(--app-bg);
}
.canvas-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px 28px;
}
.drop-empty {
  height: 100%;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-card {
  width: 100%;
  max-width: 520px;
  padding: 48px 24px;
  background: var(--surface);
  border: 1px dashed var(--stroke-strong);
  border-radius: 8px;
  text-align: center;
}
.empty-tip {
  font-size: 12px;
  color: var(--text-dim);
}
.sheet {
  max-width: 760px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
  padding: 18px 22px 22px;
}
.sheet-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--fluent-stroke);
}
.sheet-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong);
}
.sheet-sub {
  font-size: 11.5px;
  color: var(--text-dim);
}
.row {
  display: flex;
  gap: 10px;
}
.gap {
  height: 10px;
  margin: 0 4px;
  border-radius: 3px;
}
.gap.on::before {
  content: '';
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
}
.field-card {
  position: relative;
  flex: 1;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--fluent-stroke);
  border-radius: 7px;
  padding: 12px 14px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    box-shadow var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease),
    opacity var(--d1) var(--fluent-ease);
}
.field-card:hover {
  border-color: var(--stroke-strong);
  background: color-mix(in srgb, var(--accent) 2%, var(--surface));
}
.field-card.selected {
  border-color: var(--accent-ink);
  box-shadow: 0 0 0 1px var(--accent-ink);
}
.field-card.over {
  border-color: var(--accent-ink);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent-ink) 55%, transparent);
}
.field-card.dragging {
  opacity: 0.35;
}
.drag-handle {
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-dim);
  opacity: 0;
  cursor: grab;
  user-select: none;
  transition: opacity var(--d1) var(--fluent-ease);
}
.field-card:hover .drag-handle {
  opacity: 0.7;
}
.half-slot {
  flex: 1;
  min-width: 0;
  border: 1px dashed var(--stroke-strong);
  border-radius: 7px;
  background: rgba(31, 35, 41, 0.02);
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.half-slot:hover,
.half-slot.on {
  border-color: var(--accent-ink);
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}

/* ─── 属性面板 ─── */
.props-empty {
  padding: 16px 18px;
}
.props-empty p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  margin-bottom: 12px;
}
.props-empty ul {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.props-empty li {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-dim);
}
.prop-sec {
  margin-bottom: 14px;
}
.prop-lab {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--fluent-stroke);
  margin-bottom: 8px;
}
.prop-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.prop-text .prop-lab {
  margin-bottom: 0;
}
.prop-sub {
  font-size: 11px;
  color: var(--text-dim);
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  max-height: 208px;
  overflow-y: auto;
  padding: 2px;
}
.icon-cell {
  aspect-ratio: 1;
  border: 1px solid var(--fluent-stroke);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--d1) var(--fluent-ease);
}
.icon-cell:hover {
  border-color: var(--stroke-strong);
  background: var(--rail-item-hover);
}
.icon-cell.on {
  background: var(--accent);
  border-color: var(--accent-ink);
  color: var(--on-accent);
}
.opt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--rail-item-hover);
  border: 1px solid var(--fluent-stroke);
  border-radius: 5px;
  padding: 3px 6px 3px 9px;
}
.opt-x {
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}
.opt-x:hover {
  color: #e04f5f;
}
.opt-add {
  display: flex;
  gap: 6px;
}
.prop-delete {
  margin-top: 20px;
}
</style>
