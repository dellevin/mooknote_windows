<script setup lang="ts">
import { darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { toImgUrl } from '@/utils/image'
import { applyFont, currentFontStack } from '@/utils/theme'
import { currentSkin, initSkin } from '@/utils/skin'
import type { CustomModule } from '@shared/types'
import ModuleIcon from '@/components/custom/ModuleIcon.vue'
import GlobalSearch from '@/components/GlobalSearch.vue'

// 皮肤不启用暗色主题，应用整体始终浅色
const isDark = computed(() => false)

const material = ref<'mica' | 'solid'>('solid')

const themeOverrides = computed(() => {
  const s = currentSkin.value
  return {
  common: {
    fontFamily: currentFontStack.value,
    fontFamilyMono: "'Cascadia Code', Consolas, monospace",
    // 圆角层级对齐手机端：控件 8/10、卡片 12、弹窗 14
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    primaryColor: s.primary,
    primaryColorHover: s.primaryHover,
    primaryColorPressed: s.primaryPressed,
    primaryColorSuppl: s.primary,
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
    fontWeight: '500',
    // 实心主按钮：主色底 + onPrimary 文字
    textColorPrimary: s.onPrimary,
    textColorHoverPrimary: s.onPrimary,
    textColorPressedPrimary: s.onPrimary,
    textColorFocusPrimary: s.onPrimary,
    // 文字/幽灵按钮在浅色表面上，必须用 ink（黑皮肤下不能用近白）
    textColorTextPrimary: s.ink,
    textColorTextHoverPrimary: s.ink,
    textColorTextPressedPrimary: s.ink,
    textColorTextFocusPrimary: s.ink,
    textColorGhostPrimary: s.ink,
    textColorGhostHoverPrimary: s.ink,
    textColorGhostPressedPrimary: s.ink,
    textColorGhostFocusPrimary: s.ink
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
  // 选中类小控件在浅色表面上保持深色墨点（近白主色会看不见）
  Checkbox: {
    colorChecked: s.primary,
    borderChecked: `1px solid ${s.primary}`,
    borderFocus: `1px solid ${s.primary}`,
    checkMarkColor: s.onPrimary
  },
  Radio: {
    dotColorActive: s.ink,
    boxShadowActive: `inset 0 0 0 1px ${s.ink}`,
    boxShadowHover: `inset 0 0 0 1px ${s.ink}`,
    buttonTextColorActive: s.ink
  },
  Switch: {
    railColorActive: s.primary,
    buttonColor: s.onPrimary
  },
  Tabs: {
    tabTextColorActiveLine: s.ink,
    tabTextColorHoverLine: s.ink,
    tabTextColorActiveBar: s.ink,
    tabTextColorActiveCard: s.ink,
    barColor: s.ink
  },
  Pagination: {
    itemTextColorActive: s.ink
  },
  Menu: {
    borderRadius: '10px'
  }
  }
})

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

// 截屏选区等独立窗口只渲染路由页，不显示应用外壳
const bareMode = computed(() => route.meta.bare === true)

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
    profileOpen.value = false
    if (p.startsWith('/custom')) void loadCustomModules()
  }
)

const nickname = ref('')
const motto = ref('')
const avatarUrl = ref('')
const profileOpen = ref(false)
const profileEditing = ref(false)
const draftNickname = ref('')
const draftMotto = ref('')

function startEditProfile(): void {
  draftNickname.value = nickname.value
  draftMotto.value = motto.value
  profileEditing.value = true
}
function cancelEditProfile(): void {
  profileEditing.value = false
}
async function saveProfile(): Promise<void> {
  nickname.value = draftNickname.value.trim() || 'MookNote'
  motto.value = draftMotto.value.trim()
  await Promise.all([
    window.mook.prefs.set('nickname', nickname.value),
    window.mook.prefs.set('motto', motto.value)
  ])
  profileEditing.value = false
}
async function pickAvatar(): Promise<void> {
  const rel = await window.mook.profile.pickAvatar()
  if (!rel) return
  await window.mook.prefs.set('avatarPath', rel)
  avatarUrl.value = toImgUrl(rel)
}

watch(profileOpen, (open: boolean) => {
  if (!open) profileEditing.value = false
})
const isMaximized = ref(false)
function winMinimize(): void {
  window.mook.window.minimize()
}
function winToggleMax(): void {
  window.mook.window.toggleMaximize()
}
function winClose(): void {
  window.mook.window.close()
}

// 关窗询问：主进程请求时弹出应用内对话框，替代系统原生弹窗
const closeAsk = ref(false)
const closeRemember = ref(false)
function answerClose(quit: boolean): void {
  window.mook.window.closeDecision(quit, closeRemember.value)
  closeAsk.value = false
  closeRemember.value = false
}
// 点遮罩 = 取消关闭，窗口保持原样；必须显式选择按钮
function cancelClose(): void {
  window.mook.window.closeCancel()
  closeAsk.value = false
  closeRemember.value = false
}

