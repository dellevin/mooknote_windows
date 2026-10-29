<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NEmpty, NSpin, NTag, NPopconfirm } from 'naive-ui'
import type { CustomModule, CustomModuleDesign, CustomFieldDef } from '@shared/types'
import { CUSTOM_FIELD_TYPE_LABELS } from '@shared/types'
import { formatDate } from '@/utils/image'
import DesignerPanel from './DesignerPanel.vue'

const props = defineProps<{ module: CustomModule | null }>()
const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'back'): void
}>()

const items = ref<CustomModuleDesign[]>([])
const loading = ref(false)
const designerShow = ref(false)
const editing = ref<CustomModuleDesign | null>(null)

async function load(): Promise<void> {
  if (!props.module) return
  loading.value = true
  try {
    items.value = await window.mook.customDesign.list(props.module.id)
  } finally {
    loading.value = false
  }
}
watch(
  () => props.module,
  () => {
    designerShow.value = false
    void load()
  },
  { immediate: true }
)

function openCreate(): void {
  editing.value = null
  designerShow.value = true
}
function openEdit(d: CustomModuleDesign): void {
  editing.value = d
  designerShow.value = true
}
async function activate(d: CustomModuleDesign): Promise<void> {
  if (!props.module || d.isActive) return
  await window.mook.customDesign.setActive(props.module.id, d.id)
  emit('changed')
  await load()
}
async function remove(d: CustomModuleDesign): Promise<void> {
  if (!props.module) return
  await window.mook.customDesign.softDelete(props.module.id, d.id)
  emit('changed')
  await load()
}
function onSaved(): void {
  designerShow.value = false
  emit('changed')
  void load()
}

// 字段预览：取前 5 个有标签的字段，超出折叠为 +N
const PREVIEW = 5
function fieldLabel(f: CustomFieldDef): string {
  return f.label || CUSTOM_FIELD_TYPE_LABELS[f.type]
}
function previewFields(d: CustomModuleDesign): CustomFieldDef[] {
  return d.fields.slice(0, PREVIEW)
}
function extraCount(d: CustomModuleDesign): number {
  return Math.max(0, d.fields.length - PREVIEW)
}
</script>

<template>
  <div class="design-list">
    <template v-if="!designerShow">
      <div class="toolbar">
        <div class="tb-left">
          <button type="button" class="back" @click="emit('back')">
            <span class="back-ic">‹</span>
            <span class="back-tx">返回</span>
          </button>
          <h2 class="page-title">表单设计 · {{ module?.name }}</h2>
        </div>
        <NButton size="small" type="primary" @click="openCreate">＋ 新建设计</NButton>
      </div>
      <p class="sub">为该分类配置条目表单，可保存多份设计并切换启用</p>

      <NSpin :show="loading">
        <div v-if="items.length" class="grid">
          <div
            v-for="d in items"
            :key="d.id"
            class="design-card"
            :class="{ active: d.isActive }"
          >
            <div class="card-head">
              <div class="design-name" :title="d.name">{{ d.name }}</div>
              <NTag v-if="d.isActive" size="small" type="success" round :bordered="false">
                使用中
              </NTag>
            </div>

            <div class="field-preview">
              <template v-if="d.fields.length">
                <span v-for="f in previewFields(d)" :key="f.key" class="chip">
                  {{ fieldLabel(f) }}
                </span>
                <span v-if="extraCount(d)" class="chip more">+{{ extraCount(d) }}</span>
              </template>
              <span v-else class="no-field">尚未添加字段</span>
            </div>

            <div class="card-meta">
              <span>{{ d.fields.length }} 个字段</span>
              <span class="dot-sep">·</span>
              <span>更新于 {{ formatDate(d.updatedAt) }}</span>
            </div>

            <div class="card-actions">
              <NButton
                v-if="!d.isActive"
                size="tiny"
                type="primary"
                ghost
                @click="activate(d)"
              >
                设为使用中
              </NButton>
              <span v-else class="active-hint">当前启用</span>
              <div class="actions-right">
                <NButton size="tiny" quaternary @click="openEdit(d)">编辑字段</NButton>
                <NPopconfirm @positive-click="remove(d)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">删除</NButton>
                  </template>
                  删除该设计？
                </NPopconfirm>
              </div>
            </div>
          </div>

          <button type="button" class="design-card add-card" @click="openCreate">
            <span class="plus">＋</span>
            <span class="add-text">新建设计</span>
          </button>
        </div>

        <div v-else-if="!loading" class="empty-wrap">
          <NEmpty description="还没有设计表" class="empty">
            <template #extra>
              <NButton size="small" type="primary" @click="openCreate">＋ 新建第一份设计</NButton>
            </template>
          </NEmpty>
        </div>
      </NSpin>
    </template>

    <DesignerPanel
      v-else
      :module-id="module?.id ?? ''"
      :design="editing"
      @saved="onSaved"
      @cancel="designerShow = false"
    />
  </div>
</template>

<style scoped>
.design-list {
  display: block;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.back {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 12px 0 8px;
  font-size: 13px;
  color: #4b5563;
  background: #fff;
  border: 1px solid #e6e8ee;
  border-radius: 999px;
  cursor: pointer;
  transition:
    border-color var(--d1) var(--fluent-ease),
    color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease),
    box-shadow var(--d1) var(--fluent-ease);
}
.back:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, #fff);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, #fff);
  box-shadow: 0 2px 8px rgba(31, 35, 41, 0.06);
}
.back:active {
  transform: translateY(0.5px);
}
.back-ic {
  font-size: 19px;
  line-height: 1;
  font-weight: 500;
  margin-top: -1px;
}
.back-tx {
  line-height: 1;
}
.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #1f2329;
}
.sub {
  font-size: 12.5px;
  color: #9aa0ac;
  margin: 2px 0 18px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.design-card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 14px 16px;
  transition:
    border-color var(--d2) var(--fluent-ease),
    box-shadow var(--d2) var(--fluent-ease);
}
.design-card:hover {
  border-color: #dfe3ee;
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.08);
}
.design-card.active {
  border-color: color-mix(in srgb, var(--accent) 45%, #fff);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.design-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.field-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
  margin-bottom: 10px;
}
.chip {
  font-size: 11.5px;
  color: #4b5563;
  background: #f4f5f8;
  border: 1px solid #eceef2;
  border-radius: 6px;
  padding: 2px 8px;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip.more {
  color: #9aa0ac;
  background: transparent;
}
.no-field {
  font-size: 12px;
  color: #b6bac3;
}

.card-meta {
  font-size: 11.5px;
  color: #9aa0ac;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.dot-sep {
  color: #d6d9e0;
}

.card-actions {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid #f2f3f6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.active-hint {
  font-size: 12px;
  font-weight: 600;
  color: #18a058;
}
.actions-right {
  display: flex;
  gap: 2px;
}

.add-card {
  border: 1px dashed #d6d9e0;
  background: #fafbfc;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 132px;
  color: #8a909c;
  transition:
    border-color var(--d2) var(--fluent-ease),
    color var(--d2) var(--fluent-ease),
    background-color var(--d2) var(--fluent-ease);
}
.add-card:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: #fff;
}
.plus {
  font-size: 26px;
  line-height: 1;
}
.add-text {
  font-size: 13px;
}

.empty-wrap {
  padding: 50px 0;
}
</style>
