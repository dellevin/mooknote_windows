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
  NCheckbox,
  useMessage,
  useDialog
} from 'naive-ui'
import type {
  MediaKind,
  Person,
  PersonLink,
  PersonLinkWithPerson,
  TmdbCastEntry,
  TmdbSearchItem
} from '@shared/types'
import { PERSON_ROLE_LABELS } from '@shared/types'
import { toImgUrl, remoteImg, plain } from '@/utils/image'
import PersonFormModal from '@/components/people/PersonFormModal.vue'
import PersonDetailModal from '@/components/people/PersonDetailModal.vue'

const props = defineProps<{ kind: MediaKind; parentId: string; title?: string }>()
const message = useMessage()
const dialog = useDialog()

// 多选批量移除关联（只解除本作品的关联，不删除人物档案）
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => links.value.length > 0 && selectedIds.value.size === links.value.length
)
function enterSelect(): void {
  selectMode.value = true
  selectedIds.value = new Set()
}
function exitSelect(): void {
  selectMode.value = false
  selectedIds.value = new Set()
}
function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleSelectAll(): void {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(links.value.map((l: PersonLinkWithPerson) => l.id))
}
function batchRemove(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量移除',
    content: `确定移除选中的 ${n} 个人物关联吗？仅解除与本作品的关联，不会删除人物档案。`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const next = links.value
        .filter((l: PersonLinkWithPerson) => !selectedIds.value.has(l.id))
        .map((l: PersonLinkWithPerson) => ({
          id: l.id,
          workId: l.workId,
          personId: l.personId,
          roleType: l.roleType,
          characterName: l.characterName,
          sortOrder: l.sortOrder
        }))
      exitSelect()
      await persist(next)
    }
  })
}

// ── 从 TMDB 一键导入演职人员（仅影视） ──
const tmdbShow = ref(false)
const tmdbKeyword = ref('')
const tmdbResults = ref<TmdbSearchItem[]>([])
const tmdbSearching = ref(false)
const tmdbPicked = ref<TmdbSearchItem | null>(null)
// step 1=选影片，2=重名合并确认
const tmdbStep = ref<1 | 2>(1)
const castEntries = ref<TmdbCastEntry[]>([])
const peoplePool = ref<Person[]>([])
const picks = ref<Record<number, string>>({})
const tmdbPreviewing = ref(false)
const tmdbImporting = ref(false)

const ROLE_TAG: Record<string, string> = { director: '导演', writer: '编剧', actor: '演员' }

async function runTmdbSearch(): Promise<void> {
  const q = tmdbKeyword.value.trim()
  if (!q) return
  tmdbSearching.value = true
  tmdbPicked.value = null
  try {
    const res = await window.mook.search.tmdbSearch(q, 1)
    tmdbResults.value = res.results
  } catch (e) {
    message.error('TMDB 搜索失败：' + String(e))
    tmdbResults.value = []
  } finally {
    tmdbSearching.value = false
  }
}

async function openTmdb(): Promise<void> {
  tmdbShow.value = true
  tmdbStep.value = 1
  tmdbKeyword.value = props.title ?? ''
  tmdbResults.value = []
  tmdbPicked.value = null
  castEntries.value = []
  picks.value = {}
  if (tmdbKeyword.value.trim()) await runTmdbSearch()
}

// 选好影片 → 拉演职人员 + 本地人物池，同名默认合并
async function previewCast(): Promise<void> {
  if (!tmdbPicked.value) {
    message.warning('请先在搜索结果中选择对应影片')
    return
  }
  tmdbPreviewing.value = true
  try {
    const [entries, pool] = await Promise.all([
      window.mook.person.tmdbCastPreview(tmdbPicked.value.id, tmdbPicked.value.mediaType),
      window.mook.person.list()
    ])
    castEntries.value = entries
    peoplePool.value = pool
    const byName = new Map(pool.map((p) => [p.name, p.id]))
    const next: Record<number, string> = {}
    for (const e of entries) next[e.tmdbId] = byName.get(e.name) ?? 'new'
    picks.value = next
    tmdbStep.value = 2
  } catch (e) {
    message.error('获取演职人员失败：' + String(e))
  } finally {
    tmdbPreviewing.value = false
  }
}

function setPick(tmdbId: number, v: string): void {
  picks.value[tmdbId] = v
}

function mergeOptions(entry: TmdbCastEntry): { label: string; value: string }[] {
  return [
    { label: `新建人物：${entry.name}`, value: 'new' },
    ...peoplePool.value.map((p) => ({ label: `合并到：${p.name}`, value: p.id }))
  ]
}

