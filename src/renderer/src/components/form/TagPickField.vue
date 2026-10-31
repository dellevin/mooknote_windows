<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NModal, NInput, NButton, NSpin, NEmpty } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string[]
    /** 全库候选 */
    candidates?: string[]
    placeholder?: string
    /** 是否为封闭标签云模式（类型）：true 时直接平铺候选、无弹层 */
    cloud?: boolean
  }>(),
  { candidates: () => [], placeholder: '搜索或输入后回车添加', cloud: false }
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
}>()

function emitNext(next: string[]): void {
  emit(
    'update:modelValue',
    next
  )
}

// ── 标签云模式（候选 + 已选自定义）：点击即勾选/取消 ──
const cloudAdding = ref(false)
const cloudText = ref('')
const cloudInput = ref<HTMLInputElement | null>(null)

// 标签云筛选
const cloudFilter = ref('')

// 标签云展示项：候选 + 已选但不在候选里的自定义项，再按筛选词过滤
const cloudItems = computed(() => {
  const list = [...props.candidates]
  for (const v of props.modelValue) if (!list.includes(v)) list.push(v)
  const kw = cloudFilter.value.trim().toLowerCase()
  return kw ? list.filter((c) => c.toLowerCase().includes(kw)) : list
})

function toggleCloud(name: string): void {
  const set = new Set(props.modelValue)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  emitNext([...set])
}
async function startCloudNew(): Promise<void> {
  cloudAdding.value = true
  cloudText.value = ''
  await nextTick()
  cloudInput.value?.focus()
}
function confirmCloudNew(): void {
  const v = cloudText.value.trim()
  if (v && !props.modelValue.includes(v)) {
    emitNext([...props.modelValue, v])
  }
  cloudAdding.value = false
  cloudText.value = ''
}

// ── 弹层模式 ──
const show = ref(false)
const keyword = ref('')
// 弹层内的草稿，确定才写回，取消不改动
const draft = ref<string[]>([])
// 弹层内搜索时把候选按「已选置顶 + 匹配」整理
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const selected = new Set(draft.value)
  const matched = props.candidates.filter(
    (c) => !kw || c.toLowerCase().includes(kw)
  )
  return matched
    .map((name) => ({ name, picked: selected.has(name) }))
    .sort((a, b) => Number(b.picked) - Number(a.picked))
})
const showCreate = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return false
  const lower = kw.toLowerCase()
  return !props.candidates.some((c) => c.toLowerCase() === lower)
})

// 主列表行：有候选时按搜索过滤（已选置顶）；无候选（别名）时直接展示已新增项
const rows = computed(() => {
  if (props.candidates.length === 0) {
    return draft.value
      .filter((name: string) => {
        const kw = keyword.value.trim().toLowerCase()
        return !kw || name.toLowerCase().includes(kw)
      })
      .map((name: string) => ({ name, picked: true }))
  }
  return filtered.value
})

watch(show, (v) => {
  if (v) {
    draft.value = [...props.modelValue]
    keyword.value = ''
  }
})

function pick(name: string): void {
  if (!draft.value.includes(name)) draft.value = [...draft.value, name]
}
function unpick(name: string): void {
  draft.value = draft.value.filter((x) => x !== name)
}
function toggleRow(name: string, picked: boolean): void {
  picked ? unpick(name) : pick(name)
}
function createNew(): void {
  const kw = keyword.value.trim()
  if (!kw) return
  pick(kw)
  keyword.value = ''
}
function removeSelected(name: string, e: MouseEvent): void {
  e.stopPropagation()
  if (show.value) unpick(name)
  else emitNext(props.modelValue.filter((x) => x !== name))
}
function confirm(): void {
  emitNext(draft.value)
  show.value = false
}

// 表单摘要框里最多展示的 chip 数
const preview = computed(() => props.modelValue.slice(0, 3))
const restCount = computed(() => Math.max(props.modelValue.length - 3, 0))
</script>

