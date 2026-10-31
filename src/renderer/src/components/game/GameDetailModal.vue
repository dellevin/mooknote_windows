<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NTag,
  NRate,
  NEmpty,
  NSpin,
  NTabs,
  NTabPane,
  useDialog
} from 'naive-ui'
import type { Game } from '@shared/types'
import { GAME_STATUS_LABELS, GAME_CATEGORY_LABELS } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import ReviewSection from '@/components/detail/ReviewSection.vue'
import ImageCollectionSection from '@/components/detail/ImageCollectionSection.vue'
import ProgressSection from '@/components/detail/ProgressSection.vue'
import CompletionSection from '@/components/detail/CompletionSection.vue'
import PeopleSection from '@/components/detail/PeopleSection.vue'
import CharacterSection from '@/components/detail/CharacterSection.vue'

const props = defineProps<{ show: boolean; id: string | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'edit', id: string): void
  (e: 'changed'): void
}>()

const dialog = useDialog()
const game = ref<Game | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  if (!props.id) return
  loading.value = true
  try {
    game.value = await window.mook.game.get(props.id)
  } finally {
    loading.value = false
  }
}
watch(
  () => [props.show, props.id],
  ([s]) => {
    if (s) void load()
  },
  { immediate: true }
)

function askDelete(): void {
  if (!game.value) return
  const g = game.value
  dialog.warning({
    title: '删除游戏',
    content: `确定将「${g.title}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.game.softDelete(g.id)
      emit('changed')
      emit('update:show', false)
    }
  })
}

const tagFields: {
  key: 'developer' | 'platforms' | 'genres' | 'versions' | 'purchasePlatforms'
  label: string
}[] = [
  { key: 'developer', label: '开发者' },
  { key: 'platforms', label: '平台' },
  { key: 'genres', label: '类型' },
  { key: 'versions', label: '版本' },
  { key: 'purchasePlatforms', label: '购入平台' }
]
const playTimeText = (g: Game): string => {
  const parts: string[] = []
  if (g.playTimeHours) parts.push(`${g.playTimeHours} 小时`)
  if (g.playTimeMinutes) parts.push(`${g.playTimeMinutes} 分`)
  return parts.join(' ')
}
const STATUS_TYPE: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  want_to_play: 'info',
  playing: 'success',
  completed: 'warning',
  abandoned: 'default'
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-card">
      <div v-if="loading" class="state">
        <NSpin size="medium" />
      </div>
      <NEmpty v-else-if="!game" class="state" description="记录不存在或已删除" />
      <template v-else>
        <div class="hero" :class="{ 'no-cover': !toImgUrl(game.coverPath) }">
            <img
              v-if="toImgUrl(game.coverPath)"
              class="hero-bg"
              :src="toImgUrl(game.coverPath)"
              alt=""
            />
            <div class="hero-mask"></div>
            <div class="cover">
              <img v-if="toImgUrl(game.coverPath)" :src="toImgUrl(game.coverPath)" />
              <div v-else class="cover-empty">无封面</div>
            </div>
            <div class="head-info">
              <h2 class="title">{{ game.title }}</h2>
              <div class="badges">
                <NTag size="small" :type="STATUS_TYPE[game.status]" round :bordered="false">
                  {{ GAME_STATUS_LABELS[game.status] }}
                </NTag>
                <NTag size="small" round :bordered="false" class="cat-tag">
                  {{ GAME_CATEGORY_LABELS[game.category] ?? game.category }}
                </NTag>
              </div>
              <div v-if="game.rating != null" class="rating-row">
                <NRate :value="game.rating" :max="10" allow-half readonly size="small" />
                <span class="rating-num">{{ game.rating.toFixed(1) }}</span>
              </div>
              <div class="kv">
                <span v-if="game.releaseDate" class="chip">
                  <i>发售</i>{{ formatDate(game.releaseDate) }}
                </span>
                <span v-if="playTimeText(game)" class="chip">
                  <i>时长</i>{{ playTimeText(game) }}
                </span>
                <span v-if="game.playCount" class="chip">
                  <i>周目</i>{{ game.playCount }} 次
                </span>
                <span v-if="game.purchaseDate" class="chip">
                  <i>购入</i>{{ formatDate(game.purchaseDate) }}
                </span>
                <span v-if="game.purchasePrice" class="chip">
                  <i>价格</i>{{ game.purchasePrice }}
                </span>
              </div>
            </div>
          </div>

          <div class="body">
            <NTabs type="line" animated size="small">
              <NTabPane name="info" tab="资料">
                <div
                  v-for="f in tagFields"
                  :key="f.key"
                  v-show="game[f.key].length"
                  class="tag-row"
                >
                  <span class="tag-label">{{ f.label }}</span>
                  <NSpace :size="6">
                    <NTag v-for="v in game[f.key]" :key="v" size="small" :bordered="false">
                      {{ v }}
                    </NTag>
                  </NSpace>
                </div>

                <div v-if="game.summary" class="summary">
                  <div class="section-title">简介</div>
                  <p>{{ game.summary }}</p>
                </div>
                <NEmpty v-else-if="!game.summary" description="暂无简介" size="small" />
              </NTabPane>

              <NTabPane name="reviews" tab="评价">
                <ReviewSection :key="'rv-' + game.id" kind="game" :parent-id="game.id" />
              </NTabPane>

              <NTabPane name="screenshots" tab="截图">
                <ImageCollectionSection
                  :key="'ss-' + game.id"
                  kind="screenshot"
                  :parent-id="game.id"
                  title="截图墙"
                />
              </NTabPane>

              <NTabPane name="levels" tab="关卡">
                <ProgressSection
                  :key="'lv-' + game.id"
                  kind="level"
                  :parent-id="game.id"
                  title="关卡记录"
                  no-label="关"
                />
              </NTabPane>

              <NTabPane name="completions" tab="通关">
                <CompletionSection :key="'cp-' + game.id" :game-id="game.id" />
              </NTabPane>

              <NTabPane name="people" tab="人物">
                <PeopleSection :key="'pp-' + game.id" kind="game" :parent-id="game.id" />
              </NTabPane>

              <NTabPane name="characters" tab="角色">
                <CharacterSection :key="'cr-' + game.id" kind="game" :parent-id="game.id" />
              </NTabPane>
            </NTabs>
          </div>

        <div class="footer">
          <NSpace justify="end">
            <NButton type="error" quaternary @click="askDelete">删除</NButton>
            <NButton type="primary" @click="emit('edit', game.id)">编辑</NButton>
          </NSpace>
        </div>
      </template>
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  height: 86vh;
  max-height: 86vh;
  background: var(--surface);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.state {
  flex: 1;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 游戏商店风格：封面虚化铺底 + 深色遮罩，盒装箱绘浮于左侧 */
.hero {
  position: relative;
  display: flex;
  gap: 22px;
  padding: 26px 28px 22px;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, #232838, #171a24 60%, #10131c);
}
.hero.no-cover {
  background: linear-gradient(135deg, #2b3350, #1b2030 55%, #121521);
}
.hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(30px) brightness(0.55) saturate(1.25);
  transform: scale(1.18);
  pointer-events: none;
  user-select: none;
}
.hero-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    rgba(13, 16, 24, 0.72) 0%,
    rgba(13, 16, 24, 0.45) 45%,
    rgba(13, 16, 24, 0.62) 100%
  );
  pointer-events: none;
}
.cover {
  position: relative;
  z-index: 1;
  flex: 0 0 148px;
  width: 148px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  background: rgba(255, 255, 255, 0.08);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
.head-info {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 23px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 10px;
  line-height: 1.3;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.badges {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.cat-tag {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #e8ebf5 !important;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #ffc53d;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.kv {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 3px 10px;
}
.chip i {
  font-style: normal;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
.body {
  padding: 18px 26px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 56px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 3px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 14px 0 8px;
}
.summary {
  background: #f7f8fa;
  border-radius: 10px;
  padding: 12px 14px;
  margin-top: 14px;
}
.summary .section-title {
  margin-top: 0;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
  margin: 0;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
  flex-shrink: 0;
}
</style>
