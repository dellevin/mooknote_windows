<script setup lang="ts">
import { darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { toImgUrl } from '@/utils/image'
import { applyFont, applyIcon, currentFontStack } from '@/utils/theme'
import type { CustomModule } from '@shared/types'
import ModuleIcon from '@/components/custom/ModuleIcon.vue'
import GlobalSearch from '@/components/GlobalSearch.vue'

const isDark = computed(() => false)

// 黑白极简：强调色固定近黑，不跟随系统主题色
const accent = ref('#1f2329')
const material = ref<'mica' | 'solid'>('solid')

const themeOverrides = computed(() => ({
  common: {
    fontFamily: currentFontStack.value,
    fontFamilyMono: "'Cascadia Code', Consolas, monospace",
    // 圆角层级对齐手机端：控件 8/10、卡片 12、弹窗 14
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    primaryColor: accent.value,
    primaryColorHover: '#3a3f45',
    primaryColorPressed: '#000000',
    primaryColorSuppl: accent.value,
    // Fluent 细描边
    borderColor: 'rgba(17,17,17,0.14)',
    borderColorHover: 'rgba(17,17,17,0.32)',
    // 统一一条 Fluent 减速曲线
    cubicBezierEaseInOut: 'cubic-bezier(0.1,0.9,0.2,1)',
    cubicBezierEaseOut: 'cubic-bezier(0.1,0.9,0.2,1)',
    cubicBezierEaseIn: 'cubic-bezier(0.1,0.9,0.2,1)',
    duration1: '100ms',
    duration2: '200ms',
    duration3: '250ms'
  },
  Button: {
    borderRadiusTiny: '6px',
    borderRadiusSmall: '8px',
    borderRadiusMedium: '10px',
    borderRadiusLarge: '12px',
    fontWeight: '500'
  },
  Input: {
    borderRadius: '8px'
  },
  InputNumber: {
    borderRadius: '8px'
  },
  Select: {
    peers: {
      InternalSelection: { borderRadius: '8px' }
    }
  },
  Card: {
    borderRadius: '12px'
  },
  Tag: {
    borderRadius: '6px'
  },
  Menu: {
    borderRadius: '10px'
  }
}))

// 24x24 线性图标（stroke = currentColor），内容为静态常量
const I = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  game: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'
}

type NavItem = {
  label: string
  to: string
  icon: string
  accent?: string
  raw?: boolean
  moduleIcon?: string | null
}
type NavGroup = { title: string; items: NavItem[] }

const customModules = ref<CustomModule[]>([])

async function loadCustomModules(): Promise<void> {
  customModules.value = await window.mook.customModule.list()
}
function onModulesChanged(): void {
  void loadCustomModules()
}

// 三组分区，对齐手机端「我的」页的功能归类
const navGroups = computed<NavGroup[]>(() => [
  {
    title: '内容',
    items: [
      { label: '首页', to: '/', icon: I.home },
      { label: '影视', to: '/movies', icon: I.film, accent: '#3b5bff' },
      { label: '阅读', to: '/books', icon: I.book, accent: '#16a34a' },
      { label: '游戏', to: '/games', icon: I.game, accent: '#ea580c' },
      { label: '笔记', to: '/notes', icon: I.note, accent: '#0891b2' },
      // 用户自定义的各分类直接进入对应条目页
      ...customModules.value
        .filter((m) => m.isEnabled)
        .map<NavItem>((m) => ({
          label: m.name,
          to: `/custom/${m.id}`,
          icon: '',
          accent: '#7c3aed',
          raw: true,
          moduleIcon: m.icon
        }))
    ]
  },
  {
    title: '探索',
    items: [
      { label: '片单', to: '/playlists', icon: I.list },
      { label: '日历', to: '/calendar', icon: I.calendar },
      { label: '标签', to: '/tags', icon: I.tag },
      { label: '人物', to: '/people', icon: I.users },
      { label: '图库', to: '/gallery', icon: I.image },
      { label: '自定义', to: '/custom', icon: I.grid },
      { label: '回收站', to: '/bin', icon: I.trash }
    ]
  },
  {
    title: '',
    items: [{ label: '设置', to: '/settings', icon: I.gear }]
  }
])

