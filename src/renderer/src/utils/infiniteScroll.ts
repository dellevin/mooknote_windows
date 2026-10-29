import { onBeforeUnmount, watch, type Ref } from 'vue'

// 观察列表底部哨兵元素，进入滚动容器视口（提前一段距离）时触发加载下一页。
// 哨兵通常是 v-if（仅在有下一页时渲染），故监听其出现后再连接观察器。
// 各页面滚动发生在外壳的 .content 容器内，笔记列表则用自己的左栏容器。
export function useInfiniteScroll(
  sentinel: Ref<HTMLElement | null>,
  onLoad: () => void | Promise<void>,
  options: { root: () => Element | null; canLoad: () => boolean; margin?: string }
): void {
  let observer: IntersectionObserver | null = null

  function disconnect(): void {
    observer?.disconnect()
    observer = null
  }

  function connect(): void {
    disconnect()
    const el = sentinel.value
    const root = options.root()
    if (!el || !root) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && options.canLoad()) void onLoad()
      },
      { root, rootMargin: options.margin ?? '600px 0px' }
    )
    observer.observe(el)
  }

  // 哨兵随 hasMore 挂载/卸载；root 也可能在首次渲染后才就绪
  watch(sentinel, () => requestAnimationFrame(connect), { immediate: true, flush: 'post' })
  onBeforeUnmount(disconnect)
}
