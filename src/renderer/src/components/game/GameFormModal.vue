<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import {
  NModal,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NDatePicker,
  NButton,
  NSpace,
  NRadioGroup,
  NRadioButton,
  NRate,
  useMessage
} from 'naive-ui'
import type { GameInput, GameStatus } from '@shared/types'
import { GAME_STATUS_LABELS, GAME_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, isoToTs, tsToIso, plain } from '@/utils/image'
import TagPickField from '@/components/form/TagPickField.vue'

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

const coverUrl = computed(() => toImgUrl(form.coverPath))

// 星级：NRate 为 5 星半星制，存储为 0–10
const starValue = computed({
  get: () => (form.rating == null ? null : form.rating / 2),
  set: (v: number | null) => {
    form.rating = v == null ? null : Math.round(v * 2 * 10) / 10
  }
})

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
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :auto-focus="false"
  >
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
          <div class="cover-box" title="选择封面" @click="chooseCover">
            <img v-if="coverUrl" :src="coverUrl" />
            <div v-else class="cover-empty">无封面</div>
            <div class="cover-mask">
              <NButton size="tiny" secondary :loading="picking">选择封面</NButton>
            </div>
          </div>
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
            <!-- 基本信息 -->
            <div class="sec-title">基本信息</div>
            <NFormItem label="游戏名称" required>
              <NInput v-model:value="form.title" placeholder="游戏名称" />
            </NFormItem>

            <NFormItem label="状态">
              <NRadioGroup v-model:value="form.status" type="button" size="small">
                <NRadioButton v-for="o in statusOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <NFormItem label="介质">
              <NRadioGroup v-model:value="form.category" type="button" size="small">
                <NRadioButton v-for="o in categoryOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </NRadioButton>
              </NRadioGroup>
            </NFormItem>

            <NFormItem label="我的评分">
              <div class="rate-row">
                <NRate v-model:value="starValue" allow-half size="small" :max="5" />
                <span class="rate-num">{{ form.rating != null ? form.rating : '—' }}</span>
                <NButton
                  v-if="form.rating != null"
                  size="tiny"
                  quaternary
                  @click="form.rating = null"
                >
                  清除
                </NButton>
              </div>
            </NFormItem>

            <!-- 创作信息 -->
            <div class="sec-title">创作信息</div>
            <NFormItem label="开发者">
              <TagPickField
                v-model="form.developer"
                label="开发者"
                :candidates="meta.developer"
              />
            </NFormItem>
            <NFormItem label="平台">
              <TagPickField
                v-model="form.platforms"
                label="平台"
                :candidates="meta.platforms"
                placeholder="如 PC / Switch / PS5"
              />
            </NFormItem>
            <TagPickField
              v-model="form.genres"
              label="类型"
              cloud
              :candidates="meta.genres"
            />
            <NFormItem label="版本">
              <TagPickField
                v-model="form.versions"
                label="版本"
                :candidates="[]"
                placeholder="如 标准版 / 年度版"
              />
            </NFormItem>

            <!-- 游玩记录 -->
            <div class="sec-title">游玩记录</div>
            <div class="grid-3">
              <NFormItem label="游玩次数">
                <NInputNumber
                  v-model:value="form.playCount"
                  :min="0"
                  :step="1"
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
            <div class="grid-3">
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
              <NFormItem label="购买价格">
                <NInput v-model:value="form.purchasePrice" placeholder="如 198" />
              </NFormItem>
            </div>
            <NFormItem label="购买平台">
              <TagPickField
                v-model="form.purchasePlatforms"
                label="购买平台"
                :candidates="[]"
                placeholder="Steam / Epic 等"
              />
            </NFormItem>

            <!-- 简介 -->
            <div class="sec-title">简介</div>
            <NFormItem label="游戏简介">
              <NInput
                v-model:value="form.summary"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 8 }"
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
  width: 920px;
  max-width: 95vw;
}
.form-card :deep(.n-card__content) {
  padding-top: 8px;
}
.form-body {
  display: flex;
  gap: 22px;
  max-height: 74vh;
}
.cover-col {
  flex: 0 0 170px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cover-box {
  position: relative;
  width: 170px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: #eef0f5;
  cursor: pointer;
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
.cover-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cover-box:hover .cover-mask {
  opacity: 1;
}
.fields-col {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 6px;
}
.sec-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  margin: 14px 0 6px;
  padding-left: 8px;
  border-left: 3px solid var(--accent);
}
.sec-title:first-child {
  margin-top: 2px;
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
.rate-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rate-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  min-width: 26px;
}
</style>
