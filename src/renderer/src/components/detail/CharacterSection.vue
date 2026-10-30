<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
  useMessage
} from 'naive-ui'
import type { Character, CharacterInput, CharacterKind } from '@shared/types'
import { toImgUrl } from '@/utils/image'

const props = defineProps<{ kind: CharacterKind; parentId: string }>()
const message = useMessage()

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
      <NButton size="tiny" type="primary" ghost @click="openAdd">＋ 添加角色</NButton>
    </div>
    <NSpin :show="loading">
      <NEmpty v-if="!items.length && !loading" description="还没有角色记录" size="small" />
      <div v-else class="grid">
        <div v-for="c in items" :key="c.id" class="char-card">
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
            <div class="char-actions">
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.char-card {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: #f8f9fd;
  border-radius: 10px;
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
  color: #1f2329;
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
  background: #fff;
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
</style>
