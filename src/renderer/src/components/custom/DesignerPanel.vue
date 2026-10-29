<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NSpace,
  NInput,
  NModal,
  NSwitch,
  NDynamicTags,
  NEmpty,
  useMessage
} from 'naive-ui'
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

watch(
  () => [props.moduleId, props.design] as const,
  async ([, design]) => {
    if (design) {
      isNew.value = false
      id.value = design.id
      name.value = design.name
      fields.value = design.fields.map((f) => ({ ...f, options: [...f.options] }))
    } else {
      isNew.value = true
      id.value = await window.mook.customDesign.newId()
      name.value = ''
      fields.value = []
    }
  },
  { immediate: true }
)

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
  { type: 'multiText', label: '多行标签', desc: '多个文本条目（如 导演、编剧）', icon: faListUl, defLabel: '' },
  { type: 'date', label: '日期', desc: '选择一个日期', icon: faCalendar, defLabel: '时间' },
  { type: 'longText', label: '长文本', desc: '多行长文本（如 简介）', icon: faAlignLeft, defLabel: '简介' },
  { type: 'duration', label: '时长', desc: '以分钟记录时长（如 影视总时长）', icon: faClock, defLabel: '时长' },
  { type: 'progress', label: '进度', desc: '当前/总量进度（如 看到 12/24 集）', icon: faHourglassHalf, defLabel: '进度' },
  { type: 'dateRange', label: '日期区间', desc: '开始 ~ 结束日期', icon: faCalendarDays, defLabel: '起止日期' },
  { type: 'multiImage', label: '多图', desc: '导入多张图片', icon: faImages, defLabel: '多图' }
]
const metaOf = (t: CustomFieldType): TypeMeta =>
  TYPE_METAS.find((m) => m.type === t) ?? TYPE_METAS[0]
const halfCapable = (t: CustomFieldType): boolean => HALF_TYPES.includes(t)
const pairable = (f: CustomFieldDef): boolean => f.halfWidth && halfCapable(f.type)
const singletonUsed = (t: CustomFieldType): boolean =>
  SINGLETON.includes(t) && fields.value.some((f) => f.type === t)

// ─── 添加字段：类型选择 ───
const pickerShow = ref(false)
function openPicker(): void {
  pickerShow.value = true
}
function chooseType(t: CustomFieldType): void {
  if (singletonUsed(t)) return
  pickerShow.value = false
  const meta = metaOf(t)
  beginConfig(
    {
      key: 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8),
      type: t,
      label: meta.defLabel,
      required: false,
      options: t === 'status' ? ['想看', '在看', '看过'] : [],
      isTitle: false,
      halfWidth: false,
      halfOnLeft: true,
      icon: ''
    },
    true
  )
}

// ─── 字段配置 ───
const cfgShow = ref(false)
const cfgIsNew = ref(false)
const cfg = ref<CustomFieldDef | null>(null)
const optionInput = ref('')
function beginConfig(f: CustomFieldDef, isNewField: boolean): void {
  cfg.value = { ...f, options: [...f.options] }
  cfgIsNew.value = isNewField
  optionInput.value = ''
  cfgShow.value = true
}
function editField(f: CustomFieldDef): void {
  beginConfig(f, false)
}
function addOption(): void {
  const v = optionInput.value.trim()
  if (!v || !cfg.value || cfg.value.options.includes(v)) return
  cfg.value.options.push(v)
  optionInput.value = ''
}
function removeOption(o: string): void {
  if (!cfg.value) return
  cfg.value.options = cfg.value.options.filter((x) => x !== o)
}
function toggleTitle(on: boolean): void {
  if (!cfg.value) return
  cfg.value.isTitle = on
}
function saveConfig(): void {
  const c = cfg.value
  if (!c) return
  if (!c.label.trim()) {
    message.warning('请输入字段名称')
    return
  }
  if (c.type === 'status' && c.options.length === 0) {
    message.warning('请至少添加一个状态选项')
    return
  }
  if (cfgIsNew.value) {
    fields.value.push(c)
  } else {
    const idx = fields.value.findIndex((f) => f.key === c.key)
    if (idx !== -1) fields.value[idx] = c
  }
  if (c.isTitle) {
    for (const f of fields.value) if (f.key !== c.key) f.isTitle = false
  }
  cfgShow.value = false
}
function deleteConfigField(): void {
  const c = cfg.value
  if (!c) return
  fields.value = fields.value.filter((f) => f.key !== c.key)
  cfgShow.value = false
}

