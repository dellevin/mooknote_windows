import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: () => {
    // window 本身不滚动（overflow:hidden），内容区 .content 是独立滚动容器，手动回顶
    document.querySelector('.content')?.scrollTo({ top: 0, left: 0 })
    return { top: 0, left: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/HomePage.vue')
    },
    {
      path: '/movies',
      name: 'movies',
      component: () => import('@/pages/MoviesPage.vue')
    },
    {
      path: '/books',
      name: 'books',
      component: () => import('@/pages/BooksPage.vue')
    },
    {
      path: '/games',
      name: 'games',
      component: () => import('@/pages/GamesPage.vue')
    },
    {
      path: '/people',
      name: 'people',
      component: () => import('@/pages/PeoplePage.vue')
    },
    {
      path: '/playlists',
      name: 'playlists',
      component: () => import('@/pages/PlaylistsPage.vue')
    },
    {
      path: '/tags',
      name: 'tags',
      component: () => import('@/pages/TagsPage.vue')
    },
    {
      path: '/bin',
      name: 'bin',
      component: () => import('@/pages/BinPage.vue')
    },
    {
      path: '/notes',
      name: 'notes',
      component: () => import('@/pages/NotesPage.vue')
    },
    {
      path: '/custom',
      name: 'custom',
      component: () => import('@/pages/CustomPage.vue')
    },
    {
      path: '/custom/:id',
      name: 'custom-module',
      component: () => import('@/pages/CustomPage.vue')
    },
    {
      path: '/calendar',
      name: 'calendar',
      component: () => import('@/pages/CalendarPage.vue')
    },
    {
      path: '/gallery',
      name: 'gallery',
      component: () => import('@/pages/GalleryPage.vue')
    },
    {
      path: '/tools',
      name: 'tools',
      component: () => import('@/pages/ToolsPage.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/SettingsPage.vue')
    },
    {
      path: '/db',
      name: 'db',
      component: () => import('@/pages/DbBrowserPage.vue')
    },
    {
      // 独立透明选区窗口专用路由：不渲染应用外壳
      path: '/ocr-capture',
      name: 'ocr-capture',
      component: () => import('@/pages/OcrCapturePage.vue'),
      meta: { bare: true }
    },
    {
      // 独立透明截屏标注窗口专用路由：不渲染应用外壳
      path: '/screenshot-capture',
      name: 'screenshot-capture',
      component: () => import('@/pages/ScreenshotCapturePage.vue'),
      meta: { bare: true }
    },
    {
      // 钉在桌面的截图小窗：不渲染应用外壳
      path: '/shot-pin',
      name: 'shot-pin',
      component: () => import('@/pages/ShotPinPage.vue'),
      meta: { bare: true }
    },
    {
      // 屏幕取色覆盖窗口：不渲染应用外壳
      path: '/color-picker',
      name: 'color-picker',
      component: () => import('@/pages/ColorPickerPage.vue'),
      meta: { bare: true }
    },
    {
      // 桌面悬浮球独立窗口
      path: '/float-ball',
      name: 'float-ball',
      component: () => import('@/pages/float/FloatBallPage.vue'),
      meta: { bare: true }
    },
    {
      // 悬浮球功能面板（菜单 / OCR 结果）独立窗口
      path: '/float-panel',
      name: 'float-panel',
      component: () => import('@/pages/float/FloatPanelPage.vue'),
      meta: { bare: true }
    },
    {
      // 电子书阅读独立窗口：书架 + foliate-js 阅读 iframe
      path: '/reader',
      name: 'reader',
      component: () => import('@/pages/reader/ReaderWindowPage.vue'),
      meta: { bare: true }
    }
  ]
})

export default router
