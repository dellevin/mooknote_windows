import { ipcMain } from 'electron'
import {
  tmdbTest,
  tmdbSearch,
  tmdbDetail,
  bgmTest,
  bgmSearch,
  bgmDetail,
  downloadRemoteImage,
  vipTokenCheck,
  vipSearch,
  fetchTokenDoc,
  SearchAuthError,
  SearchNetworkError
} from '../services/onlineSearch'
import { writeImageBuffer } from '../services/imageService'
import path from 'node:path'

export function registerSearchIpc(): void {
  // 凭证测试
  ipcMain.handle('search:tmdb-test', (_e, token: string, authType: string, proxy: string) =>
    tmdbTest(token, authType, proxy)
  )
  ipcMain.handle('search:bgm-test', (_e, token: string, proxy: string) =>
    bgmTest(token, proxy)
  )
  // 增强搜索 Token 校验（VIP 服务）
  ipcMain.handle(
    'search:vip-token-check',
    (_e, token: string, type: 'movie' | 'book') => vipTokenCheck(token, type)
  )
  ipcMain.handle('search:token-doc', () => fetchTokenDoc())

  // 增强搜索（VIP）：kind=movie 影视 / book 书籍
  ipcMain.handle(
    'search:vip-search',
    (_e, kind: 'movie' | 'book', query: string, page: number) =>
      vipSearch(kind, query, page ?? 1)
  )

  // TMDB
  ipcMain.handle('search:tmdb-search', (_e, query: string, page: number) =>
    tmdbSearch(query, page ?? 1)
  )
  ipcMain.handle('search:tmdb-detail', (_e, id: number, mediaType: 'movie' | 'tv') =>
    tmdbDetail(id, mediaType)
  )

  // Bangumi
  ipcMain.handle('search:bgm-search', (_e, query: string, offset: number) =>
    bgmSearch(query, offset ?? 0)
  )
  ipcMain.handle('search:bgm-detail', (_e, id: number) => bgmDetail(id))

  // 远程封面下载到本地沙箱：images/<category>/<entityId>/
  ipcMain.handle(
    'search:download-image',
    async (
      _e,
      url: string,
      source: 'tmdb' | 'bgm',
      category: 'movies' | 'books' | 'games',
      entityId: string
    ): Promise<string | null> => {
      if (!url) return null
      try {
        const buf = await downloadRemoteImage(url, source)
        const ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg'
        return writeImageBuffer(category, entityId, buf, ext)
      } catch (e) {
        if (e instanceof SearchAuthError || e instanceof SearchNetworkError) return null
        return null
      }
    }
  )
}
