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
  }
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

const tagFields: { key: 'platforms' | 'genres' | 'versions'; label: string }[] = [
  { key: 'platforms', label: '平台' },
  { key: 'genres', label: '类型' },
  { key: 'versions', label: '版本' }
]
const playTimeText = (g: Game): string =>
  g.playTimeHours || g.playTimeMinutes
    ? `${g.playTimeHours} 小时 ${g.playTimeMinutes} 分`
    : ''
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="detail-card">
      <NSpin :show="loading">
        <NEmpty v-if="!game && !loading" description="记录不存在或已删除" />
        <template v-else-if="game">
          <div class="hero">
            <div class="cover">
              <img v-if="toImgUrl(game.coverPath)" :src="toImgUrl(game.coverPath)" />
              <div v-else class="cover-empty">无封面</div>
            </div>
            <div class="head-info">
              <h2 class="title">{{ game.title }}</h2>
              <div class="badges">
                <NTag size="small" type="primary" :bordered="false">
                  {{ GAME_STATUS_LABELS[game.status] }}
                </NTag>
                <NTag size="small" :bordered="false">
                  {{ GAME_CATEGORY_LABELS[game.category] ?? game.category }}
                </NTag>
              </div>
              <div v-if="game.rating != null" class="rating-row">
                <NRate :value="game.rating" :max="10" allow-half readonly size="small" />
                <span class="rating-num">{{ game.rating.toFixed(1) }}</span>
              </div>
              <div class="kv">
                <span v-if="game.releaseDate">发售：{{ formatDate(game.releaseDate) }}</span>
                <span v-if="playTimeText(game)">时长：{{ playTimeText(game) }}</span>
                <span v-if="game.playCount">玩过 {{ game.playCount }} 次</span>
                <span v-if="game.purchaseDate">购入：{{ formatDate(game.purchaseDate) }}</span>
                <span v-if="game.purchasePrice">价格：{{ game.purchasePrice }}</span>
              </div>
            </div>
          </div>

          <div class="body">
            <NTabs type="line" animated size="small">
              <NTabPane name="info" tab="资料">
                <div v-if="game.developer" class="tag-row">
                  <span class="tag-label">开发者</span>
                  <span class="dev">{{ game.developer }}</span>
                </div>
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
      </NSpin>
    </div>
  </NModal>
</template>

<style scoped>
.detail-card {
  width: 760px;
  max-width: 94vw;
  max-height: 86vh;
  background: #fff;
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
.cover {
  flex: 0 0 150px;
  width: 150px;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  background: #e2e5ee;
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
  color: #9aa0ac;
}
.head-info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 22px;
  color: #1f2329;
  margin-bottom: 6px;
}
.badges {
  display: flex;
  gap: 8px;
  margin: 4px 0 12px;
}
.rating-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.rating-num {
  font-size: 20px;
  font-weight: 700;
  color: #f5a623;
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
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.tag-label {
  flex: 0 0 52px;
  font-size: 13px;
  color: #8a909c;
  padding-top: 2px;
}
.dev {
  font-size: 13px;
  color: #3d434d;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  margin: 8px 0;
}
.summary p {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3d434d;
  white-space: pre-wrap;
}
.footer {
  padding: 12px 26px;
  border-top: 1px solid #f0f1f4;
}
</style>
