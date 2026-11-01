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
  NSpin,
  useMessage
} from 'naive-ui'
import type { Person, PersonInput, TmdbPersonSearchItem } from '@shared/types'
import { toImgUrl, remoteImg, isoToTs, tsToIso, plain } from '@/utils/image'

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

// ── 从 TMDB 拉取人物信息 ──
const tmdbShow = ref(false)
const tmdbKeyword = ref('')
const tmdbResults = ref<TmdbPersonSearchItem[]>([])
const tmdbSearching = ref(false)
const tmdbFetching = ref<number | null>(null)

async function openTmdb(): Promise<void> {
  tmdbShow.value = true
  tmdbKeyword.value = form.value.name || props.person?.name || ''
  tmdbResults.value = []
  if (tmdbKeyword.value.trim()) await runTmdbSearch()
}

async function runTmdbSearch(): Promise<void> {
  const q = tmdbKeyword.value.trim()
  if (!q) return
  tmdbSearching.value = true
  try {
    tmdbResults.value = await window.mook.person.tmdbSearchPeople(q)
  } catch (e) {
    message.error('TMDB 搜索失败：' + String(e))
    tmdbResults.value = []
  } finally {
    tmdbSearching.value = false
  }
}

// 只补空字段，已有内容不覆盖
async function pickTmdbPerson(item: TmdbPersonSearchItem): Promise<void> {
  tmdbFetching.value = item.id
  try {
    const info = await window.mook.person.tmdbFetchPerson(item.id, form.value.id)
    const f = form.value
    if (!f.name.trim()) f.name = info.name
    if (!f.gender && info.gender) f.gender = info.gender
    if (!f.birthTs && info.birthDate) f.birthTs = isoToTs(info.birthDate)
    if (!f.birthPlace.trim() && info.birthPlace) f.birthPlace = info.birthPlace
    if (!f.alternateNames.length) f.alternateNames = [...info.alternateNames]
    if (!f.occupation.length) f.occupation = [...info.occupation]
    if (!f.summary.trim() && info.summary) f.summary = info.summary
    if (!f.photoPath && info.photoPath) f.photoPath = info.photoPath
    tmdbShow.value = false
    message.success('已从 TMDB 填充空白信息')
  } catch (e) {
    message.error('获取人物信息失败：' + String(e))
  } finally {
    tmdbFetching.value = null
  }
}

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
  <NModal
    :show="show"
    @update:show="(v) => emit('update:show', v)"
    :auto-focus="false"
  >
    <div class="editor">
      <div class="head-row">
        <h3>{{ props.person ? '编辑人物' : '新建人物' }}</h3>
        <NButton size="tiny" type="info" ghost @click="openTmdb">从 TMDB 获取</NButton>
      </div>
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

  <NModal v-model:show="tmdbShow" :auto-focus="false">
      <div class="tmdb-editor">
        <h3>从 TMDB 获取人物信息</h3>
        <NSpace class="full" align="center">
          <NInput
            v-model:value="tmdbKeyword"
            placeholder="搜索人物姓名"
            clearable
            @keyup.enter="runTmdbSearch"
          />
          <NButton type="primary" :loading="tmdbSearching" @click="runTmdbSearch">搜索</NButton>
        </NSpace>
        <p class="tmdb-hint">选择对应人物后，仅填充当前表单中为空的字段，已有内容保留。</p>
        <div class="tmdb-results">
          <NSpin :show="tmdbSearching">
            <div v-if="!tmdbSearching && !tmdbResults.length" class="tmdb-empty">暂无结果</div>
            <button
              v-for="r in tmdbResults"
              :key="r.id"
              type="button"
              class="tmdb-item"
              :disabled="tmdbFetching !== null"
              @click="pickTmdbPerson(r)"
            >
              <img
                v-if="r.profileUrl"
                :src="remoteImg(r.profileUrl, 'tmdb')"
                class="tmdb-avatar"
                loading="lazy"
              />
              <span v-else class="tmdb-avatar tmdb-avatar-empty">{{ r.name.slice(0, 1) }}</span>
              <span class="tmdb-meta">
                <span class="tmdb-name">{{ r.name }}</span>
                <span v-if="r.knownFor" class="tmdb-sub">代表作：{{ r.knownFor }}</span>
              </span>
              <span v-if="tmdbFetching === r.id" class="tmdb-loading">获取中…</span>
            </button>
          </NSpin>
        </div>
        <div class="editor-footer">
          <NSpace justify="end">
            <NButton @click="tmdbShow = false">取消</NButton>
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
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head-row h3 {
  margin-bottom: 14px;
}

/* TMDB 人物选择 */
.tmdb-editor {
  width: 480px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.tmdb-editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.full {
  width: 100%;
}
.tmdb-hint {
  margin: 10px 0 8px;
  font-size: 12px;
  color: #8a909c;
}
.tmdb-results {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid rgba(17, 17, 17, 0.08);
  border-radius: 10px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tmdb-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12.5px;
  color: #a8adb8;
}
.tmdb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.tmdb-item:hover:not(:disabled) {
  background: #f5f6f8;
}
.tmdb-item:disabled {
  cursor: default;
}
.tmdb-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  background: #e2e5ee;
}
.tmdb-avatar-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: #9aa0ac;
}
.tmdb-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tmdb-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
}
.tmdb-sub {
  font-size: 11.5px;
  color: #8a909c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tmdb-loading {
  font-size: 12px;
  color: var(--accent, #2563eb);
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
