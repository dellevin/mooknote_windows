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
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/SettingsPage.vue')
    },
    {
      path: '/db',
      name: 'db',
      component: () => import('@/pages/DbBrowserPage.vue')
    }
  ]
})

export default router
