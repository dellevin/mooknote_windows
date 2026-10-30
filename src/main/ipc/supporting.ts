import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { reviewDao } from '../db/dao/reviewDao'
import {
  imageCollectionDao,
  excerptDao,
  progressDao,
  completionDao
} from '../db/dao/supportingDao'
import {
  pickImageFiles,
  importImage,
  deleteEntityFolder
} from '../services/imageService'
import type {
  ReviewKind,
  ReviewInput,
  ProgressKind,
  BookExcerpt,
  ProgressEntry,
  GameCompletion
} from '../../shared/types'
import { touchParent } from '../services/sync/touchParent'

const reviewImageCategory = 'reviews'

// 子组 kind → 父表（增删改后 touch 父行，保证增量同步随父行整组推送）
const IMG_PARENT_TABLE: Record<'poster' | 'screenshot', string> = {
  poster: 'movies',
  screenshot: 'games'
}
const PROGRESS_PARENT_TABLE: Record<ProgressKind, string> = {
  episode: 'movies',
  chapter: 'books',
  level: 'games'
}

export function registerSupportingIpc(): void {
  // ---- 评价 ----
  ipcMain.handle('review:list', (_e, kind: ReviewKind, parentId: string) =>
    reviewDao.listByParent(kind, parentId)
  )
  ipcMain.handle('review:save', (_e, kind: ReviewKind, input: ReviewInput, isNew: boolean) => {
    if (isNew) reviewDao.insert(kind, input)
    else reviewDao.update(kind, input)
    return true
  })
  ipcMain.handle('review:delete', (_e, kind: ReviewKind, id: string) => {
    reviewDao.permanentDelete(kind, id)
    deleteEntityFolder(reviewImageCategory, id)
    return true
  })
  ipcMain.handle('review:new-id', () => randomUUID())
  // 评价多选图：复制进 images/reviews/<reviewId>/
  ipcMain.handle('review:pick-images', async (_e, reviewId: string): Promise<string[]> => {
    const files = await pickImageFiles(true)
    return files.map((f) => importImage(reviewImageCategory, reviewId, f))
  })

  // ---- 海报墙 / 截图 ----
  ipcMain.handle('image-collection:list', (_e, kind: 'poster' | 'screenshot', parentId: string) =>
    imageCollectionDao.list(kind, parentId)
  )
  ipcMain.handle(
    'image-collection:add',
    async (_e, kind: 'poster' | 'screenshot', parentId: string, sub?: string) => {
      const files = await pickImageFiles(true)
      const category = kind === 'poster' ? 'movies' : 'games'
      const dir = sub ?? (kind === 'poster' ? 'posterimgs' : 'screenshots')
      const paths = files.map((f) => importImage(category, parentId, f, dir))
      for (const p of paths) imageCollectionDao.add(kind, randomUUID(), parentId, p)
      touchParent(IMG_PARENT_TABLE[kind], parentId)
      return imageCollectionDao.list(kind, parentId)
    }
  )
  ipcMain.handle('image-collection:remove', (_e, kind: 'poster' | 'screenshot', id: string) => {
    const parentId = imageCollectionDao.remove(kind, id)
    if (parentId) touchParent(IMG_PARENT_TABLE[kind], parentId)
    return true
  })

  // ---- 摘抄 ----
  ipcMain.handle('excerpt:list', (_e, bookId: string) => excerptDao.list(bookId))
  ipcMain.handle('excerpt:save', (_e, e: BookExcerpt & { isNew: boolean }) => {
    excerptDao.upsert(e)
    touchParent('books', e.bookId)
    return true
  })
  ipcMain.handle('excerpt:delete', (_e, id: string) => {
    const bookId = excerptDao.remove(id)
    if (bookId) touchParent('books', bookId)
    return true
  })

  // ---- 分集/章节/关卡 ----
  ipcMain.handle('progress:list', (_e, kind: ProgressKind, parentId: string) =>
    progressDao.list(kind, parentId)
  )
  ipcMain.handle('progress:save', (_e, kind: ProgressKind, e: ProgressEntry, isNew: boolean) => {
    if (isNew) progressDao.insert(kind, e)
    else progressDao.update(kind, e)
    touchParent(PROGRESS_PARENT_TABLE[kind], e.parentId)
    return true
  })
  ipcMain.handle(
    'progress:toggle',
    (_e, kind: ProgressKind, id: string, done: boolean) => {
      const parentId = progressDao.toggleDone(kind, id, done)
      if (parentId) touchParent(PROGRESS_PARENT_TABLE[kind], parentId)
      return true
    }
  )
  ipcMain.handle('progress:delete', (_e, kind: ProgressKind, id: string) => {
    const parentId = progressDao.remove(kind, id)
    if (parentId) touchParent(PROGRESS_PARENT_TABLE[kind], parentId)
    return true
  })
  ipcMain.handle('progress:new-id', () => randomUUID())
  // 进度记录截图：images/<category>/<parentId>/<sub>/
  ipcMain.handle(
    'progress:pick-images',
    async (
      _e,
      kind: ProgressKind,
      parentId: string
    ): Promise<string[]> => {
      const map: Record<ProgressKind, { category: string; sub: string }> = {
        episode: { category: 'movies', sub: 'episodes' },
        chapter: { category: 'books', sub: 'chapters' },
        level: { category: 'games', sub: 'levels' }
      }
      const { category, sub } = map[kind]
      const files = await pickImageFiles(true)
      return files.map((f) => importImage(category, parentId, f, sub))
    }
  )

  // ---- 通关记录 ----
  ipcMain.handle('completion:list', (_e, gameId: string) => completionDao.list(gameId))
  ipcMain.handle('completion:add', (_e, c: GameCompletion) => {
    completionDao.add(c)
    touchParent('games', c.gameId)
    return true
  })
  ipcMain.handle('completion:delete', (_e, id: string) => {
    const gameId = completionDao.remove(id)
    if (gameId) touchParent('games', gameId)
    return true
  })
}
