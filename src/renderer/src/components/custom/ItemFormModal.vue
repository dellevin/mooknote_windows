<script setup lang="ts">
import { ref, watch } from 'vue'
import { NModal, NButton, NSpace, NForm, NFormItem, useMessage } from 'naive-ui'
import type {
  CustomFieldDef,
  CustomFieldValue,
  CustomModuleDesign,
  CustomModuleItem,
  CustomModuleItemInput
} from '@shared/types'
import FieldEditor from './FieldEditor.vue'
import { plain } from '@/utils/image'

const props = defineProps<{ show: boolean; moduleId: string; item: CustomModuleItem | null }>()
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
      <h3>{{ item ? '编辑条目' : '新建条目' }}</h3>
      <NForm label-placement="left" label-width="84" size="small" class="form">
        <template v-for="f in design?.fields ?? []" :key="f.key">
          <NFormItem :label="f.label">
            <FieldEditor
              :field="f"
              :module-id="moduleId"
              :item-id="itemId"
              v-model="data[f.key]"
            />
          </NFormItem>
        </template>
      </NForm>
      <div class="footer">
        <NSpace justify="end">
          <NButton @click="emit('update:show', false)">取消</NButton>
          <NButton type="primary" :loading="saving" @click="save">保存</NButton>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.editor {
  width: 720px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
  border-radius: 14px;
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 12px;
}
.form {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.footer {
  margin-top: 12px;
}
</style>
