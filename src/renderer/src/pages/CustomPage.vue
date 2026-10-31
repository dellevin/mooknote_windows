<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton,
  NInput,
  NEmpty,
  NSpin,
  NTag,
  NRate,
  useDialog
} from 'naive-ui'
import type { CustomModuleDesign, CustomModuleItem } from '@shared/types'
import { toImgUrl, formatDate } from '@/utils/image'
import ModuleManagePanel from '@/components/custom/ModuleManagePanel.vue'
import ModuleIcon from '@/components/custom/ModuleIcon.vue'
import ItemFormModal from '@/components/custom/ItemFormModal.vue'
import ItemDetailModal from '@/components/custom/ItemDetailModal.vue'
import ItemBinModal from '@/components/custom/ItemBinModal.vue'

const route = useRoute()
const dialog = useDialog()

const moduleId = computed<string | null>(
  () => (route.name === 'custom-module' ? String(route.params.id) : null)
)
const moduleMeta = ref<{ id: string; name: string; icon: string } | null>(null)
const items = ref<CustomModuleItem[]>([])
const design = ref<CustomModuleDesign | null>(null)
const loading = ref(false)
const keyword = ref('')
const inDesignView = ref(false)

watch(moduleId, (id) => {
  if (id) inDesignView.value = false
})

const binShow = ref(false)
const formShow = ref(false)
const detailShow = ref(false)
const editing = ref<CustomModuleItem | null>(null)
const detailItem = ref<CustomModuleItem | null>(null)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return items.value
  return items.value.filter((it) => it.title.toLowerCase().includes(kw))
})

async function loadModule(): Promise<void> {
  keyword.value = ''
  items.value = []
  design.value = null
  moduleMeta.value = null
  const id = moduleId.value
  if (!id) return
  loading.value = true
  try {
    const modules = await window.mook.customModule.list()
    const mod = modules.find((m) => m.id === id)
    if (!mod) return
    moduleMeta.value = { id: mod.id, name: mod.name, icon: mod.icon }
    const [list, d] = await Promise.all([
      window.mook.customItem.list(id),
      window.mook.customDesign.active(id)
    ])
    items.value = list
    design.value = d
  } finally {
    loading.value = false
  }
}

onMounted(loadModule)
watch(moduleId, loadModule)

function onModulesChanged(): void {
  window.dispatchEvent(new Event('custom-modules-changed'))
}

function openCreate(): void {
  if (!design.value) return
  editing.value = null
  formShow.value = true
}
function openEdit(it: CustomModuleItem): void {
  detailShow.value = false
  editing.value = it
  formShow.value = true
}
function openDetail(it: CustomModuleItem): void {
  detailItem.value = it
  detailShow.value = true
}
async function onSaved(): Promise<void> {
  if (!moduleId.value) return
  items.value = await window.mook.customItem.list(moduleId.value)
}
function askDelete(it: CustomModuleItem): void {
  dialog.warning({
    title: '删除条目',
    content: `确定将「${it.title || '无标题条目'}」移入回收站吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.customItem.softDelete(it.id)
      detailShow.value = false
      await onSaved()
    }
  })
}
</script>

<template>
  <div class="page">
    <!-- 分类管理（含分类表单与表单设计，页面内展示） -->
    <template v-if="!moduleId">
      <div v-if="!inDesignView" class="toolbar">
        <h2 class="page-title">自定义分类</h2>
      </div>
      <ModuleManagePanel
        class="manage"
        @changed="onModulesChanged"
        @nav-change="(v: boolean) => (inDesignView = v)"
      />
    </template>

    <!-- 某个分类的条目列表 -->
    <template v-else>
      <div class="toolbar">
        <h2 class="page-title">
          <ModuleIcon :icon="moduleMeta?.icon" :size="20" class="title-ic" />
          {{ moduleMeta?.name || '自定义分类' }}
        </h2>
        <div class="tools">
          <NInput
            v-model:value="keyword"
            placeholder="搜索条目"
            clearable
            size="small"
            class="search"
          />
          <NButton size="small" quaternary @click="binShow = true">回收站</NButton>
          <NButton size="small" type="primary" :disabled="!design" @click="openCreate">
            ＋ 添加条目
          </NButton>
        </div>
      </div>

      <NSpin :show="loading">
        <NEmpty
          v-if="!design && !loading"
          description="该分类还没有启用的表单设计，请到「自定义分类」里配置表单设计"
          class="empty"
        />
        <NEmpty
          v-else-if="!filtered.length"
          :description="keyword ? '没有匹配的条目' : '还没有条目'"
          class="empty"
        />
        <div v-else class="grid">
          <div v-for="it in filtered" :key="it.id" class="card" @click="openDetail(it)">
            <div class="cover">
              <img v-if="it.coverPath" :src="toImgUrl(it.coverPath)" />
              <div v-else class="cover-fallback">
                <ModuleIcon :icon="moduleMeta?.icon" :size="42" />
              </div>
              <NTag v-if="it.status" size="tiny" type="info" :bordered="false" class="status">
                {{ it.status }}
              </NTag>
            </div>
            <div class="card-title">{{ it.title || '无标题条目' }}</div>
            <div class="card-foot">
              <NRate
                v-if="it.rating != null"
                :value="it.rating"
                readonly
                allow-half
                size="small"
              />
              <span v-else></span>
              <span class="date">{{ formatDate(it.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </NSpin>

      <ItemFormModal
        v-if="design"
        v-model:show="formShow"
        :module-id="moduleId"
        :item="editing"
        @saved="onSaved"
      />
      <ItemDetailModal
        v-model:show="detailShow"
        :design="design"
        :item="detailItem"
        @edit="openEdit"
        @delete="askDelete"
      />
      <ItemBinModal v-model:show="binShow" @changed="onSaved" />
    </template>
  </div>
</template>

<style scoped>
.page {
  padding: 18px 24px 28px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.page-title {
  font-size: 18px;
  color: var(--text-strong);
  display: flex;
  align-items: center;
  gap: 8px;
}
.title-ic {
  color: var(--text-strong);
}
.manage {
  width: 100%;
}
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search {
  width: 180px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
  align-content: start;
}
.card {
  background: var(--surface);
  border-radius: 12px;
  padding: 10px;
  border: 1px solid #eef0f4;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.07);
}
.cover {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  background: #f2f3f7;
  margin-bottom: 8px;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: #c2c7d2;
}
.status {
  position: absolute;
  left: 6px;
  bottom: 6px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.date {
  font-size: 11px;
  color: #9aa0ac;
  white-space: nowrap;
}
.empty {
  margin-top: 80px;
}
</style>
