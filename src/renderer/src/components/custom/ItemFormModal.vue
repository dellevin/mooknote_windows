<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NButton, useMessage } from 'naive-ui'
import type {
  CustomFieldDef,
  CustomFieldValue,
  CustomModuleDesign,
  CustomModuleItem,
  CustomModuleItemInput
} from '@shared/types'
import FieldEditor from './FieldEditor.vue'
import ModuleIcon from './ModuleIcon.vue'
import { plain } from '@/utils/image'

const props = defineProps<{
  show: boolean
  moduleId: string
  moduleIcon?: string | null
  item: CustomModuleItem | null
}>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', item: CustomModuleItem): void
}>()

const message = useMessage()
const design = ref<CustomModuleDesign | null>(null)
const itemId = ref('')
const data = ref<Record<string, CustomFieldValue>>({})
const saving = ref(false)

watch(
  () => props.show,
  async (s) => {
    if (!s) return
    design.value = await window.mook.customDesign.active(props.moduleId)
    if (props.item) {
      itemId.value = props.item.id
      data.value = { ...props.item.data }
    } else {
      itemId.value = await window.mook.customItem.newId()
      data.value = {}
    }
  }
)

const HALF_TYPES: CustomFieldDef['type'][] = [
  'text',
  'multiText',
  'date',
  'count',
  'duration',
  'progress',
  'dateRange'
]
const pairable = (f: CustomFieldDef): boolean => f.halfWidth && HALF_TYPES.includes(f.type)

// 封面独立到左侧海报栏，不参与行排版
const posterField = computed<CustomFieldDef | null>(
  () => (design.value?.fields ?? []).find((f) => f.type === 'poster') ?? null
)

// 与表单设计器一致：相邻两个半行字段并排为一行
type Row = CustomFieldDef[]
const rows = computed<Row[]>(() => {
  const fs = (design.value?.fields ?? []).filter((f) => f.type !== 'poster')
  const out: Row[] = []
  let i = 0
  while (i < fs.length) {
    if (pairable(fs[i]) && i + 1 < fs.length && pairable(fs[i + 1])) {
      out.push([fs[i], fs[i + 1]])
      i += 2
    } else {
      out.push([fs[i]])
      i++
    }
  }
  return out
})

function fieldOf(type: string): CustomFieldDef | undefined {
  return design.value?.fields.find((f) => f.type === type)
}
function titleField(): CustomFieldDef | undefined {
  const fs = design.value?.fields ?? []
  return fs.find((f) => f.type === 'text' && f.isTitle) ?? fs.find((f) => f.type === 'text')
}

async function save(): Promise<void> {
  const fields = design.value?.fields ?? []
  // 必填校验（text/multiText/longText）
  for (const f of fields) {
    if (!f.required) continue
    const v = data.value[f.key]
    const empty =
      v == null ||
      (typeof v === 'string' && !v.trim()) ||
      (Array.isArray(v) && v.length === 0)
    if (empty) {
      message.warning(`请填写「${f.label}」`)
      return
    }
  }

  const tf = titleField()
  const title = tf ? String(data.value[tf.key] ?? '').trim() : ''
  const posterF = fieldOf('poster')
  const ratingF = fieldOf('rating')
  const statusF = fieldOf('status')
  const ratingV = ratingF ? data.value[ratingF.key] : null

  const payload: CustomModuleItemInput = {
    id: itemId.value,
    moduleId: props.moduleId,
    title,
    coverPath: posterF ? (data.value[posterF.key] as string | null) : null,
    rating: typeof ratingV === 'number' ? ratingV : null,
    status: statusF ? (data.value[statusF.key] as string | null) : null,
    data: data.value
  }

  saving.value = true
  try {
    const body = plain(payload)
    const saved = props.item
      ? await window.mook.customItem.update(body)
      : await window.mook.customItem.create(body)
    emit('saved', saved)
    emit('update:show', false)
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="editor">
      <header class="ed-head">
        <div class="ed-ic">
          <ModuleIcon :icon="moduleIcon ?? null" :size="20" />
        </div>
        <div class="ed-head-tx">
          <div class="ed-title">{{ item ? '编辑条目' : '新建条目' }}</div>
          <div class="ed-sub">带 <span class="req">*</span> 为必填项</div>
        </div>
      </header>

      <div class="ed-body">
        <!-- 左：封面海报栏 -->
        <aside v-if="posterField" class="ed-aside">
          <FieldEditor
            :field="posterField"
            :module-id="moduleId"
            :item-id="itemId"
            v-model="data[posterField.key]"
          />
        </aside>

        <!-- 右：字段表单 -->
        <div class="ed-form">
          <div
            v-for="(row, ri) in rows"
            :key="ri"
            class="ed-row"
            :class="{
              pair: row.length === 2,
              'single-half-l': row.length === 1 && pairable(row[0]) && row[0].halfOnLeft,
              'single-half-r': row.length === 1 && pairable(row[0]) && !row[0].halfOnLeft
            }"
          >
            <div v-for="f in row" :key="f.key" class="ed-cell">
              <div class="f-label">
                <ModuleIcon v-if="f.icon" :icon="f.icon" :size="13" class="f-ic" />
                <span class="f-name">{{ f.label }}</span>
                <span v-if="f.required" class="req">*</span>
                <span v-if="f.isTitle" class="f-badge">标题</span>
              </div>
              <FieldEditor
                :field="f"
                :module-id="moduleId"
                :item-id="itemId"
                v-model="data[f.key]"
              />
            </div>
          </div>
        </div>
      </div>

      <footer class="ed-foot">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="save">
          {{ item ? '保存修改' : '创建条目' }}
        </NButton>
      </footer>
    </div>
  </NModal>
</template>

<style scoped>
.editor {
  width: 840px;
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
.ed-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px 14px;
  border-bottom: 1px solid var(--fluent-stroke);
}
.ed-ic {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-strong);
  background: var(--rail-item-hover);
}
.ed-title {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--text-strong);
  line-height: 1.35;
}
.ed-sub {
  font-size: 11.5px;
  color: var(--text-dim);
  margin-top: 1px;
}
.req {
  color: #e04f5f;
}

/* 主体：左海报栏 + 右表单列 */
.ed-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 24px 24px;
  display: flex;
  align-items: flex-start;
  gap: 26px;
}
.ed-aside {
  flex-shrink: 0;
  width: 132px;
  position: sticky;
  top: 0;
}
.ed-form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 行：整行 / 半行并排（grid 控制左右） */
.ed-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 20px;
}
.ed-row .ed-cell {
  grid-column: 1 / -1;
  min-width: 0;
}
.ed-row.pair .ed-cell {
  grid-column: auto;
}
.ed-row.single-half-l .ed-cell {
  grid-column: 1;
}
.ed-row.single-half-r .ed-cell {
  grid-column: 2;
}

/* 字段标签 */
.f-label {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 7px;
}
.f-ic {
  color: var(--text-dim);
}
.f-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.f-label .req {
  font-size: 13px;
  line-height: 1;
}
.f-badge {
  font-size: 10px;
  font-weight: 500;
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: 2px;
}

/* 底部操作栏 */
.ed-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--fluent-stroke);
  background: color-mix(in srgb, var(--app-bg) 55%, var(--surface));
}
</style>