<template>
  <!-- 封闭标签云：标题右侧筛选框，下面平铺 -->
  <div v-if="cloud" class="tpf-cloud-wrap">
    <div class="tpf-cloud-head">
      <span class="tpf-cloud-label">{{ label }}</span>
      <NInput
        v-model:value="cloudFilter"
        size="tiny"
        clearable
        placeholder="筛选"
        class="tpf-cloud-filter"
      />
    </div>
    <div class="tpf-cloud">
      <button
        v-for="c in cloudItems"
        :key="c"
        type="button"
        class="tpf-chip cloud"
        :class="{ on: modelValue.includes(c) }"
        @click="toggleCloud(c)"
      >
        {{ c }}
        <i v-if="!candidates.includes(c)" class="tpf-cloud-x" @click.stop="removeSelected(c, $event)">✕</i>
      </button>
      <input
        v-if="cloudAdding"
        ref="cloudInput"
        v-model="cloudText"
        class="tpf-cloud-input"
        placeholder="回车添加"
        @keyup.enter="confirmCloudNew"
        @blur="confirmCloudNew"
      />
      <button v-else type="button" class="tpf-chip cloud add" @click="startCloudNew">＋ 自定义</button>
    </div>
  </div>

  <!-- 摘要框 + 弹层 -->
  <template v-else>
    <button type="button" class="tpf-summary" @click="show = true">
      <span v-if="modelValue.length" class="tpf-chips">
        <span v-for="name in preview" :key="name" class="tpf-chip-mini" @click.stop>
          {{ name }}
          <i class="tpf-x" @click="removeSelected(name, $event)">✕</i>
        </span>
        <span v-if="restCount" class="tpf-more">等 {{ modelValue.length }} 人</span>
      </span>
      <span v-else class="tpf-placeholder">点击添加</span>
      <span class="tpf-add">＋</span>
    </button>

    <NModal
      :show="show"
      @update:show="(v: boolean) => (show = v)"
      :auto-focus="false"
    >
      <div class="tpf-modal">
        <h3>{{ label }}</h3>
        <div class="tpf-search">
          <NInput
            v-model:value="keyword"
            size="small"
            clearable
            :placeholder="placeholder"
            @keyup.enter="showCreate ? createNew() : filtered[0] && toggleRow(filtered[0].name, filtered[0].picked)"
          />
          <NButton size="small" :disabled="!showCreate" @click="createNew">新建</NButton>
        </div>

        <div v-if="draft.length" class="tpf-selected">
          <span class="tpf-sel-title">已选 {{ draft.length }}</span>
          <span v-for="name in draft" :key="name" class="tpf-chip-mini solid" @click.stop>
            {{ name }}
            <i class="tpf-x" @click="unpick(name)">✕</i>
          </span>
        </div>

        <NSpin :show="false">
          <div v-if="!rows.length && !showCreate" class="tpf-none">
            在上方输入后回车即可新增
          </div>
          <div v-else class="tpf-list">
            <div
              v-for="row in rows"
              :key="row.name"
              class="tpf-row"
              :class="{ picked: row.picked }"
              @click="toggleRow(row.name, row.picked)"
            >
              <span class="tpf-check">{{ row.picked ? '✓' : '' }}</span>
              <span class="tpf-name">{{ row.name }}</span>
            </div>
            <button
              v-if="showCreate"
              type="button"
              class="tpf-row create"
              @click="createNew"
            >
              <span class="tpf-check">＋</span>
              <span class="tpf-name">新建「{{ keyword.trim() }}」</span>
            </button>
          </div>
        </NSpin>

        <div class="tpf-foot">
          <NButton size="small" @click="show = false">取消</NButton>
          <NButton size="small" type="primary" @click="confirm">确定（{{ draft.length }}）</NButton>
        </div>
      </div>
    </NModal>
  </template>
</template>

<style scoped>
.tpf-cloud-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.tpf-cloud-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  flex-shrink: 0;
}
.tpf-cloud-filter {
  width: 150px;
}
.tpf-cloud {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  /* 最多约 5 行（chip 27px + 间距），超出纵向滚动 */
  max-height: 159px;
  overflow-y: auto;
  padding-right: 2px;
}
.tpf-chip.cloud {
  font-size: 12.5px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid #dfe2e9;
  background: #fff;
  color: #5b616c;
  cursor: pointer;
  transition: all 0.12s ease;
}
.tpf-chip.cloud:hover {
  border-color: var(--accent-ink);
}
.tpf-chip.cloud.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent, #fff);
}
.tpf-chip.cloud.add {
  border-style: dashed;
  color: #8a909c;
}
.tpf-cloud-x {
  font-style: normal;
  font-size: 10px;
  margin-left: 4px;
  opacity: 0.7;
}
.tpf-cloud-input {
  font-size: 12.5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-ink);
  outline: none;
  width: 110px;
  font-family: inherit;
}
.tpf-empty-tip {
  font-size: 12px;
  color: #a8adb8;
}

.tpf-summary {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 30px 4px 8px;
  border: 1px solid rgba(17, 17, 17, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  position: relative;
  text-align: left;
  transition: border-color 0.12s ease;
}
.tpf-summary:hover {
  border-color: var(--accent-ink);
}
.tpf-chips {
  display: contents;
}
.tpf-placeholder {
  font-size: 13px;
  color: #b0b5bd;
}
.tpf-add {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #8a909c;
  font-size: 15px;
}
.tpf-chip-mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-style: normal;
  padding: 2px 6px 2px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, #fff);
  color: var(--accent-ink);
  max-width: 150px;
}
.tpf-chip-mini.solid {
  background: color-mix(in srgb, var(--accent) 16%, #fff);
}
.tpf-chip-mini .tpf-x {
  font-style: normal;
  font-size: 10px;
  opacity: 0.55;
  cursor: pointer;
}
.tpf-chip-mini .tpf-x:hover {
  opacity: 1;
}
.tpf-more {
  font-size: 12px;
  color: #8a909c;
}

.tpf-modal {
  width: 460px;
  max-width: 93vw;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 22px;
}
.tpf-modal h3 {
  font-size: 15px;
  color: var(--text-strong);
  margin-bottom: 14px;
}
.tpf-search {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tpf-selected {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #f6f7fa;
  border-radius: 8px;
}
.tpf-sel-title {
  font-size: 12px;
  color: #8a909c;
  margin-right: 2px;
}
.tpf-nores {
  padding: 24px 0;
}
.tpf-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  max-height: 40vh;
}
.tpf-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-strong);
  text-align: left;
}
.tpf-row + .tpf-row {
  border-top: 1px solid #f3f4f7;
}
.tpf-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, #fff);
}
.tpf-row.picked {
  color: var(--accent-ink);
  font-weight: 600;
}
.tpf-row.create {
  color: var(--accent-ink);
}
.tpf-check {
  width: 16px;
  text-align: center;
  color: var(--accent-ink);
  flex-shrink: 0;
}
.tpf-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpf-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
