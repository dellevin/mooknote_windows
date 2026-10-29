import { defineStore } from 'pinia'
import { ref } from 'vue'

type MediaKind = 'movie' | 'book' | 'game'

const PAGE_SIZE = 60

// 三类媒体的列表状态结构一致，用工厂生成独立 store。
export function createMediaStore(kind: MediaKind) {
  const sortKey = `sort${kind.charAt(0).toUpperCase()}${kind.slice(1)}`
  const initialSort = (): number => {
    const v = Number(localStorage.getItem(sortKey))
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  return defineStore(`media-${kind}`, () => {
    const items = ref<unknown[]>([])
    const loading = ref(false)
    const loadingMore = ref(false)
    const hasMore = ref(false)
    const status = ref<string>('')
    const keyword = ref('')
    const sortMode = ref(initialSort())
    const counts = ref<Record<string, number>>({})

    function query(limit: number, offset: number) {
      return window.mook[kind].list({
        status: status.value || undefined,
        keyword: keyword.value.trim() || undefined,
        sortMode: sortMode.value,
        limit,
        offset
      })
    }

    async function refresh(): Promise<void> {
      loading.value = true
      try {
        const rows = await query(PAGE_SIZE, 0)
        items.value = rows
        hasMore.value = rows.length === PAGE_SIZE
      } finally {
        loading.value = false
      }
    }

    async function loadMore(): Promise<void> {
      if (loadingMore.value || !hasMore.value) return
      loadingMore.value = true
      try {
        const rows = await query(PAGE_SIZE, items.value.length)
        items.value = [...items.value, ...rows]
        hasMore.value = rows.length === PAGE_SIZE
      } finally {
        loadingMore.value = false
      }
    }

    async function refreshCounts(): Promise<void> {
      counts.value = await window.mook[kind].counts()
    }

    function setStatus(s: string): void {
      status.value = s
      void refresh()
    }
    function setSort(m: number): void {
      sortMode.value = m
      localStorage.setItem(sortKey, String(m))
      void refresh()
    }
    function search(kw: string): void {
      keyword.value = kw
      void refresh()
    }

    return {
      items,
      loading,
      loadingMore,
      hasMore,
      status,
      keyword,
      sortMode,
      counts,
      refresh,
      loadMore,
      refreshCounts,
      setStatus,
      setSort,
      search
    }
  })
}
