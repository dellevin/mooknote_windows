<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import {
  NModal,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NDatePicker,
  NButton,
  NSpace,
  useMessage
} from 'naive-ui'
import type { GameInput, GameStatus } from '@shared/types'
import { GAME_STATUS_LABELS, GAME_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain } from '@/utils/image'

const props = defineProps<{ show: boolean; editId?: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const message = useMessage()
const saving = ref(false)
const picking = ref(false)

interface FormState {
  id: string
  title: string
  coverPath: string | null
  rating: number | null
  status: GameStatus
  category: string
  platforms: string[]
  versions: string[]
  genres: string[]
  playTimeHours: number
  playTimeMinutes: number
  playCount: number
  developer: string[]
  releaseTs: number | null
  purchasePlatforms: string[]
  purchaseTs: number | null
  purchasePrice: string
  summary: string
  coverOffset: number
}

function emptyForm(id: string): FormState {
  return {
    id,
    title: '',
    coverPath: null,
    rating: null,
    status: 'want_to_play',
    category: 'digital',
    platforms: [],
    versions: [],
    genres: [],
    playTimeHours: 0,
    playTimeMinutes: 0,
    playCount: 0,
    developer: [],
    releaseTs: null,
    purchasePlatforms: [],
    purchaseTs: null,
    purchasePrice: '',
    summary: '',
    coverOffset: 0
  }
}

const form = reactive<FormState>(emptyForm(''))

const statusOptions = Object.entries(GAME_STATUS_LABELS).map(([value, label]) => ({
  label,
  value
}))
const categoryOptions = Object.entries(GAME_CATEGORY_LABELS).map(([value, label]) => ({
  label,
  value
}))

const meta = ref<{ platforms: string[]; genres: string[]; developer: string[] }>({
  platforms: [],
  genres: [],
  developer: []
})
const opts = (list: string[]) => list.map((v) => ({ label: v, value: v }))
const platformOptions = computed(() => opts(meta.value.platforms))
const genreOptions = computed(() => opts(meta.value.genres))
const devOptions = computed(() => opts(meta.value.developer))

const coverUrl = computed(() => toImgUrl(form.coverPath))

onMounted(async () => {
  meta.value = await window.mook.game.metadata()
})

async function hydrate(): Promise<void> {
  meta.value = await window.mook.game.metadata()
  if (props.editId) {
    const g = await window.mook.game.get(props.editId)
    if (g) {
      Object.assign(form, {
        ...emptyForm(g.id),
        title: g.title,
        coverPath: g.coverPath,
        rating: g.rating,
        status: g.status,
        category: g.category,
        platforms: [...g.platforms],
        versions: [...g.versions],
        genres: [...g.genres],
        playTimeHours: g.playTimeHours,
        playTimeMinutes: g.playTimeMinutes,
        playCount: g.playCount,
        developer: [...g.developer],
        releaseTs: isoToTs(g.releaseDate),
        purchasePlatforms: [...g.purchasePlatforms],
        purchaseTs: isoToTs(g.purchaseDate),
        purchasePrice: g.purchasePrice ?? '',
        summary: g.summary ?? '',
        coverOffset: g.coverOffset
      })
      return
    }
  }
  Object.assign(form, emptyForm(await window.mook.game.newId()))
}

async function chooseCover(): Promise<void> {
  picking.value = true
  try {
    const p = await window.mook.game.pickCover(form.id)
    if (p) form.coverPath = p
  } finally {
    picking.value = false
  }
}

function close(): void {
  emit('update:show', false)
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    message.warning('请填写游戏名称')
    return
  }
  saving.value = true
  try {
    const payload: GameInput = {
      id: form.id,
      title: form.title.trim(),
      coverPath: form.coverPath,
      rating: form.rating,
      status: form.status,
      category: form.category,
      platforms: form.platforms,
      versions: form.versions,
      genres: form.genres,
      playTimeHours: form.playTimeHours || 0,
      playTimeMinutes: form.playTimeMinutes || 0,
      playCount: form.playCount || 0,
      developer: form.developer,
      releaseDate: tsToIso(form.releaseTs),
      purchasePlatforms: form.purchasePlatforms,
      purchaseDate: tsToIso(form.purchaseTs),
      purchasePrice: form.purchasePrice.trim() || null,
      summary: form.summary.trim() || null,
      coverOffset: form.coverOffset
    }
    const body = plain(payload)
    if (props.editId) await window.mook.game.update(body)
    else await window.mook.game.create(body)
    message.success(props.editId ? '已保存修改' : '已添加')
    emit('saved')
    close()
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    saving.value = false
  }
}