// ─── 半行分组（与手机端一致：相邻两个半行字段并排） ───
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

// ─── 拖拽排序 ───
const dragKey = ref<string | null>(null)
const gapOver = ref<number | null>(null)
const fieldOver = ref<string | null>(null)
const slotOver = ref<string | null>(null)

function onDragStart(e: DragEvent, f: CustomFieldDef): void {
  dragKey.value = f.key
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', f.key)
  }
}
function onDragEnd(): void {
  dragKey.value = null
  gapOver.value = null
  fieldOver.value = null
  slotOver.value = null
}
function dragged(): CustomFieldDef | undefined {
  return fields.value.find((f) => f.key === dragKey.value)
}
function dropGap(index: number): void {
  const d = dragged()
  if (!d) return
  const list = fields.value.filter((f) => f.key !== d.key)
  let idx = index
  const from = fields.value.findIndex((f) => f.key === d.key)
  if (from < idx) idx--
  const moved: CustomFieldDef = { ...d, halfWidth: false }
  list.splice(Math.min(idx, list.length), 0, moved)
  fields.value = list
  onDragEnd()
}
function dropField(target: CustomFieldDef): void {
  const d = dragged()
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
  const d = dragged()
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
  const d = dragged()
  if (d && d.key !== f.key && halfCapable(d.type)) slotOver.value = f.key
}
function gapDragOver(index: number): void {
  if (dragKey.value) gapOver.value = index
}
function fieldDragOver(f: CustomFieldDef): void {
  if (dragKey.value && dragKey.value !== f.key) fieldOver.value = f.key
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
  for (const f of fields.value) {
    if (!f.label.trim()) {
      message.warning('请填写每个字段的字段名')
      return
    }
    if (f.type === 'status' && !f.options.length) {
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
    <!-- 顶部栏 -->
    <div class="topbar">
      <button type="button" class="back" @click="emit('cancel')">
        <span class="back-ic">‹</span>
        <span class="back-tx">返回</span>
      </button>
      <NInput
        v-model:value="name"
        placeholder="设计名称（如：默认设计）"
        size="small"
        class="name-input"
      />
      <NSpace :size="8" :wrap="false">
        <NButton size="small" @click="openPicker">＋ 添加字段</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="save">保存</NButton>
      </NSpace>
    </div>
    <p class="hint">拖动字段卡片调整顺序；拖到另一字段上可并排为半行，拖到行间缝隙则独占一行。点击卡片编辑字段。</p>

    <!-- 预览区（手机宽度居中） -->
    <div class="canvas">
      <NEmpty v-if="!fields.length" description="还没有字段" class="empty">
        <template #extra>
          <NButton size="small" type="primary" @click="openPicker">＋ 添加第一个字段</NButton>
        </template>
      </NEmpty>

      <template v-else>
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
                    :class="{ dragging: dragKey === f.key, over: fieldOver === f.key }"
                    draggable="true"
                    @dragstart="onDragStart($event, f)"
                    @dragend="onDragEnd"
                    @dragover.prevent="fieldDragOver(f)"
                    @dragleave="fieldOver = null"
                    @drop.prevent="dropField(f)"
                    @click="editField(f)"
                  >
                    <FieldPreview :field="f" />
                  </div>
                  <div
                    class="half-slot"
                    :class="{ on: slotOver === f.key }"
                    @dragover.prevent="onSlotOver(f)"
                    @dragleave="slotOver = null"
                    @drop.prevent="dropSlot(f)"
                    @click="toggleSide(f)"
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
                  >
                    ＋
                  </div>
                  <div
                    class="field-card"
                    :class="{ dragging: dragKey === f.key, over: fieldOver === f.key }"
                    draggable="true"
                    @dragstart="onDragStart($event, f)"
                    @dragend="onDragEnd"
                    @dragover.prevent="fieldDragOver(f)"
                    @dragleave="fieldOver = null"
                    @drop.prevent="dropField(f)"
                    @click="editField(f)"
                  >
                    <FieldPreview :field="f" />
                  </div>
                </template>
              </template>

              <!-- 普通字段（整行或成对半行） -->
              <div
                v-else
                class="field-card"
                :class="{ dragging: dragKey === f.key, over: fieldOver === f.key }"
                draggable="true"
                @dragstart="onDragStart($event, f)"
                @dragend="onDragEnd"
                @dragover.prevent="fieldDragOver(f)"
                @dragleave="fieldOver = null"
                @drop.prevent="dropField(f)"
                @click="editField(f)"
              >
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
        <button type="button" class="add-btn" @click="openPicker">＋ 添加字段</button>
      </template>
    </div>

    <!-- 类型选择弹窗 -->
    <NModal v-model:show="pickerShow" :auto-focus="false">
      <div class="picker">
        <h3>添加字段</h3>
        <div class="type-grid">
          <button
            v-for="m in TYPE_METAS"
            :key="m.type"
            type="button"
            class="type-card"
            :disabled="singletonUsed(m.type)"
            @click="chooseType(m.type)"
          >
            <div class="type-head">
              <FaGlyph :def="m.icon" :size="17" class="type-ic" />
              <span class="type-name">{{ m.label }}</span>
            </div>
            <div class="type-desc">{{ singletonUsed(m.type) ? '已添加（该类型仅可添加一个）' : m.desc }}</div>
          </button>
        </div>
      </div>
    </NModal>

    <!-- 字段配置弹窗 -->
    <NModal v-model:show="cfgShow" :auto-focus="false">
      <div v-if="cfg" class="cfg">
        <h3>{{ cfgIsNew ? '添加' : '编辑' }}{{ metaOf(cfg.type).label }}</h3>

        <div class="cfg-row">
          <span class="cfg-cap">字段名称</span>
          <NInput v-model:value="cfg.label" maxlength="10" show-count placeholder="字段名称" />
        </div>

        <div v-if="cfg.type === 'text'" class="cfg-row switch-row">
          <div class="switch-text">
            <span class="cfg-cap">设为标题</span>
            <span class="switch-sub">列表页以此字段作为条目标题</span>
          </div>
          <NSwitch :value="cfg.isTitle" @update:value="toggleTitle" />
        </div>

        <div v-if="TEXT_TYPES.includes(cfg.type)" class="cfg-row switch-row">
          <span class="cfg-cap">必填</span>
          <NSwitch v-model:value="cfg.required" />
        </div>

        <div v-if="halfCapable(cfg.type)" class="cfg-row switch-row">
          <div class="switch-text">
            <span class="cfg-cap">半行显示</span>
            <span class="switch-sub">与相邻的半行字段并排为一行</span>
          </div>
          <NSwitch v-model:value="cfg.halfWidth" />
        </div>

        <div v-if="cfg.type !== 'poster'" class="cfg-icon-block">
          <span class="cfg-cap">图标</span>
          <div class="icon-grid">
            <button
              v-for="d in CUSTOM_MODULE_ICONS"
              :key="iconValue(d)"
              type="button"
              class="icon-cell"
              :class="{ on: cfg.icon === iconValue(d) }"
              @click="cfg.icon = cfg.icon === iconValue(d) ? '' : iconValue(d)"
            >
              <ModuleIcon :icon="iconValue(d)" :size="15" />
            </button>
          </div>
        </div>

        <div v-if="cfg.type === 'status'" class="cfg-opt-block">
          <span class="cfg-cap">状态选项</span>
          <div class="opt-chips">
            <span v-for="o in cfg.options" :key="o" class="opt-chip">
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

        <div class="cfg-footer">
          <NButton v-if="!cfgIsNew" type="error" ghost @click="deleteConfigField">删除字段</NButton>
          <div class="cfg-footer-right">
            <NButton @click="cfgShow = false">取消</NButton>
            <NButton type="primary" @click="saveConfig">{{ cfgIsNew ? '添加' : '保存' }}</NButton>
          </div>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.designer {
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.back {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 12px 0 8px;
  font-size: 13px;
  color: #4b5563;
  background: #fff;
  border: 1px solid #e6e8ee;
  border-radius: 999px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease),
    box-shadow var(--d1) var(--fluent-ease);
}
.back:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, #fff);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, #fff);
  box-shadow: 0 2px 8px rgba(31, 35, 41, 0.06);
}
.back-ic {
  font-size: 19px;
  line-height: 1;
  font-weight: 500;
  margin-top: -1px;
}
.name-input {
  flex: 1;
  max-width: 320px;
}
.hint {
  font-size: 12px;
  color: #a8adba;
  margin: 8px 0 4px;
}
.canvas {
  width: 100%;
  max-width: 560px;
  margin: 8px auto 0;
  padding-bottom: 24px;
}
.empty {
  padding: 56px 0;
}
.row {
  display: flex;
  gap: 10px;
}
.gap {
  height: 12px;
  margin: 0 8px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gap.on {
  height: 14px;
}
.gap.on::before {
  content: '';
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
}
.field-card {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #e9ebf1;
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    box-shadow var(--d1) var(--fluent-ease),
    opacity var(--d1) var(--fluent-ease);
}
.field-card:hover {
  border-color: #d8dce6;
  box-shadow: 0 4px 14px rgba(31, 35, 41, 0.06);
}
.field-card.second {
  margin-left: 0;
}
.field-card.over {
  border-color: var(--accent);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 50%, transparent);
}
.field-card.dragging {
  opacity: 0.35;
}
.half-slot {
  flex: 1;
  min-width: 0;
  border: 1px dashed #d6d9e0;
  border-radius: 12px;
  background: rgba(31, 35, 41, 0.02);
  color: #b6bac3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.half-slot:hover,
.half-slot.on {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, #fff);
}
.add-btn {
  width: 100%;
  margin-top: 12px;
  padding: 14px;
  border: 1px dashed #d2d6e0;
  border-radius: 12px;
  background: #fafbfc;
  color: #8a909c;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease);
}
.add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ─── 类型选择 ─── */
.picker {
  width: 560px;
  max-width: 94vw;
  max-height: 82vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 16px;
  padding: 20px 22px;
}
.picker h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.type-card {
  text-align: left;
  background: #f6f7f9;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.type-card:hover:not(:disabled) {
  border-color: var(--accent);
  background: #fff;
}
.type-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.type-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.type-ic {
  color: #5b616c;
}
.type-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.type-desc {
  font-size: 12px;
  line-height: 1.4;
  color: #9aa0ac;
  min-height: 33px;
}

/* ─── 字段配置 ─── */
.cfg {
  width: 480px;
  max-width: 94vw;
  max-height: 86vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 16px;
  padding: 20px 22px;
}
.cfg h3 {
  font-size: 16px;
  margin-bottom: 16px;
}
.cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.cfg-cap {
  font-size: 13px;
  color: #5b616c;
  width: 84px;
  flex-shrink: 0;
}
.cfg-row .n-input {
  flex: 1;
}
.switch-row {
  justify-content: space-between;
}
.switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.switch-text .cfg-cap {
  width: auto;
}
.switch-sub {
  font-size: 11.5px;
  color: #a8adba;
}
.cfg-icon-block {
  margin-bottom: 14px;
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 7px;
  margin-top: 8px;
}
.icon-cell {
  aspect-ratio: 1;
  border: 1px solid #eef0f4;
  border-radius: 9px;
  background: #f7f8fa;
  color: #5b616c;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--d1) var(--fluent-ease);
}
.icon-cell:hover {
  border-color: #cfd4de;
}
.icon-cell.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.cfg-opt-block {
  margin-bottom: 16px;
}
.opt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0;
}
.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #4b5563;
  background: #f4f5f8;
  border: 1px solid #eceef2;
  border-radius: 7px;
  padding: 3px 8px 3px 10px;
}
.opt-x {
  border: none;
  background: none;
  color: #9aa0ac;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}
.opt-add {
  display: flex;
  gap: 8px;
}
.cfg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
}
.cfg-footer-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
</style>
