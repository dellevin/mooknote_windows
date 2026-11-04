import { ref } from 'vue'

// 侧边栏内置入口定义（id 即路由路径，保持稳定）
// 不含：用户自定义模块、运行时的「阅读器」入口、「设置」本身
export interface SidebarNavItemDef {
  id: string
  label: string
}
export interface SidebarNavGroupDef {
  id: string
  title: string
  items: SidebarNavItemDef[]
}

export const SIDEBAR_GROUPS: SidebarNavGroupDef[] = [
  {
    id: 'content',
    title: '内容',
    items: [
      { id: '/', label: '首页' },
      { id: '/movies', label: '影视' },
      { id: '/books', label: '阅读' },
      { id: '/games', label: '游戏' },
      { id: '/notes', label: '笔记' }
    ]
  },
  {
    id: 'explore',
    title: '探索',
    items: [
      { id: '/playlists', label: '片单' },
      { id: '/calendar', label: '日历' },
      { id: '/tags', label: '标签' },
      { id: '/people', label: '人物' },
      { id: '/gallery', label: '图库' },
      { id: '/custom', label: '自定义' },
      { id: '/tools', label: '工具栏' },
      { id: '/bin', label: '回收站' }
    ]
  }
]

interface SidebarNavPrefs {
  hidden: string[]
  order: Record<string, string[]>
}

const hidden = ref<string[]>([])
const order = ref<Record<string, string[]>>({})

const PREFS_KEY = 'sidebarNav'

function labelOf(id: string): string {
  for (const g of SIDEBAR_GROUPS) {
    const found = g.items.find((it) => it.id === id)
    if (found) return found.label
  }
  return id
}

// 保存的顺序与当前内置条目合并：丢弃已不存在的 id，追加新增的 id
function mergedIds(groupId: string): string[] {
  const def = SIDEBAR_GROUPS.find((g) => g.id === groupId)
  if (!def) return []
  const known = new Set(def.items.map((it) => it.id))
  const result = (order.value[groupId] ?? []).filter((id) => known.has(id))
  for (const id of known) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

function persist(): void {
  void window.mook.prefs.set(PREFS_KEY, {
    hidden: [...hidden.value],
    order: JSON.parse(JSON.stringify(order.value))
  } satisfies SidebarNavPrefs)
}

export async function loadSidebarNav(): Promise<void> {
  const p = (await window.mook.prefs.get(PREFS_KEY, {
    hidden: [],
    order: {}
  })) as SidebarNavPrefs | null
  hidden.value = p?.hidden ?? []
  order.value = p?.order ?? {}
}

// 侧边栏渲染用：排序 + 过滤隐藏项
export function visibleNavItems(groupId: string): SidebarNavItemDef[] {
  const hiddenSet = new Set(hidden.value)
  return mergedIds(groupId)
    .filter((id) => !hiddenSet.has(id))
    .map((id) => ({ id, label: labelOf(id) }))
}

// 设置页编辑用：按顺序返回全部条目（含隐藏项）
export function editableNavItems(groupId: string): SidebarNavItemDef[] {
  return mergedIds(groupId).map((id) => ({ id, label: labelOf(id) }))
}

export function isNavHidden(id: string): boolean {
  return hidden.value.includes(id)
}

export function setNavHidden(id: string, value: boolean): void {
  const has = hidden.value.includes(id)
  if (value === has) return
  hidden.value = value
    ? [...hidden.value, id]
    : hidden.value.filter((x) => x !== id)
  persist()
}

// 将 fromId 移动到 toId 之前；toId 为 null 表示移到组末尾
export function moveNavItem(groupId: string, fromId: string, toId: string | null): void {
  const ids = mergedIds(groupId)
  const from = ids.indexOf(fromId)
  if (from < 0) return
  ids.splice(from, 1)
  const to = toId === null ? ids.length : ids.indexOf(toId)
  if (to < 0) return
  ids.splice(to, 0, fromId)
  order.value = { ...order.value, [groupId]: ids }
  persist()
}

export function resetSidebarNav(): void {
  hidden.value = []
  order.value = {}
  persist()
}
