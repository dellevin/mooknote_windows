import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Movie, MovieStatus } from '@shared/types'

type StatusFilter = '' | MovieStatus
const PAGE_SIZE = 60
const SORT_KEY = 'sortMovie'
const initialSort = (): number => {
  const v = Number(localStorage.getItem(SORT_KEY))
  return Number.isFinite(v) && v > 0 ? v : 0
}

export const useMovieStore = defineStore('movie', () => {
  const movies = ref<Movie[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasMore = ref(false)
  const status = ref<StatusFilter>('')
  const category = ref('')
  const keyword = ref('')
  const sortMode = ref(initialSort())
  const counts = ref<Record<string, number>>({})

  function query(limit: number, offset: number) {
    return window.mook.movie.list({
      status: status.value || undefined,
      category: category.value || undefined,
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
      movies.value = rows
      hasMore.value = rows.length === PAGE_SIZE
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const rows = await query(PAGE_SIZE, movies.value.length)
      movies.value = [...movies.value, ...rows]
      hasMore.value = rows.length === PAGE_SIZE
    } finally {
      loadingMore.value = false
    }
  }

  async function refreshCounts(): Promise<void> {
    counts.value = await window.mook.movie.counts()
  }

  function setStatus(s: StatusFilter): void {
    status.value = s
    void refresh()
  }

  function setCategory(c: string): void {
    category.value = c
    void refresh()
  }

  function setSort(m: number): void {
    sortMode.value = m
    localStorage.setItem(SORT_KEY, String(m))
    void refresh()
  }

  function search(kw: string): void {
    keyword.value = kw
    void refresh()
  }

  return {
    movies,
    loading,
    loadingMore,
    hasMore,
    status,
    category,
    keyword,
    sortMode,
    counts,
    refresh,
    loadMore,
    refreshCounts,
    setStatus,
    setCategory,
    setSort,
    search
  }
})
