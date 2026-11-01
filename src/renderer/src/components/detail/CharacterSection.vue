<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NEmpty,
  NSpin,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NDynamicTags,
  NPopconfirm,
  NCheckbox,
  useMessage,
  useDialog
} from 'naive-ui'
import type {
  Character,
  CharacterInput,
  CharacterKind,
  TmdbSearchItem
} from '@shared/types'
import { toImgUrl, remoteImg } from '@/utils/image'

const props = defineProps<{ kind: CharacterKind; parentId: string; title?: string }>()
const message = useMessage()
const dialog = useDialog()

// 多选批量删除
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(
  () => items.value.length > 0 && selectedIds.value.size === items.value.length
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
    : new Set(items.value.map((c: Character) => c.id))
}
function batchRemove(): void {
  const n = selectedIds.value.size
  if (!n) return
  dialog.warning({
    title: '批量删除',
    content: `确定删除选中的 ${n} 个角色吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await Promise.all(
        [...selectedIds.value].map((id) => window.mook.character.remove(props.kind, id))
      )
      exitSelect()
      await load()
    }
  })
}

// ── 从 TMDB 一键导入角色（仅影视） ──
const tmdbShow = ref(false)
const tmdbKeyword = ref('')
const tmdbResults = ref<TmdbSearchItem[]>([])
const tmdbSearching = ref(false)
const tmdbPicked = ref<TmdbSearchItem | null>(null)
const tmdbImporting = ref(false)

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
  tmdbKeyword.value = props.title ?? ''
  tmdbResults.value = []
  tmdbPicked.value = null
  if (tmdbKeyword.value.trim()) await runTmdbSearch()
}

async function confirmTmdbImport(): Promise<void> {
  if (!tmdbPicked.value) {
    message.warning('请先在搜索结果中选择对应影片')
    return
  }
  tmdbImporting.value = true
  try {
    const r = await window.mook.character.importTmdb(
      props.parentId,
      tmdbPicked.value.id,
      tmdbPicked.value.mediaType
    )
    message.success(`导入完成：新增 ${r.created} 个角色，跳过已存在 ${r.skipped} 个`)
    tmdbShow.value = false
    await load()
  } catch (e) {
    message.error('导入失败：' + String(e))
  } finally {
    tmdbImporting.value = false
  }
}

const items = ref<Character[]>([])
const loading = ref(false)
const editorShow = ref(false)
const saving = ref(false)
const picking = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  id: '',
  name: '',
  role: '',
  aliases: [] as string[],
  tags: [] as string[],
  description: '',
  imagePath: null as string | null
})

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await window.mook.character.list(props.kind, props.parentId)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function openAdd(): Promise<void> {
  editingId.value = null
  form.value = {
    id: await window.mook.character.newId(),
    name: '',
    role: '',
    aliases: [],
    tags: [],
    description: '',
    imagePath: null
  }
  editorShow.value = true
}

function openEdit(c: Character): void {
  editingId.value = c.id
  form.value = {
    id: c.id,
    name: c.name,
    role: c.role ?? '',
    aliases: [...c.aliases],
    tags: [...c.tags],
    description: c.description ?? '',
    imagePath: c.imagePath
  }
  editorShow.value = true
}

async function pickImage(): Promise<void> {
  picking.value = true
  try {
    const p = await window.mook.character.pickImage(form.value.id)
    if (p) form.value.imagePath = p
  } finally {
    picking.value = false
  }
}

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    message.warning('请填写角色名')
    return
  }
  const existingIdx = items.value.findIndex((c) => c.id === form.value.id)
  const charSortOrder = existingIdx >= 0 ? existingIdx : items.value.length
  const payload: CharacterInput = {
    id: form.value.id,
    parentId: props.parentId,
    name: form.value.name.trim(),
    role: form.value.role.trim() || null,
    aliases: form.value.aliases,
    tags: form.value.tags,
    description: form.value.description.trim() || null,
    imagePath: form.value.imagePath,
    sortOrder: charSortOrder
  }
  saving.value = true
  try {
    const isNew = !items.value.some((c) => c.id === payload.id)
    await window.mook.character.save(props.kind, payload, isNew)
    editorShow.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(c: Character): Promise<void> {
  await window.mook.character.remove(props.kind, c.id)
  await load()
}
</script>

<template>
  <div class="section">
    <div class="section-head">
      <span class="section-title">角色（{{ items.length }}）</span>
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
            删除<span v-if="selectedIds.size">（{{ selectedIds.size }}）</span>
          </NButton>
          <NButton size="tiny" quaternary @click="exitSelect">完成</NButton>
        </template>
        <template v-else>
          <NButton size="tiny" quaternary :disabled="!items.length" @click="enterSelect">
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
          <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 添加角色</NButton>
        </template>
      </NSpace>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有角色记录" size="small" />
      <div v-else class="grid">
        <div
          v-for="c in items"
          :key="c.id"
          class="char-card"
          :class="{ picked: selectMode && selectedIds.has(c.id) }"
          @click="selectMode ? toggleSelect(c.id) : undefined"
        >
          <NCheckbox
            v-if="selectMode"
            class="pick-box"
            :checked="selectedIds.has(c.id)"
            @click.stop
            @update:checked="() => toggleSelect(c.id)"
          />
          <div class="char-img">
            <img v-if="c.imagePath" :src="toImgUrl(c.imagePath)" />
            <div v-else class="img-empty">{{ c.name.slice(0, 1) }}</div>
          </div>
          <div class="char-info">
            <div class="char-name">
              {{ c.name }}
              <span v-if="c.role" class="char-role">（{{ c.role }}）</span>
            </div>
            <div v-if="c.aliases.length" class="char-sub">别名：{{ c.aliases.join('、') }}</div>
            <div v-if="c.description" class="char-desc">{{ c.description }}</div>
            <div v-if="!selectMode" class="char-actions">
              <NButton size="tiny" quaternary @click="openEdit(c)">编辑</NButton>
              <NPopconfirm to="body" @positive-click="remove(c)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">删除</NButton>
                </template>
                删除该角色？
              </NPopconfirm>
            </div>
          </div>
        </div>
      </div>
    </NSpin>

    <NModal v-model:show="editorShow" :auto-focus="false">
      <div class="editor">
        <h3>{{ editingId ? '编辑角色' : '添加角色' }}</h3>
        <NForm label-placement="top" size="small">
          <div class="img-row">
            <div class="pick-img">
              <img v-if="form.imagePath" :src="toImgUrl(form.imagePath)" />
              <span v-else>无图片</span>
            </div>
            <NButton size="small" :loading="picking" @click="pickImage">选择图片</NButton>
          </div>
          <div class="grid-2">
            <NFormItem label="角色名">
              <NInput v-model:value="form.name" />
            </NFormItem>
            <NFormItem label="定位 / 身份">
              <NInput v-model:value="form.role" placeholder="如：主角（可选）" />
            </NFormItem>
          </div>
          <NFormItem label="别名">
            <NDynamicTags v-model:value="form.aliases" />
          </NFormItem>
          <NFormItem label="标签">
            <NDynamicTags v-model:value="form.tags" />
          </NFormItem>
          <NFormItem label="描述">
            <NInput
              v-model:value="form.description"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
            />
          </NFormItem>
        </NForm>
        <div class="editor-footer">
          <NSpace justify="end">
            <NButton @click="editorShow = false">取消</NButton>
            <NButton type="primary" :loading="saving" @click="save">保存</NButton>
          </NSpace>
        </div>
      </div>
    </NModal>

    <NModal v-model:show="tmdbShow" :auto-focus="false">
      <div class="editor tmdb-picker">
        <h3>从 TMDB 导入角色</h3>
        <NSpace class="full" align="center">
          <NInput
            v-model:value="tmdbKeyword"
            placeholder="搜索影片标题"
            clearable
            @keyup.enter="runTmdbSearch"
          />
          <NButton type="primary" :loading="tmdbSearching" @click="runTmdbSearch">搜索</NButton>
        </NSpace>
        <p class="tmdb-hint">先搜索并选中对应的影片，再一键导入该片演员饰演的角色名。</p>
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
        <div class="editor-footer">
          <NSpace justify="end">
            <NButton @click="tmdbShow = false">取消</NButton>
            <NButton
              type="primary"
              :loading="tmdbImporting"
              :disabled="!tmdbPicked"
              @click="confirmTmdbImport"
            >
              导入
            </NButton>
          </NSpace>
        </div>
      </div>
    </NModal>
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.char-card {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 10px;
  background: #f8f9fd;
  border-radius: 10px;
  border: 1px solid transparent;
}
.char-card.picked {
  border-color: var(--accent, #2563eb);
  background: color-mix(in srgb, var(--accent, #2563eb) 6%, #f8f9fd);
}
.pick-box {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
}
.char-img {
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  background: #e2e5ee;
}
.char-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.img-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 22px;
}
.char-info {
  flex: 1;
  min-width: 0;
}
.char-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
.char-role {
  font-size: 12px;
  font-weight: 400;
  color: #8a909c;
}
.char-sub {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
}
.char-desc {
  font-size: 12.5px;
  color: #5b616c;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.char-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
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
.img-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}
.pick-img {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  background: #e2e5ee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa0ac;
  font-size: 12px;
}
.pick-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.editor-footer {
  margin-top: 8px;
}
.full {
  width: 100%;
}

/* TMDB 导入选择 */
.tmdb-picker {
  width: 480px;
}
.tmdb-hint {
  margin: 10px 0 8px;
  font-size: 12px;
  color: #8a909c;
}
.tmdb-results {
  max-height: 300px;
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
</style>
