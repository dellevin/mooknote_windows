<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NSpace,
  NPopconfirm,
  useMessage
} from 'naive-ui'
import type { MediaKind, Person, PersonLink, PersonLinkWithPerson } from '@shared/types'
import { PERSON_ROLE_LABELS } from '@shared/types'
import { toImgUrl, plain } from '@/utils/image'
import PersonFormModal from '@/components/people/PersonFormModal.vue'

const props = defineProps<{ kind: MediaKind; parentId: string }>()
const message = useMessage()

const links = ref<PersonLinkWithPerson[]>([])
const loading = ref(false)
const pickerShow = ref(false)
const saving = ref(false)
const people = ref<Person[]>([])
const formRef = ref({ role: '', personId: null as string | null, characterName: '' })
const createShow = ref(false)

const roleOptions = computed(() =>
  Object.entries(PERSON_ROLE_LABELS[props.kind]).map(([value, label]) => ({ label, value }))
)
const personOptions = computed(() =>
  people.value.map((p) => ({ label: p.name, value: p.id }))
)

const grouped = computed(() => {
  const map = new Map<string, PersonLinkWithPerson[]>()
  for (const l of links.value) {
    const label = PERSON_ROLE_LABELS[props.kind][l.roleType] ?? l.roleType
    const arr = map.get(label) ?? []
    arr.push(l)
    map.set(label, arr)
  }
  return [...map.entries()]
})

async function load(): Promise<void> {
  loading.value = true
  try {
    links.value = await window.mook.personLink.byWork(props.kind, props.parentId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function openPicker(): Promise<void> {
  people.value = await window.mook.person.list()
  const firstRole = roleOptions.value[0]?.value ?? ''
  formRef.value = { role: firstRole, personId: null, characterName: '' }
  pickerShow.value = true
}

async function persist(next: PersonLink[]): Promise<void> {
  saving.value = true
  try {
    await window.mook.personLink.replace(props.kind, props.parentId, plain(next))
    await load()
  } finally {
    saving.value = false
  }
}

async function confirmAdd(): Promise<void> {
  if (!formRef.value.personId) {
    message.warning('请选择人物')
    return
  }
  if (!formRef.value.role) {
    message.warning('请选择身份')
    return
  }
  const next: PersonLink[] = links.value.map((l) => ({
    id: l.id,
    workId: l.workId,
    personId: l.personId,
    roleType: l.roleType,
    characterName: l.characterName,
    sortOrder: l.sortOrder
  }))
  next.push({
    id: window.mook.util.uuid(),
    workId: props.parentId,
    personId: formRef.value.personId,
    roleType: formRef.value.role,
    characterName:
      formRef.value.role === 'actor' && formRef.value.characterName.trim()
        ? formRef.value.characterName.trim()
        : null,
    sortOrder: next.length
  })
  pickerShow.value = false
  await persist(next)
}

async function remove(l: PersonLinkWithPerson): Promise<void> {
  const next = links.value
    .filter((x) => x.id !== l.id)
    .map((x) => ({
      id: x.id,
      workId: x.workId,
      personId: x.personId,
      roleType: x.roleType,
      characterName: x.characterName,
      sortOrder: x.sortOrder
    }))
  await persist(next)
}

async function onPersonCreated(p: Person): Promise<void> {
  createShow.value = false
  people.value = await window.mook.person.list()
  formRef.value.personId = p.id
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">人物（{{ links.length }}）</span>
      <NButton size="tiny" type="primary" ghost :loading="saving" @click="openPicker">
        ＋ 关联人物
      </NButton>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!links.length && !loading" description="还没有关联人物" size="small" />
      <div v-for="[role, list] in grouped" :key="role" class="role-group">
        <div class="role-label">{{ role }}</div>
        <div class="people-row">
          <div v-for="l in list" :key="l.id" class="person-chip">
            <div class="chip-avatar">
              <img v-if="l.photoPath" :src="toImgUrl(l.photoPath)" />
              <span v-else>{{ l.name.slice(0, 1) }}</span>
            </div>
            <div class="chip-info">
              <span class="chip-name">{{ l.name }}</span>
              <span v-if="l.characterName" class="chip-char">饰 {{ l.characterName }}</span>
            </div>
            <NPopconfirm @positive-click="remove(l)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">✕</NButton>
              </template>
              移除该人物关联？
            </NPopconfirm>
          </div>
        </div>
      </div>
    </NSpin>

    <NModal v-model:show="pickerShow" :auto-focus="false">
      <div class="picker">
        <h3>关联人物</h3>
        <NForm label-placement="top" size="small">
          <NFormItem label="身份">
            <NSelect v-model:value="formRef.role" :options="roleOptions" />
          </NFormItem>
          <NFormItem label="人物">
            <NSpace align="center" class="full">
              <NSelect
                v-model:value="formRef.personId"
                :options="personOptions"
                filterable
                placeholder="选择已有人物"
                class="person-select"
              />
              <NButton size="small" quaternary @click="createShow = true">新建</NButton>
            </NSpace>
          </NFormItem>
          <NFormItem v-if="formRef.role === 'actor'" label="饰演角色名（可选）">
            <NInput v-model:value="formRef.characterName" placeholder="角色名" />
          </NFormItem>
        </NForm>
        <div class="picker-footer">
          <NSpace justify="end">
            <NButton @click="pickerShow = false">取消</NButton>
            <NButton type="primary" :loading="saving" @click="confirmAdd">确定</NButton>
          </NSpace>
        </div>
      </div>
    </NModal>

    <PersonFormModal v-model:show="createShow" :person="null" @saved="onPersonCreated" />
  </div>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.role-group {
  margin-bottom: 12px;
}
.role-label {
  font-size: 12px;
  color: #8a909c;
  margin-bottom: 6px;
}
.people-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.person-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #f8f9fd;
  border-radius: 10px;
}
.chip-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  background: #e2e5ee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 15px;
  flex: 0 0 38px;
}
.chip-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chip-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chip-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
}
.chip-char {
  font-size: 12px;
  color: #8a909c;
}
.picker {
  width: 460px;
  max-width: 92vw;
  background: #fff;
  border-radius: 14px;
  padding: 20px 24px;
}
.picker h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.full {
  width: 100%;
}
.person-select {
  flex: 1;
}
.picker-footer {
  margin-top: 8px;
}
</style>