async function confirmTmdbImport(): Promise<void> {
  tmdbImporting.value = true
  try {
    // IPC 结构化克隆不能传 Vue 响应式 Proxy，先转成纯对象
    const entries = JSON.parse(JSON.stringify(castEntries.value)) as TmdbCastEntry[]
    const choice = JSON.parse(JSON.stringify(picks.value)) as Record<string, string>
    const r = await window.mook.person.importTmdbCast(props.parentId, entries, choice)
    message.success(`导入完成：新建 ${r.created} 人，关联 ${r.linked} 条，跳过已存在 ${r.skipped} 条`)
    tmdbShow.value = false
    await load()
  } catch (e) {
    message.error('导入失败：' + String(e))
  } finally {
    tmdbImporting.value = false
  }
}

const links = ref<PersonLinkWithPerson[]>([])
const loading = ref(false)
const pickerShow = ref(false)
const saving = ref(false)
const removingId = ref<string | null>(null)
const people = ref<Person[]>([])
const formRef = ref({ role: '', personId: null as string | null, characterName: '' })
const createShow = ref(false)
const detailShow = ref(false)
const detailId = ref<string | null>(null)

function openDetail(l: PersonLinkWithPerson): void {
  detailId.value = l.personId
  detailShow.value = true
}

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
  removingId.value = l.id
  try {
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
  } finally {
    removingId.value = null
  }
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
      <NSpace :size="8">
        <template v-if="selectMode">
          <NButton size="tiny" quaternary @click="toggleSelectAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </NButton>
          <NButton
            size="tiny"
            type="error"
            ghost
            :disabled="!selectedIds.size"
            @click="batchRemove"
          >
            移除<span v-if="selectedIds.size">（{{ selectedIds.size }}）</span>
          </NButton>
          <NButton size="tiny" quaternary @click="exitSelect">完成</NButton>
        </template>
        <template v-else>
          <NButton size="tiny" quaternary :disabled="!links.length" @click="enterSelect">
            多选
          </NButton>
          <NButton
            v-if="kind === 'movie'"
            size="tiny"
            type="info"
            ghost
            :loading="tmdbImporting"
            @click="openTmdb"
          >
            从 TMDB 导入
          </NButton>
          <NButton size="tiny" type="primary" ghost @click="openPicker"> ＋ 关联人物 </NButton>
        </template>
      </NSpace>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!links.length && !loading" description="还没有关联人物" size="small" />
      <div v-for="[role, list] in grouped" :key="role" class="role-group">
        <div class="role-label">{{ role }}</div>
        <div class="people-row">
          <div
            v-for="l in list"
            :key="l.id"
            class="person-chip"
            :class="{ picked: selectMode && selectedIds.has(l.id) }"
            @click="selectMode ? toggleSelect(l.id) : undefined"
          >
            <NCheckbox
              v-if="selectMode"
              class="chip-check"
              :checked="selectedIds.has(l.id)"
              @click.stop
              @update:checked="() => toggleSelect(l.id)"
            />
            <button type="button" class="chip-open" @click="selectMode ? undefined : openDetail(l)">
              <span class="chip-avatar">
                <img v-if="l.photoPath" :src="toImgUrl(l.photoPath)" />
                <span v-else>{{ l.name.slice(0, 1) }}</span>
              </span>
              <span class="chip-info">
                <span class="chip-name">{{ l.name }}</span>
                <span v-if="l.characterName" class="chip-char">饰 {{ l.characterName }}</span>
              </span>
            </button>
            <NPopconfirm v-if="!selectMode" to="body" @positive-click="remove(l)">
              <template #trigger>
                <NButton
                  size="tiny"
                  quaternary
                  type="error"
                  :loading="removingId === l.id"
                >
                  ✕
                </NButton>
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

    <NModal v-model:show="tmdbShow" :auto-focus="false">
      <div class="picker tmdb-picker">
        <h3>从 TMDB 导入演职人员</h3>
        <NSpace class="full" align="center">
          <NInput
            v-model:value="tmdbKeyword"
            placeholder="搜索影片标题"
            clearable
            @keyup.enter="runTmdbSearch"
          />
          <NButton type="primary" :loading="tmdbSearching" @click="runTmdbSearch">搜索</NButton>
        </NSpace>
        <template v-if="tmdbStep === 1">
          <p class="tmdb-hint">先搜索并选中对应的影片，下一步确认重名处理方式。</p>
          <div class="tmdb-results">
            <NSpin :show="tmdbSearching">
              <div v-if="!tmdbSearching && !tmdbResults.length" class="tmdb-empty">暂无结果</div>
              <button
                v-for="r in tmdbResults"
                :key="r.mediaType + r.id"
                type="button"
                class="tmdb-item"
                :class="{ on: tmdbPicked?.id === r.id && tmdbPicked.mediaType === r.mediaType }"
                @click="tmdbPicked = r"
              >
                <img
                v-if="r.posterUrl"
                :src="remoteImg(r.posterUrl, 'tmdb')"
                class="tmdb-poster"
                loading="lazy"
              />
                <span v-else class="tmdb-poster tmdb-poster-empty">{{ r.title.slice(0, 1) }}</span>
                <span class="tmdb-meta">
                  <span class="tmdb-name">{{ r.title }}</span>
                  <span class="tmdb-sub">
                    {{ r.mediaType === 'tv' ? '剧集' : '电影' }}<template v-if="r.date">
                      · {{ r.date.slice(0, 4) }}</template
                    >
                  </span>
                </span>
              </button>
            </NSpin>
          </div>
          <div class="picker-footer">
            <NSpace justify="end">
              <NButton @click="tmdbShow = false">取消</NButton>
              <NButton
                type="primary"
                :loading="tmdbPreviewing"
                :disabled="!tmdbPicked"
                @click="previewCast"
              >
                下一步
              </NButton>
            </NSpace>
          </div>
        </template>

        <template v-else>
          <p class="tmdb-hint">
            共 {{ castEntries.length }} 位演职人员。与人物库同名的可选择「合并到」已有人物，或新建。
          </p>
          <div class="tmdb-results cast-list">
            <NSpin :show="tmdbPreviewing">
              <div v-for="e in castEntries" :key="e.tmdbId" class="cast-row">
                <img
                  v-if="e.profileUrl"
                  :src="remoteImg(e.profileUrl, 'tmdb')"
                  class="cast-avatar"
                  loading="lazy"
                />
                <span v-else class="cast-avatar cast-avatar-empty">{{ e.name.slice(0, 1) }}</span>
                <span class="cast-meta">
                  <span class="cast-name">{{ e.name }}</span>
                  <span class="cast-parts">
                    <span v-for="p in e.parts" :key="p.role + (p.character ?? '')" class="cast-tag">
                      {{ ROLE_TAG[p.role] }}<template v-if="p.character">·饰 {{ p.character }}</template>
                    </span>
                  </span>
                </span>
                <NSelect
                  :value="picks[e.tmdbId]"
                  :options="mergeOptions(e)"
                  size="small"
                  class="cast-pick"
                  :consistent-menu-width="false"
                  filterable
                  @update:value="(v) => setPick(e.tmdbId, v)"
                />
              </div>
            </NSpin>
          </div>
          <div class="picker-footer">
            <NSpace justify="end">
              <NButton :disabled="tmdbImporting" @click="tmdbStep = 1">上一步</NButton>
              <NButton
                type="primary"
                :loading="tmdbImporting"
                @click="confirmTmdbImport"
              >
                导入
              </NButton>
            </NSpace>
          </div>
        </template>
      </div>
    </NModal>

    <PersonFormModal v-model:show="createShow" :person="null" @saved="onPersonCreated" />

    <PersonDetailModal
      v-model:show="detailShow"
      :id="detailId"
      @changed="load"
      @open-work="() => (detailShow = false)"
    />
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
  color: var(--text-strong);
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
  border: 1px solid transparent;
}
.person-chip.picked {
  border-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 6%, #f8f9fd);
}
.chip-check {
  flex-shrink: 0;
}
.chip-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.chip-open:hover .chip-name {
  color: var(--accent, #2563eb);
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
  color: var(--text-strong);
}
.chip-char {
  font-size: 12px;
  color: #8a909c;
}
.picker {
  width: 460px;
  max-width: 92vw;
  background: var(--surface);
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

/* TMDB 导入选择 */
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
.tmdb-item:hover {
  background: #f5f6f8;
}
.tmdb-item.on {
  background: #eef3ff;
  border-color: var(--accent, #2563eb);
}
.tmdb-poster {
  width: 32px;
  height: 44px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 4px;
  background: #f0f1f4;
}
.tmdb-poster-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #b6bcc6;
}
.tmdb-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tmdb-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tmdb-sub {
  font-size: 11.5px;
  color: #8a909c;
}

/* 第二步：重名合并确认 */
.cast-list {
  max-height: 380px;
}
.cast-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
}
.cast-row + .cast-row {
  border-top: 1px solid rgba(17, 17, 17, 0.05);
}
.cast-avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  background: #e2e5ee;
}
.cast-avatar-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #9aa0ac;
}
.cast-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cast-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cast-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.cast-tag {
  font-size: 10.5px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(17, 17, 17, 0.06);
  color: #5b616c;
}
.cast-pick {
  flex-shrink: 0;
  width: 150px;
}
</style>