onMounted(async () => {
  await loadCustomModules()
  const p = await window.mook.prefs.all()
  nickname.value = (p.nickname as string) || 'MookNote'
  motto.value = (p.motto as string) || ''
  avatarUrl.value = toImgUrl(p.avatarPath as string)

  // 外观自定义：皮肤 + 字体
  await initSkin()
  applyFont(p.uiFont as string)

  const shell = await window.mook.window.shellInfo()
  material.value = shell.material
  window.addEventListener('custom-modules-changed', onModulesChanged)
  window.mook.window.onMaximizedChange((v) => (isMaximized.value = v))
  window.mook.window.onCloseQuery(() => {
    closeRemember.value = false
    closeAsk.value = true
  })
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
        <!-- 独立透明窗口（截屏选区）：只渲染路由页，无标题栏/侧栏/悬浮球 -->
        <router-view v-if="bareMode" />
        <div
          v-else
          class="app-root"
          :class="`mat-${material}`"
        >
          <!-- 自定义标题栏：左侧品牌标识 + 可拖拽区，右侧自绘最小化/最大化/关闭 -->
          <div class="app-titlebar">
            <div class="tb-left">
              <span class="tb-mark">M</span>
              <span class="tb-title">MookNote</span>
            </div>
            <div class="tb-drag"></div>
            <div class="tb-controls">
              <button class="tb-btn" title="最小化" @click="winMinimize">
                <svg viewBox="0 0 12 12" width="12" height="12">
                  <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
                </svg>
              </button>
              <button class="tb-btn" title="最大化/还原" @click="winToggleMax">
                <svg v-if="!isMaximized" viewBox="0 0 12 12" width="12" height="12">
                  <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
                </svg>
                <svg v-else viewBox="0 0 12 12" width="12" height="12">
                  <rect x="3.5" y="2" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1" />
                  <path d="M5 2.5V4H2.5v5.5H7V8" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="tb-btn tb-close" title="关闭" @click="winClose">
                <svg viewBox="0 0 12 12" width="12" height="12">
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div class="app-body">
            <nav class="rail" :style="{ width: railWidth + 'px' }">
              <div
                class="rail-resize"
                title="拖动调整宽度"
                @pointerdown.prevent="onRailPointerDown"
              ></div>
              <div class="user" title="查看资料" @click="profileOpen = !profileOpen">
                <div class="avatar">
                  <img v-if="avatarUrl" :src="avatarUrl" :alt="nickname" draggable="false" />
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

          <!-- 头像信息弹层：放在 rail 之外，避免被其 backdrop-filter 层叠上下文裁切 -->
          <transition name="profile-pop">
            <div v-if="profileOpen" class="profile-wrap">
              <div class="profile-backdrop" @click="profileOpen = false"></div>
              <div class="profile-card">
                <button
                  v-if="!profileEditing"
                  class="profile-edit-icon"
                  title="编辑资料"
                  @click="startEditProfile"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <div
                  class="profile-avatar"
                  :class="{ editable: profileEditing }"
                  :title="profileEditing ? '点击更换头像' : ''"
                  @click="profileEditing && pickAvatar()"
                >
                  <img v-if="avatarUrl" :src="avatarUrl" :alt="nickname" draggable="false" />
                  <span v-else>{{ (profileEditing ? draftNickname : nickname).slice(0, 1) }}</span>
                  <div v-if="profileEditing" class="profile-avatar-mask">更换</div>
                </div>

                <template v-if="!profileEditing">
                  <div class="profile-name">{{ nickname }}</div>
                  <div class="profile-motto">{{ motto || '这个人很懒，还没有写座右铭。' }}</div>
                </template>

                <template v-else>
                  <input
                    v-model="draftNickname"
                    class="profile-input"
                    type="text"
                    maxlength="20"
                    placeholder="昵称"
                  />
                  <textarea
                    v-model="draftMotto"
                    class="profile-input profile-textarea"
                    rows="2"
                    maxlength="60"
                    placeholder="座右铭"
                  ></textarea>
                  <div class="profile-actions">
                    <button class="profile-btn ghost" @click="cancelEditProfile">取消</button>
                    <button class="profile-btn" @click="saveProfile">保存</button>
                  </div>
                </template>
              </div>
            </div>
          </transition>

          <!-- 关闭窗口询问：应用内自定义弹窗，替代系统原生 MessageBox -->
          <transition name="close-pop">
            <div v-if="closeAsk" class="close-mask" @click.self="cancelClose">
              <div class="close-dialog">
                <div class="cd-title">关闭窗口时要怎么做？</div>
                <div class="cd-actions">
                  <button class="cd-btn" @click="answerClose(false)">最小化到托盘</button>
                  <button class="cd-btn primary" @click="answerClose(true)">退出程序</button>
                </div>
                <label class="cd-remember">
                  <input type="checkbox" v-model="closeRemember" />
                  <span>记住我的选择（可在设置中修改）</span>
                </label>
              </div>
            </div>
          </transition>
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
  background: var(--app-bg);
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
  padding: 0 10px 0 14px;
  -webkit-app-region: drag;
}
.tb-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.tb-controls {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
}
.tb-btn {
  width: 44px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--tb-btn-text);
  cursor: pointer;
  transition:
    background-color 0.12s,
    color 0.12s;
}
.tb-btn:hover {
  background: var(--tb-btn-hover-bg);
  color: var(--tb-btn-hover-text);
}
.tb-btn:active {
  background: var(--tb-btn-hover-bg);
}
.tb-btn.tb-close:hover {
  background: #e81123;
  color: #ffffff;
}
.tb-btn.tb-close:active {
  background: #c40f1e;
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
  background: var(--rail-bg);
  border: 1px solid var(--rail-stroke);
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
  background: var(--rail-handle);
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
  color: var(--rail-text-dim);
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
  cursor: pointer;
}
.user:hover .avatar {
  box-shadow: 0 0 0 2px var(--rail-handle), 0 2px 10px rgba(0, 0, 0, 0.18);
  transform: scale(1.05);
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--rail-avatar-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  transition:
    box-shadow 0.2s ease,
    transform 0.15s ease;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar span {
  font-size: 22px;
  font-weight: 600;
  color: var(--rail-avatar-fallback);
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--rail-text-strong);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-divider {
  height: 1px;
  background: var(--rail-divider);
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
  color: var(--rail-text);
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
  background: var(--rail-item-hover);
}
.rail-item.active {
  background: var(--rail-item-hover);
  color: var(--rail-text-strong);
  font-weight: 600;
}

.content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--content-bg);
  border: 1px solid var(--fluent-stroke);
  border-radius: 14px;
  backdrop-filter: blur(32px) saturate(1.25);
}