// 进入/离开自定义页面后刷新侧边栏，保证新建/删除分类及时同步
const route = useRoute()

// 全局搜索悬浮按钮：仅在「内容」分组的页面显示（首页/影视/阅读/游戏/笔记/自定义模块）
const showGlobalSearch = computed(() => {
  const p = route.path
  return (
    p === '/' ||
    p === '/movies' ||
    p === '/books' ||
    p === '/games' ||
    p === '/notes' ||
    p.startsWith('/custom')
  )
})

watch(
  () => route.fullPath,
  (p) => {
    if (p.startsWith('/custom')) void loadCustomModules()
  }
)

const nickname = ref('')
const motto = ref('')
const avatarUrl = ref('')

onMounted(async () => {
  await loadCustomModules()
  const p = await window.mook.prefs.all()
  nickname.value = (p.nickname as string) || 'MookNote'
  motto.value = (p.motto as string) || ''
  avatarUrl.value = toImgUrl(p.avatarPath as string)

  // 外观自定义：字体立即应用；窗口图标交给主进程设置
  applyFont(p.uiFont as string)
  void applyIcon(p.uiIcon as string)

  const shell = await window.mook.window.shellInfo()
  material.value = shell.material
  // 黑白极简：强调色固定，写到 :root 供 teleport 弹层使用
  document.documentElement.style.setProperty('--accent', accent.value)
  window.addEventListener('custom-modules-changed', onModulesChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('custom-modules-changed', onModulesChanged)
})

// 侧边栏可拖拽调宽（130–320px），记住宽度
const RAIL_MIN = 130
const RAIL_MAX = 320
const railWidth = ref(Number(localStorage.getItem('railWidth')) || 144)
let dragStartX = 0
let dragStartW = 0

function onRailPointerDown(e: PointerEvent): void {
  dragStartX = e.clientX
  dragStartW = railWidth.value
  document.body.classList.add('rail-resizing')
  window.addEventListener('pointermove', onRailPointerMove)
  window.addEventListener('pointerup', onRailPointerUp, { once: true })
}
function onRailPointerMove(e: PointerEvent): void {
  const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, dragStartW + (e.clientX - dragStartX)))
  railWidth.value = w
}
function onRailPointerUp(): void {
  document.body.classList.remove('rail-resizing')
  window.removeEventListener('pointermove', onRailPointerMove)
  localStorage.setItem('railWidth', String(railWidth.value))
}
</script>

<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <div
          class="app-root"
          :class="`mat-${material}`"
          :style="{ '--accent': accent }"
        >
          <!-- 右上最小化/最大化/关闭由系统原生标题按钮覆盖层绘制（含 Snap Layouts），
               这里仅保留可拖拽标题区并在右侧留出按钮位 -->
          <div class="app-titlebar">
            <div class="tb-left">
              <span class="tb-title">MookNote</span>
            </div>
            <div class="tb-drag"></div>
          </div>

          <div class="app-body">
            <nav class="rail" :style="{ width: railWidth + 'px' }">
              <div
                class="rail-resize"
                title="拖动调整宽度"
                @pointerdown.prevent="onRailPointerDown"
              ></div>
              <div class="user" :title="motto">
                <div class="avatar" :class="{ clickable: avatarUrl }">
                  <n-image
                    v-if="avatarUrl"
                    :src="avatarUrl"
                    :preview-src="avatarUrl"
                    preview-enabled
                    object-fit="cover"
                    :alt="nickname"
                  />
                  <span v-else>{{ nickname.slice(0, 1) }}</span>
                </div>
                <div class="user-name">{{ nickname }}</div>
              </div>

              <div class="rail-scroll">
                <div
                  v-for="(group, gi) in navGroups"
                  :key="gi"
                  class="nav-group"
                  :class="{ 'nav-group-last': gi === navGroups.length - 1 }"
                >
                  <div v-if="gi > 0" class="rail-divider"></div>
                  <div v-if="group.title" class="nav-group-title">{{ group.title }}</div>
                  <router-link
                    v-for="item in group.items"
                    :key="item.to"
                    :to="item.to"
                    class="rail-item"
                    exact-active-class="active"
                    :style="{ '--item-accent': item.accent || 'var(--accent)' }"
                  >
                    <ModuleIcon
                      v-if="item.raw"
                      class="rail-icon"
                      :icon="item.moduleIcon"
                      :size="18"
                    />
                    <svg
                      v-else
                      class="rail-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      v-html="item.icon"
                    />
                    <span class="rail-label">{{ item.label }}</span>
                  </router-link>
                </div>
              </div>
            </nav>
            <main class="content">
              <router-view v-slot="{ Component }">
                <transition name="route" mode="out-in">
                  <component :is="Component" />
                </transition>
              </router-view>
              <GlobalSearch v-if="showGlobalSearch" />
            </main>
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f3f3f5;
}

