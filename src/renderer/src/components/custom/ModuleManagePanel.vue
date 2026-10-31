<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import {
  NButton,
  NSpace,
  NEmpty,
  NSpin,
  NSwitch,
  NInput,
  NModal,
  NPopconfirm,
  useDialog
} from 'naive-ui'
import type { CustomModule } from '@shared/types'
import DesignListPanel from './DesignListPanel.vue'
import ModuleIcon from './ModuleIcon.vue'
import ModuleIconPicker from './ModuleIconPicker.vue'

const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'nav-change', inDesigns: boolean): void
}>()

const dialog = useDialog()
const modules = ref<CustomModule[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)

// 视图：list 分类列表 / form 新建编辑分类 / designs 表单设计
const view = ref<'list' | 'form' | 'designs'>('list')

// 内联新建/编辑表单
const editing = ref<CustomModule | null>(null)
const fName = ref('')
const fIcon = ref('')
const fEnabled = ref(true)
const iconPickerShow = ref(false)

function pickIcon(v: string): void {
  // 点已选中的图标视为确认关闭，不清空（清空用表单里的「清除」按钮）
  if (v) fIcon.value = v
  iconPickerShow.value = false
}

const designModule = ref<CustomModule | null>(null)

// 进入设计视图时通知父级隐藏外层「自定义分类」标题栏
watch(view, (v) => emit('nav-change', v === 'designs'), { immediate: true })

async function load(): Promise<void> {
  loading.value = true
  try {
    modules.value = await window.mook.customModule.list()
    const c: Record<string, number> = {}
    for (const m of modules.value) c[m.id] = await window.mook.customItem.count(m.id)
    counts.value = c
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())

function openCreate(): void {
  editing.value = null
  fName.value = ''
  fIcon.value = ''
  fEnabled.value = true
  view.value = 'form'
}
function openEdit(m: CustomModule): void {
  editing.value = m
  fName.value = m.name
  fIcon.value = m.icon
  fEnabled.value = m.isEnabled
  view.value = 'form'
}

async function saveForm(): Promise<void> {
  const name = fName.value.trim()
  if (!name) return
  if (editing.value) {
    await window.mook.customModule.update({
      ...editing.value,
      name,
      icon: fIcon.value.trim(),
      isEnabled: fEnabled.value
    })
  } else {
    const id = await window.mook.customModule.newId()
    await window.mook.customModule.create({
      id,
      name,
      icon: fIcon.value.trim(),
      sortOrder: await window.mook.customModule.nextSort(),
      activeDesignId: null,
      isEnabled: fEnabled.value
    })
  }
  view.value = 'list'
  emit('changed')
  await load()
}

async function toggleEnabled(m: CustomModule, on: boolean): Promise<void> {
  await window.mook.customModule.setEnabled(m.id, on)
  emit('changed')
  await load()
}

function askDelete(m: CustomModule): void {
  dialog.warning({
    title: '删除自定义分类',
    content: `确定删除「${m.name}」吗？其设计与条目都会移入回收站。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await window.mook.customModule.softDelete(m.id)
      emit('changed')
      await load()
    }
  })
}

function openDesigns(m: CustomModule): void {
  designModule.value = m
  view.value = 'designs'
}
function onDesignChanged(): void {
  emit('changed')
  void load()
}
</script>

<template>
  <!-- 表单设计视图全屏渲染，自带顶部栏，不再套外层卡片 -->
  <DesignListPanel
    v-if="view === 'designs'"
    :module="designModule"
    @changed="onDesignChanged"
    @back="view = 'list'"
  />
  <div v-else class="panel">
    <!-- 分类列表 -->
    <template v-if="view === 'list'">
      <div class="head">
        <h3>自定义分类管理</h3>
        <NButton size="small" type="primary" @click="openCreate">＋ 新建分类</NButton>
      </div>
      <NSpin :show="loading">
        <NEmpty v-if="!modules.length && !loading" description="还没有自定义分类" />
        <div v-else class="list">
          <div v-for="m in modules" :key="m.id" class="cat-card">
            <div class="info">
              <span class="name"><ModuleIcon :icon="m.icon" :size="16" class="m-ic" />{{ m.name }}</span>
              <span class="meta">{{ counts[m.id] ?? 0 }} 条 · {{ m.activeDesignId ? '已配置表单' : '未配置表单' }}</span>
            </div>
            <NSpace :size="8" align="center">
              <NSwitch :value="m.isEnabled" size="small" @update:value="(v: boolean) => toggleEnabled(m, v)" />
              <NButton size="tiny" quaternary type="primary" @click="openDesigns(m)">表单设计</NButton>
              <NButton size="tiny" quaternary @click="openEdit(m)">编辑</NButton>
              <NPopconfirm @positive-click="askDelete(m)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">删除</NButton>
                </template>
                删除分类？
              </NPopconfirm>
            </NSpace>
          </div>
        </div>
      </NSpin>
    </template>

    <!-- 新建/编辑分类 -->
    <template v-else-if="view === 'form'">
      <div class="form-card">
      <h3>{{ editing ? '编辑分类' : '新建分类' }}</h3>
      <div class="form-row">
        <span class="cap">名称</span>
        <NInput v-model:value="fName" placeholder="如：追剧 / 播客 / 收藏" />
      </div>
      <div class="form-row">
        <span class="cap">图标</span>
        <button type="button" class="icon-trigger" @click="iconPickerShow = true">
          <ModuleIcon :icon="fIcon" :size="20" />
        </button>
        <NButton size="tiny" quaternary @click="iconPickerShow = true">选择图标</NButton>
        <NButton v-if="fIcon" size="tiny" quaternary type="error" @click="fIcon = ''">
          清除
        </NButton>
      </div>
      <div class="form-row">
        <span class="cap">显示在侧边栏</span>
        <NSwitch v-model:value="fEnabled" size="small" />
      </div>
      <div class="footer">
        <NSpace justify="end">
          <NButton size="small" @click="view = 'list'">取消</NButton>
          <NButton size="small" type="primary" @click="saveForm">保存</NButton>
        </NSpace>
      </div>
      </div>
    </template>

    <!-- 图标选择弹窗 -->
    <NModal v-model:show="iconPickerShow" :auto-focus="false">
      <div class="icon-modal">
        <h3>选择图标</h3>
        <ModuleIconPicker :value="fIcon" @update:value="pickIcon" />
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.panel {
  display: block;
}
.panel h3 {
  font-size: 16px;
}
.form-card {
  background: var(--surface);
  border: 1px solid #eef0f4;
  border-radius: 14px;
  padding: 20px 24px;
  max-width: 560px;
}
.form-card h3 {
  margin-bottom: 14px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.cat-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid #eef0f4;
  border-radius: 12px;
  transition:
    border-color var(--d2) var(--fluent-ease),
    box-shadow var(--d2) var(--fluent-ease);
}
.cat-card:hover {
  border-color: #dfe3ee;
  box-shadow: 0 6px 18px rgba(31, 35, 41, 0.07);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
.meta {
  font-size: 12px;
  color: #9aa0ac;
}
.footer {
  margin-top: 14px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.cap {
  font-size: 13px;
  color: #5b616c;
  width: 96px;
  flex-shrink: 0;
}
.m-ic {
  margin-right: 8px;
}
.icon-trigger {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid #e4e7ec;
  background: var(--surface);
  color: var(--text-strong);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}
.icon-trigger:hover {
  border-color: var(--text-strong);
  background: #f6f7f9;
}
.icon-modal {
  width: 432px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 22px;
}
.icon-modal h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
</style>