/* 头像资料弹层 */
.profile-wrap {
  position: fixed;
  top: calc(var(--titlebar-height) + 16px);
  left: 18px;
  z-index: 1000;
}
.profile-backdrop {
  position: fixed;
  inset: calc(var(--titlebar-height) * -1) 0 0 calc(var(--titlebar-height) * -1);
}
.profile-card {
  position: relative;
  width: 248px;
  padding: 18px 18px 16px;
  border-radius: 14px;
  background: var(--fluent-card);
  border: 1px solid var(--fluent-stroke);
  box-shadow: var(--fluent-shadow);
  backdrop-filter: blur(32px) saturate(1.4);
  -webkit-backdrop-filter: blur(32px) saturate(1.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  transform-origin: top left;
}
.profile-edit-icon {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.profile-edit-icon:hover {
  background: rgba(17, 17, 17, 0.07);
  color: var(--accent-ink, #1f2329);
}
.profile-avatar {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--rail-avatar-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}
.profile-avatar.editable {
  cursor: pointer;
}
.profile-avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
}
.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.profile-avatar span {
  font-size: 26px;
  font-weight: 600;
  color: var(--rail-avatar-fallback);
}
.profile-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong);
}
.profile-motto {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.profile-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-strong, #1f2329);
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(17, 17, 17, 0.16);
  border-radius: 8px;
  outline: none;
  resize: none;
}
.profile-input:focus {
  border-color: var(--accent-ink, #1f2329);
}
.profile-textarea {
  line-height: 1.5;
}
.profile-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}
.profile-btn {
  flex: 1;
  padding: 7px 0;
  font-size: 13px;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  background: var(--accent, #1f2329);
  color: var(--on-accent, #fff);
  transition: filter 0.15s ease;
}
.profile-btn:hover {
  filter: brightness(1.12);
}
.profile-btn.ghost {
  background: transparent;
  color: var(--accent-ink, #1f2329);
  border-color: rgba(17, 17, 17, 0.2);
}
.profile-btn.ghost:hover {
  background: rgba(17, 17, 17, 0.06);
  filter: none;
}

/* 关窗询问弹窗 */
.close-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 17, 17, 0.22);
}
.close-dialog {
  width: 300px;
  padding: 18px 18px 14px;
  border-radius: 12px;
  background: var(--surface, #fff);
  box-shadow: 0 8px 28px rgba(17, 17, 17, 0.18);
}
.cd-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
}
.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.cd-btn {
  padding: 6px 14px;
  font-size: 13px;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid rgba(17, 17, 17, 0.12);
  background: var(--surface, #fff);
  color: var(--text-strong, #1f2329);
  cursor: pointer;
}
.cd-btn:hover {
  background: rgba(17, 17, 17, 0.05);
}
.cd-btn.primary {
  background: var(--accent, #1f2329);
  border-color: transparent;
  color: var(--on-accent, #fff);
}
.cd-btn.primary:hover {
  filter: brightness(1.1);
}
.cd-remember {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--text, #5b616c);
  cursor: pointer;
  user-select: none;
}
.cd-remember input {
  accent-color: var(--accent, #1f2329);
  cursor: pointer;
}
.close-pop-enter-active,
.close-pop-leave-active {
  transition: opacity 0.15s ease;
}
.close-pop-enter-from,
.close-pop-leave-to {
  opacity: 0;
}

/* 像通知一样从左侧滑入，慢速；只做位移，不淡入，避免毛玻璃背景闪烁 */
.profile-pop-enter-active {
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.profile-pop-leave-active {
  transition: transform 0.25s var(--fluent-ease);
}
.profile-pop-enter-from,
.profile-pop-leave-to {
  transform: translateX(calc(-100% - 24px));
}
</style>
