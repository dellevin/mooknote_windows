import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { personDao, personLinkDao } from '../db/dao/personDao'
import { characterDao } from '../db/dao/characterDao'
import { playlistDao } from '../db/dao/playlistDao'
import {
  pickImageFiles,
  importImage,
  deleteEntityFolder,
  writeImageBuffer
} from '../services/imageService'
import {
  tmdbCredits,
  tmdbPersonSearch,
  tmdbPersonDetail,
  downloadRemoteImage
} from '../services/onlineSearch'
import type {
  PersonInput,
  MediaKind,
  PersonLink,
  CharacterKind,
  CharacterInput,
  PlaylistInput,
  TmdbCastPerson,
  TmdbCastEntry
} from '../../shared/types'
import { touchParent } from '../services/sync/touchParent'

const MEDIA_PARENT_TABLE: Record<MediaKind, string> = {
  movie: 'movies',
  book: 'books',
  game: 'games'
}

export function registerPeopleIpc(): void {
  // ---- 人物档案 ----
  ipcMain.handle(
    'person:list',
    (
      _e,
      keyword?: string,
      includeDeleted?: boolean,
      sort?: 'updated' | 'created' | 'name' | 'birth'
    ) => personDao.list(keyword ?? '', includeDeleted ?? false, sort ?? 'updated')
  )
  ipcMain.handle('person:get', (_e, id: string) => personDao.getById(id))
  ipcMain.handle('person:names', () => personDao.allNames())
  ipcMain.handle('person:create', (_e, input: PersonInput) => personDao.insert(input))
  ipcMain.handle('person:update', (_e, input: PersonInput) => personDao.update(input))
  ipcMain.handle('person:delete', (_e, id: string) => {
    personDao.softDelete(id)
    return true
  })
  ipcMain.handle('person:restore', (_e, id: string) => {
    personDao.restore(id)
    return true
  })
  ipcMain.handle('person:purge', (_e, id: string) => {
    personDao.permanentDelete(id)
    deleteEntityFolder('people', id)
    return true
  })
  ipcMain.handle('person:new-id', () => randomUUID())
  ipcMain.handle('person:pick-photo', async (_e, personId: string): Promise<string | null> => {
    const files = await pickImageFiles(false)
    return files.length ? importImage('people', personId, files[0]) : null
  })

  // ---- 人物编辑：TMDB 搜索 / 获取详情（头像下载到本地人物目录） ----
  ipcMain.handle('person:tmdb-search-people', (_e, query: string) =>
    tmdbPersonSearch(query.trim())
  )
  ipcMain.handle(
    'person:tmdb-fetch-person',
    async (_e, tmdbId: number, localPersonId: string) => {
      const info = await tmdbPersonDetail(tmdbId)
      const remoteUrl = info.photoPath
      info.photoPath = null
      if (remoteUrl) {
        try {
          const buf = await downloadRemoteImage(remoteUrl, 'tmdb')
          const ext = path.extname(new URL(remoteUrl).pathname).toLowerCase() || '.jpg'
          info.photoPath = writeImageBuffer('people', localPersonId, buf, ext)
        } catch {
          info.photoPath = null
        }
      }
      return info
    }
  )

  // ---- 作品 ↔ 人物关联 ----
  ipcMain.handle('person-link:by-work', (_e, kind: MediaKind, workId: string) =>
    personLinkDao.listByWork(kind, workId)
  )
  ipcMain.handle('person-link:works', (_e, personId: string) =>
    personLinkDao.worksByPerson(personId)
  )
  ipcMain.handle(
    'person-link:replace',
    (_e, kind: MediaKind, workId: string, links: PersonLink[]) => {
      personLinkDao.replaceForWork(kind, workId, links)
      // 链接表无时间戳，必须 touch 父作品行才能把关联变更推送出去
      touchParent(MEDIA_PARENT_TABLE[kind], workId)
      return true
    }
  )

  // ---- 从 TMDB 导入影视演职人员：预览（聚合演员+角色名 / 导演 / 编剧） ----
  ipcMain.handle(
    'person:tmdb-cast-preview',
    async (_e, tmdbId: number, mediaType: 'movie' | 'tv'): Promise<TmdbCastEntry[]> => {
      const credits = await tmdbCredits(tmdbId, mediaType)
      // 按 TMDB 人物 id 聚合：同一人可能既是导演又是演员
      const aggMap = new Map<
        number,
        {
          tmdbId: number
          name: string
          profileUrl: string | null
          parts: TmdbCastEntry['parts']
          partSet: Set<string>
          order: number
        }
      >()
      const ensure = (p: TmdbCastPerson) => {
        let a = aggMap.get(p.tmdbId)
        if (!a) {
          a = {
            tmdbId: p.tmdbId,
            name: p.name,
            profileUrl: null,
            parts: [],
            partSet: new Set(),
            order: 9999
          }
          aggMap.set(p.tmdbId, a)
        }
        if (p.profileUrl) a.profileUrl = p.profileUrl
        a.order = Math.min(a.order, p.order)
        return a
      }
      const roleOfJob = (job: string | null): 'director' | 'writer' | null =>
        job === 'Director' ? 'director' : job === 'Screenplay' || job === 'Writer' ? 'writer' : null
      for (const p of [...credits.crew].sort((x, y) => x.order - y.order)) {
        const role = roleOfJob(p.job)
        if (!role) continue
        const a = ensure(p)
        if (!a.partSet.has(role)) {
          a.partSet.add(role)
          a.parts.push({ role, character: null })
        }
      }
      for (const p of [...credits.cast].sort((x, y) => x.order - y.order)) {
        const a = ensure(p)
        if (!a.partSet.has('actor')) {
          a.partSet.add('actor')
          a.parts.push({ role: 'actor', character: p.character })
        }
      }
      return [...aggMap.values()]
        .sort((x, y) => x.order - y.order)
        .map(({ tmdbId, name, profileUrl, parts, order }) => ({
          tmdbId,
          name,
          profileUrl,
          parts,
          order
        }))
    }
  )

  // picks: tmdbId -> 已有人物 id；缺省（或 'new'）表示新建人物
  ipcMain.handle(
    'person:import-tmdb-cast',
    async (
      _e,
      movieId: string,
      entries: TmdbCastEntry[],
      picks: Record<string, string>
    ): Promise<{ created: number; linked: number; skipped: number }> => {
      const existing = personLinkDao.listByWork('movie', movieId)
      const have = new Set(
        existing.map((l) => `${l.personId}|${l.roleType}|${l.characterName ?? ''}`)
      )
      const OCC: Record<string, string> = { director: '导演', writer: '编剧', actor: '演员' }

      const next: PersonLink[] = existing.map((l) => ({
        id: l.id,
        workId: l.workId,
        personId: l.personId,
        roleType: l.roleType,
        characterName: l.characterName,
        sortOrder: l.sortOrder
      }))

      let created = 0
      let linked = 0
      let skipped = 0
      let sortBase = next.length

      for (const entry of entries) {
        let person =
          picks[String(entry.tmdbId)] && picks[String(entry.tmdbId)] !== 'new'
            ? personDao.getById(picks[String(entry.tmdbId)])
            : null
        // 合并到已有人物：旧数据缺头像、TMDB 有头像时补全；已有头像则保留
        if (person && !person.photoPath && entry.profileUrl) {
          try {
            const buf = await downloadRemoteImage(entry.profileUrl, 'tmdb')
            const ext = path.extname(new URL(entry.profileUrl).pathname).toLowerCase() || '.jpg'
            const photoPath = writeImageBuffer('people', person.id, buf, ext)
            person = personDao.update({ ...person, photoPath })
          } catch {
            // 头像下载失败不阻断导入
          }
        }
        if (!person) {
          const id = randomUUID()
          let photoPath: string | null = null
          if (entry.profileUrl) {
            try {
              const buf = await downloadRemoteImage(entry.profileUrl, 'tmdb')
              const ext = path.extname(new URL(entry.profileUrl).pathname).toLowerCase() || '.jpg'
              photoPath = writeImageBuffer('people', id, buf, ext)
            } catch {
              photoPath = null
            }
          }
          const input: PersonInput = {
            id,
            name: entry.name,
            gender: null,
            birthDate: null,
            birthPlace: null,
            alternateNames: [],
            occupation: entry.parts.map((p) => OCC[p.role]),
            summary: null,
            photoPath,
            coverOffset: 0
          }
          person = personDao.insert(input)
          created++
        }
        for (const part of entry.parts) {
          const key = `${person.id}|${part.role}|${part.role === 'actor' ? part.character ?? '' : ''}`
          if (have.has(key)) {
            skipped++
            continue
          }
          have.add(key)
          next.push({
            id: randomUUID(),
            workId: movieId,
            personId: person.id,
            roleType: part.role,
            characterName: part.role === 'actor' ? part.character : null,
            sortOrder: sortBase++
          })
          linked++
        }
      }

      personLinkDao.replaceForWork('movie', movieId, next)
      touchParent(MEDIA_PARENT_TABLE.movie, movieId)
      return { created, linked, skipped }
    }
  )

  // ---- 从 TMDB 一键导入影视角色（演员饰演的虚构角色名） ----
  ipcMain.handle(
    'character:import-tmdb',
    async (
      _e,
      movieId: string,
      tmdbId: number,
      mediaType: 'movie' | 'tv'
    ): Promise<{ created: number; skipped: number }> => {
      const credits = await tmdbCredits(tmdbId, mediaType)
      // 角色名可能是「A / B」「A, B」，拆开；过滤本人/旁白等无效项
      const SPLIT_RE = /\s*[/／,、]\s*/
      const STOP = new Set(['self', 'himself', 'herself', 'narrator', ''])
      const names: string[] = []
      const seen = new Set<string>()
      for (const c of [...credits.cast].sort((a, b) => a.order - b.order)) {
        if (!c.character) continue
        for (const raw of c.character.split(SPLIT_RE)) {
          const name = raw.trim()
          const key = name.toLocaleLowerCase()
          if (!name || STOP.has(key) || seen.has(key)) continue
          seen.add(key)
          names.push(name)
        }
      }
      const existing = new Set(characterDao.list('movie', movieId).map((c) => c.name))
      let sortBase = existing.size
      let created = 0
      let skipped = 0
      for (const name of names) {
        if (existing.has(name)) {
          skipped++
          continue
        }
        characterDao.insert('movie', {
          id: randomUUID(),
          parentId: movieId,
          name,
          role: null,
          aliases: [],
          tags: [],
          description: null,
          imagePath: null,
          sortOrder: sortBase++
        })
        existing.add(name)
        created++
      }
      touchParent(MEDIA_PARENT_TABLE.movie, movieId)
      return { created, skipped }
    }
  )

  // ---- 角色 ----
  ipcMain.handle('character:list', (_e, kind: CharacterKind, parentId: string) =>
    characterDao.list(kind, parentId)
  )
  ipcMain.handle(
    'character:save',
    (_e, kind: CharacterKind, input: CharacterInput, isNew: boolean) => {
      if (isNew) characterDao.insert(kind, input)
      else characterDao.update(kind, input)
      return true
    }
  )
  ipcMain.handle('character:delete', (_e, kind: CharacterKind, id: string) => {
    characterDao.remove(kind, id)
    deleteEntityFolder('characters', id)
    return true
  })
  ipcMain.handle('character:new-id', () => randomUUID())
  // 角色图片统一放 images/characters/<characterId>/
  ipcMain.handle(
    'character:pick-image',
    async (_e, characterId: string): Promise<string | null> => {
      const files = await pickImageFiles(false)
      return files.length ? importImage('characters', characterId, files[0]) : null
    }
  )

  // ---- 片单 ----
  ipcMain.handle('playlist:list', (_e, includeDeleted?: boolean) =>
    playlistDao.list(includeDeleted ?? false)
  )
  ipcMain.handle('playlist:get', (_e, id: string) => playlistDao.getById(id))
  ipcMain.handle('playlist:create', (_e, input: PlaylistInput) => playlistDao.insert(input))
  ipcMain.handle('playlist:update', (_e, input: PlaylistInput) => playlistDao.update(input))
  ipcMain.handle('playlist:delete', (_e, id: string) => {
    playlistDao.softDelete(id)
    return true
  })
  ipcMain.handle('playlist:restore', (_e, id: string) => {
    playlistDao.restore(id)
    return true
  })
  ipcMain.handle('playlist:purge', (_e, id: string) => {
    playlistDao.permanentDelete(id)
    return true
  })
  ipcMain.handle('playlist:new-id', () => randomUUID())
  ipcMain.handle('playlist:items', (_e, id: string) => playlistDao.items(id))
  ipcMain.handle('playlist:add-item', (_e, playlistId: string, itemId: string) => {
    playlistDao.addItem(playlistId, itemId)
    return true
  })
  ipcMain.handle('playlist:remove-item', (_e, playlistId: string, itemRowId: string) => {
    playlistDao.removeItem(itemRowId, playlistId)
    return true
  })
}
