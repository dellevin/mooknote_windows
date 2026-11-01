<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NEmpty, NSpin, NTag, NSelect } from 'naive-ui'

type PersonSort = 'updated' | 'created' | 'name' | 'birth'
import type { Person, MediaKind } from '@shared/types'
import { toImgUrl } from '@/utils/image'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import PersonFormModal from '@/components/people/PersonFormModal.vue'
import PersonDetailModal from '@/components/people/PersonDetailModal.vue'

const people = ref<Person[]>([])
const loading = ref(false)
const keyword = ref('')
const sortMode = ref<PersonSort>('updated')

const sortOptions: { label: string; value: PersonSort }[] = [
  { label: '按更新时间', value: 'updated' },
  { label: '按创建时间', value: 'created' },
  { label: '按人名', value: 'name' },
  { label: '按出生日期', value: 'birth' }
]

async function onSortChange(v: PersonSort): Promise<void> {
  sortMode.value = v
  await window.mook.prefs.set('peopleSortMode', v)
  renderCount.value = PAGE
  await load()
}

// 渲染窗口：人物已在内存，分批挂载卡片
const PAGE = 60
const renderCount = ref(PAGE)
const visible = computed(() => people.value.slice(0, renderCount.value))
const peopleSentinel = ref<HTMLElement | null>(null)
useInfiniteScroll(
  peopleSentinel,
  () => {
    renderCount.value += PAGE
  },
  {
    root: () => document.querySelector('.content'),
    canLoad: () => renderCount.value < people.value.length,
    margin: '600px 0px'
  }
)
watch(keyword, () => (renderCount.value = PAGE))

const formShow = ref(false)
const editPerson = ref<Person | null>(null)
const detailShow = ref(false)
const detailId = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    people.value = await window.mook.person.list(keyword.value, false, sortMode.value)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  sortMode.value = await window.mook.prefs.get<PersonSort>('peopleSortMode', 'updated')
  await load()
})

function openCreate(): void {
  editPerson.value = null
  formShow.value = true
}
function openCard(p: Person): void {
  detailId.value = p.id
  detailShow.value = true
}
function onSaved(): void {
  void load()
}
// 作品详情统一在对应媒体页查看：首版仅关闭弹窗并跳转
function openWork(kind: MediaKind): void {
  detailShow.value = false
  window.location.hash =
    kind === 'movie' ? '#/movies' : kind === 'book' ? '#/books' : '#/games'
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <h2 class="page-title">人物</h2>
      <div class="tools">
        <NInput
          v-model:value="keyword"
          placeholder="搜索姓名 / 别名"
          clearable
          size="small"
          class="search"
          @update:value="() => load()"
          @keyup.enter="load"
        />
        <NSelect
          :value="sortMode"
          :options="sortOptions"
          size="small"
          class="sort-select"
          @update:value="onSortChange"
        />
        <NButton size="small" :loading="loading" @click="load">刷新</NButton>
        <NButton size="small" type="primary" @click="openCreate">＋ 添加人物</NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <NEmpty v-if="!people.length && !loading" description="还没有人物档案" class="empty" />
      <div v-else class="grid">
        <div v-for="p in visible" :key="p.id" class="person-card" @click="openCard(p)">
          <div class="avatar">
            <img v-if="p.photoPath" :src="toImgUrl(p.photoPath)" />
            <div v-else class="avatar-empty">{{ p.name.slice(0, 1) }}</div>
          </div>
          <div class="name">{{ p.name }}</div>
          <div class="occ">
            <NTag v-for="o in p.occupation.slice(0, 2)" :key="o" size="tiny" :bordered="false">
              {{ o }}
            </NTag>
          </div>
        </div>
      </div>
      <div v-if="renderCount < people.length" ref="peopleSentinel" class="load-more">
        加载中…
      </div>
    </NSpin>

    <PersonFormModal
      v-model:show="formShow"
      :person="editPerson"
      @saved="onSaved"
    />
    <PersonDetailModal
      v-model:show="detailShow"
      :id="detailId"
      @changed="load"
      @open-work="openWork"
    />
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
  margin-bottom: 18px;
}
.page-title {
  font-size: 18px;
  color: var(--text-strong);
}
.tools {
  display: flex;
  gap: 10px;
}
.search {
  width: 220px;
}
.sort-select {
  width: 130px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 18px 16px;
  align-content: start;
}
.person-card {
  text-align: center;
  cursor: pointer;
  padding: 10px 6px;
  border-radius: 12px;
}
.person-card:hover {
  background: var(--surface);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}
.load-more {
  padding: 16px 0 8px;
  text-align: center;
  font-size: 12.5px;
  color: #a8adb8;
}
.avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  margin: 0 auto 8px;
  background: #e2e5ee;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  color: #9aa0ac;
}
.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
  margin-bottom: 4px;
}
.occ {
  display: flex;
  justify-content: center;
  gap: 4px;
}
.empty {
  margin-top: 80px;
}
</style>