defineExpose({ hydrate })
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <NCard
      class="form-card"
      :title="editId ? '编辑游戏' : '添加游戏'"
      closable
      size="small"
      :bordered="false"
      @close="close"
    >
      <div class="form-body">
        <div class="cover-col">
          <div class="cover-box">
            <img v-if="coverUrl" :src="coverUrl" />
            <div v-else class="cover-empty">无封面</div>
          </div>
          <NButton size="small" :loading="picking" block @click="chooseCover">选择封面</NButton>
          <NButton
            v-if="form.coverPath"
            size="small"
            quaternary
            type="error"
            block
            @click="form.coverPath = null"
          >
            移除封面
          </NButton>
        </div>

        <div class="fields-col">
          <NForm label-placement="top" size="small">
            <NFormItem label="游戏名称" required>
              <NInput v-model:value="form.title" placeholder="游戏名称" />
            </NFormItem>

            <div class="grid-2">
              <NFormItem label="状态">
                <NSelect v-model:value="form.status" :options="statusOptions" />
              </NFormItem>
              <NFormItem label="介质">
                <NSelect v-model:value="form.category" :options="categoryOptions" />
              </NFormItem>
            </div>

            <div class="grid-3">
              <NFormItem label="评分（0-10）">
                <NInputNumber
                  v-model:value="form.rating"
                  :min="0"
                  :max="10"
                  :step="0.5"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="时长（小时）">
                <NInputNumber
                  v-model:value="form.playTimeHours"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
              <NFormItem label="时长（分钟）">
                <NInputNumber
                  v-model:value="form.playTimeMinutes"
                  :min="0"
                  :max="59"
                  :step="1"
                  class="full"
                />
              </NFormItem>
            </div>

            <NFormItem label="平台">
              <NSelect
                v-model:value="form.platforms"
                :options="platformOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="如 PC / Switch / PS5"
              />
            </NFormItem>
            <NFormItem label="开发者">
              <NSelect
                v-model:value="form.developer"
                :options="devOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="输入后回车添加"
              />
            </NFormItem>
            <NFormItem label="类型">
              <NSelect
                v-model:value="form.genres"
                :options="genreOptions"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="如 RPG / 动作"
              />
            </NFormItem>
            <NFormItem label="版本">
              <NSelect
                v-model:value="form.versions"
                :options="[]"
                multiple
                filterable
                tag
                clearable
                class="full"
                placeholder="如 标准版 / 年度版"
              />
            </NFormItem>

            <div class="grid-3">
              <NFormItem label="游玩次数">
                <NInputNumber
                  v-model:value="form.playCount"
                  :min="0"
                  :step="1"
                  class="full"
                />
              </NFormItem>
              <NFormItem label="发售日期">
                <NDatePicker
                  v-model:value="form.releaseTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
              <NFormItem label="购买日期">
                <NDatePicker
                  v-model:value="form.purchaseTs"
                  type="date"
                  clearable
                  class="full"
                />
              </NFormItem>
            </div>

            <div class="grid-2">
              <NFormItem label="购买平台">
                <NSelect
                  v-model:value="form.purchasePlatforms"
                  :options="[]"
                  multiple
                  filterable
                  tag
                  clearable
                  class="full"
                  placeholder="Steam / Epic 等"
                />
              </NFormItem>
              <NFormItem label="购买价格">
                <NInput v-model:value="form.purchasePrice" placeholder="如 198" />
              </NFormItem>
            </div>

            <NFormItem label="简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 6 }"
                placeholder="游戏简介"
              />
            </NFormItem>
          </NForm>
        </div>
      </div>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="close">取消</NButton>
          <NButton type="primary" :loading="saving" @click="save">保存</NButton>
        </NSpace>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.form-card {
  width: 860px;
  max-width: 94vw;
}
.form-body {
  display: flex;
  gap: 20px;
  max-height: 72vh;
}
.cover-col {
  flex: 0 0 150px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cover-box {
  width: 150px;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: #eef0f5;
}
.cover-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0a6b2;
  font-size: 13px;
}
.fields-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 14px;
}
.full {
  width: 100%;
}
</style>
