<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NTag,
  NEmpty,
  NSpin,
  useDialog
} from 'naive-ui'
import type { Person, PersonWork, MediaKind } from '@shared/types'
import { PERSON_ROLE_LABELS } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import PersonFormModal from './PersonFormModal.vue'

const props = defineProps<{ show: boolean; id: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed'): void
  (e: 'open-work', kind: MediaKind, id: string): void
}>()

const dialog = useDialog()
const person = ref<Person | null>(null)
const works = ref<PersonWork[]>([])
const loading = ref(false)
const editShow = ref(false)

async function load(): Promise<void> {
  if (!props.id) return
  loading.value = true
  try {
    person.value = await window.mook.person.get(props.id)
    works.value = person.value
      ? (await window.mook.personLink.works(props.id)).filter((w) => !w.isDeleted)
      : []
  } finally {
    loading.value = false
  }
}
watch(
  () => [props.show, props.id],
  ([s]) => {
    if (s) void load()
  }
)

const roleLabel = (w: PersonWork): string =>
  PERSON_ROLE_LABELS[w.kind][w.roleType] ?? w.roleType

const grouped = computed(() => {
  const map = new Map<string, PersonWork[]>()
  for (const w of works.value) {
    const key = roleLabel(w)
    const arr = map.get(key) ?? []
    arr.push(w)
    map.set(key, arr)
  }
  return [...map.entries()]
})

function askDelete(): void {
  if (!person.value) return
  const p = person.value
  dialog.warning({
    title: '删除人物',
    content: `确定将「${p.name}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.person.softDelete(p.id)
      emit('changed')
      emit('update:show', false)
    }
  })
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-card">
      <NSpin :show="loading">
        <NEmpty v-if="!person && !loading" description="记录不存在或已删除" />
        <template v-else-if="person">
          <div class="hero">
            <div class="photo">
              <img v-if="person.photoPath" :src="toImgUrl(person.photoPath)" />
              <div v-else class="photo-empty">无照片</div>
            </div>
            <div class="head-info">
              <h2 class="title">{{ person.name }}</h2>
              <div v-if="person.alternateNames.length" class="alt">
                {{ person.alternateNames.join(' / ') }}
              </div>
              <NSpace :size="6" class="occ">
                <NTag v-for="o in person.occupation" :key="o" size="small" :bordered="false">
                  {{ o }}
                </NTag>
              </NSpace>
              <div class="kv">
                <span v-if="person.gender">
                  {{ person.gender === 'male' ? '男' : person.gender === 'female' ? '女' : '其他' }}
                </span>
                <span v-if="person.birthDate">出生：{{ formatDate(person.birthDate) }}</span>
                <span v-if="person.birthPlace">{{ person.birthPlace }}</span>
              </div>
            </div>
          </div>

          <div class="body">
            <div v-if="person.summary" class="summary">
              <div class="section-title">简介</div>
              <p>{{ person.summary }}</p>
            </div>

            <div class="section-title">作品（{{ works.length }}）</div>
            <NEmpty v-if="!grouped.length" description="还没有关联作品" size="small" />
            <div v-for="[role, list] in grouped" :key="role" class="work-group">
              <div class="role-label">{{ role }}</div>
              <div class="work-list">
                <div
                  v-for="w in list"
                  :key="w.linkId"
                  class="work-item"
                  @click="emit('open-work', w.kind, w.workId)"
                >
                  <span class="work-title">{{ w.title }}</span>
                  <span v-if="w.characterName" class="char">饰 {{ w.characterName }}</span>
                  <span v-if="w.rating != null" class="rate">★ {{ w.rating.toFixed(1) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="footer">
            <NSpace justify="end">
              <NButton type="error" quaternary @click="askDelete">删除</NButton>
              <NButton type="primary" @click="editShow = true">编辑</NButton>
            </NSpace>
          </div>
        </template>
      </NSpin>

      <PersonFormModal
        v-model:show="editShow"
        :person="person"
        @saved="
          () => {
            emit('changed')
            void load()
          }
        "
      />
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 680px;
  max-width: 94vw;
  max-height: 86vh;
  background: var(--surface);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.hero {
  display: flex;
  gap: 22px;
  padding: 24px 26px 18px;
  background: linear-gradient(135deg, #f3f5fb, #eef1f8);
}
.photo {
  flex: 0 0 120px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  background: #e2e5ee;
}
.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 13px;
}
.head-info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 22px;
  color: var(--text-strong);
  margin-bottom: 6px;
}
.alt {
  font-size: 13px;
  color: #8a909c;
  margin-bottom: 10px;
}
.occ {
  margin-bottom: 12px;
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 13px;
  color: #5b616c;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 10px 0 8px;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
  margin-bottom: 12px;
}
.work-group {
  margin-bottom: 12px;
}
.role-label {
  font-size: 12px;
  color: #8a909c;
  margin-bottom: 4px;
}
.work-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
}
.work-item:hover {
  background: #f3f5fb;
}
.work-title {
  color: var(--text-strong);
  font-weight: 500;
}
.char {
  font-size: 12px;
  color: #8a909c;
}
.rate {
  margin-left: auto;
  font-size: 12px;
  color: #f5a623;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
}
</style>
