<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NInput,
  NForm,
  NFormItem,
  NSelect,
  NDatePicker,
  NDynamicTags,
  useMessage
} from 'naive-ui'
import type { Person, PersonInput } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain } from '@/utils/image'

const props = defineProps<{ show: boolean; person: Person | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', person: Person): void
}>()

const message = useMessage()
const saving = ref(false)
const picking = ref(false)
const form = ref({
  id: '',
  name: '',
  gender: null as string | null,
  birthTs: null as number | null,
  birthPlace: '',
  alternateNames: [] as string[],
  occupation: [] as string[],
  summary: '',
  photoPath: null as string | null,
  coverOffset: 0
})

const genderOptions = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
  { label: '其他', value: 'other' }
]

watch(
  () => props.show,
  async (s) => {
    if (!s) return
    if (props.person) {
      const p = props.person
      form.value = {
        id: p.id,
        name: p.name,
        gender: p.gender,
        birthTs: isoToTs(p.birthDate),
        birthPlace: p.birthPlace ?? '',
        alternateNames: [...p.alternateNames],
        occupation: [...p.occupation],
        summary: p.summary ?? '',
        photoPath: p.photoPath,
        coverOffset: p.coverOffset
      }
    } else {
      form.value = {
        id: await window.mook.person.newId(),
        name: '',
        gender: null,
        birthTs: null,
        birthPlace: '',
        alternateNames: [],
        occupation: [],
        summary: '',
        photoPath: null,
        coverOffset: 0
      }
    }
  }
)

async function pickPhoto(): Promise<void> {
  picking.value = true
  try {
    const p = await window.mook.person.pickPhoto(form.value.id)
    if (p) form.value.photoPath = p
  } finally {
    picking.value = false
  }
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    message.warning('请填写姓名')
    return
  }
  const payload: PersonInput = {
    id: form.value.id,
    name: form.value.name.trim(),
    gender: form.value.gender,
    birthDate: tsToIso(form.value.birthTs),
    birthPlace: form.value.birthPlace.trim() || null,
    alternateNames: form.value.alternateNames,
    occupation: form.value.occupation,
    summary: form.value.summary.trim() || null,
    photoPath: form.value.photoPath,
    coverOffset: form.value.coverOffset
  }
  saving.value = true
  try {
    const body = plain(payload)
    const saved = props.person
      ? await window.mook.person.update(body)
      : await window.mook.person.create(body)
    emit('saved', saved)
    emit('update:show', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="editor">
      <h3>{{ props.person ? '编辑人物' : '新建人物' }}</h3>
      <NForm label-placement="top" size="small">
        <div class="photo-row">
          <div class="photo">
            <img v-if="form.photoPath" :src="toImgUrl(form.photoPath)" />
            <span v-else>无照片</span>
          </div>
          <NButton size="small" :loading="picking" @click="pickPhoto">选择照片</NButton>
        </div>
        <NFormItem label="姓名">
          <NInput v-model:value="form.name" placeholder="人物姓名" />
        </NFormItem>
        <div class="grid-2">
          <NFormItem label="性别">
            <NSelect
              v-model:value="form.gender"
              :options="genderOptions"
              placeholder="未知"
              clearable
            />
          </NFormItem>
          <NFormItem label="出生日期">
            <NDatePicker v-model:value="form.birthTs" type="date" clearable class="full" />
          </NFormItem>
        </div>
        <NFormItem label="出生地">
          <NInput v-model:value="form.birthPlace" placeholder="出生地（可选）" />
        </NFormItem>
        <NFormItem label="别名">
          <NDynamicTags v-model:value="form.alternateNames" />
        </NFormItem>
        <NFormItem label="职业">
          <NDynamicTags v-model:value="form.occupation" />
        </NFormItem>
        <NFormItem label="简介">
          <NInput
            v-model:value="form.summary"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </NFormItem>
      </NForm>
      <div class="editor-footer">
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
  width: 560px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.photo-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}
.photo {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: #e2e5ee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 12px;
}
.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.full {
  width: 100%;
}
.editor-footer {
  margin-top: 8px;
}
</style>