/* Win11 Mica：窗口本身透明让系统材质透出，卡片用半透明 Acrylic 感 */
.app-root.mat-mica {
  background: transparent;
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding-left: 12px;
}

.app-body {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  min-height: 0;
  background: transparent;
}

.rail {
  position: relative;
  flex-shrink: 0;
  align-self: stretch;
  background: rgba(252, 252, 253, 0.72);
  border: 1px solid rgba(17, 17, 17, 0.06);
  border-radius: 14px;
  backdrop-filter: blur(32px) saturate(1.25);
  display: flex;
  flex-direction: column;
  padding: 14px 10px 10px;
  min-height: 0;
}

/* 右缘拖拽调宽手柄 */
.rail-resize {
  position: absolute;
  top: 8px;
  bottom: 8px;
  right: -3px;
  width: 7px;
  cursor: col-resize;
  z-index: 5;
}
.rail-resize:hover,
body.rail-resizing .rail-resize {
  background: rgba(31, 35, 41, 0.12);
}

/* 用户区固定，导航分组在剩余空间内独立滚动；隐藏滚动条 */
.rail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 -2px;
  padding: 0 2px;
  scrollbar-width: none;
}
.rail-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
body.rail-resizing {
  cursor: col-resize;
  user-select: none;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-group-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #9aa0ac;
  padding: 10px 14px 4px;
  user-select: none;
}
.nav-group:first-child .nav-group-title {
  padding-top: 2px;
}
.nav-group-last {
  margin-top: auto;
}
.nav-group-last .rail-divider {
  margin-bottom: 4px;
}

.user {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 2px 0 12px;
  cursor: default;
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(135deg, #dfe4f2, #eef0f5);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  transition:
    box-shadow 0.2s ease,
    transform 0.15s ease;
}
.avatar.clickable {
  cursor: zoom-in;
}
.avatar.clickable:hover {
  box-shadow: 0 0 0 2px rgba(31, 35, 41, 0.32), 0 2px 10px rgba(0, 0, 0, 0.18);
  transform: scale(1.05);
}
.avatar :deep(.n-image),
.avatar :deep(.n-image img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar span {
  font-size: 22px;
  font-weight: 600;
  color: #7d8698;
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-divider {
  height: 1px;
  background: #eef0f4;
  margin: 8px 6px 6px;
}

.rail-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 11px;
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1;
  color: #555;
  text-decoration: none;
}

.rail-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.rail-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-item {
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}
.rail-item:hover {
  background: color-mix(in srgb, var(--item-accent) 10%, transparent);
}
.rail-item.active {
  background: color-mix(in srgb, var(--item-accent) 12%, transparent);
  color: var(--item-accent);
  font-weight: 600;
}

.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(17, 17, 17, 0.06);
  border-radius: 14px;
  backdrop-filter: blur(32px) saturate(1.25);
}
</style>
