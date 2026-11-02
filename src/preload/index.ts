import { contextBridge, ipcRenderer } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  Movie,
  MovieInput,
  Book,
  BookInput,
  Game,
  GameInput,
  Review,
  ReviewInput,
  ReviewKind,
  MediaImage,
  BookExcerpt,
  ProgressEntry,
  ProgressKind,
  GameCompletion,
  Person,
  PersonInput,
  PersonLink,
  PersonLinkWithPerson,
  PersonWork,
  MediaKind,
  Character,
  CharacterInput,
  CharacterKind,
  Playlist,
  PlaylistInput,
  PlaylistItemView,
  PlaylistType,
  Note,
  NoteInput,
  CustomModule,
  CustomModuleInput,
  CustomModuleDesign,
  CustomModuleDesignInput,
  CustomModuleItem,
  CustomModuleItemInput,
  StatsOverview,
  CalendarEntry,
  GalleryImage,
  HomeStats,
  TmdbSearchItem,
  TmdbDetail,
  TmdbCastEntry,
  TmdbPersonSearchItem,
  TmdbPersonInfo,
  BgmSearchItem,
  BgmDetail,
  WebDavConfig,
  RestoreOutcome,
  SyncOutcome,
  Tag,
  TagType,
  TagDeleteMode,
  IncSyncResult,
  IncSyncProgress,
  OcrLine,
  EngineScanResult
} from '../shared/types'

interface MediaQuery {
  status?: string
  category?: string
  keyword?: string
  sortMode?: number
  limit?: number
  offset?: number
  includeDeleted?: boolean
}

function crud<T, I>(prefix: string) {
  return {
    list: (q: MediaQuery = {}): Promise<T[]> => ipcRenderer.invoke(`${prefix}:list`, q),
    get: (id: string): Promise<T | null> => ipcRenderer.invoke(`${prefix}:get`, id),
    counts: (): Promise<Record<string, number>> =>
      ipcRenderer.invoke(`${prefix}:counts`),
    create: (input: I): Promise<T> => ipcRenderer.invoke(`${prefix}:create`, input),
    update: (input: I): Promise<T> => ipcRenderer.invoke(`${prefix}:update`, input),
    softDelete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(`${prefix}:delete`, id),
    restore: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(`${prefix}:restore`, id),
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke(`${prefix}:purge`, id),
    newId: (): Promise<string> => ipcRenderer.invoke(`${prefix}:new-id`)
  }
}

const api = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  db: {
    tables: (): Promise<string[]> => ipcRenderer.invoke('db:tables'),
    count: (table: string): Promise<number> => ipcRenderer.invoke('db:count', table),
    rows: (
      table: string,
      limit?: number,
      offset?: number,
      search?: { column: string; keyword: string }
    ): Promise<{
      columns: string[]
      primaryKeys: string[]
      columnInfo: {
        name: string
        type: string
        notNull: boolean
        defaultValue: string | null
        pk: number
      }[]
      rows: Record<string, unknown>[]
      total: number
    }> => ipcRenderer.invoke('db:rows', table, limit, offset, search),
    insert: (
      table: string,
      values: Record<string, string | null>
    ): Promise<number> => ipcRenderer.invoke('db:insert', table, values),
    deleteRow: (
      table: string,
      pk: { name: string; value: unknown }[]
    ): Promise<number> => ipcRenderer.invoke('db:delete-row', table, pk),
    updateCell: (
      table: string,
      column: string,
      value: unknown,
      pk: { name: string; value: unknown }[]
    ): Promise<number> => ipcRenderer.invoke('db:update-cell', table, column, value, pk),
    exec: (
      sql: string
    ): Promise<{ columns: string[]; rows: Record<string, unknown>[]; changes: number }> =>
      ipcRenderer.invoke('db:exec', sql)
  },
  prefs: {
    all: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('prefs:all'),
    get: <T>(key: string, fallback?: T): Promise<T> =>
      ipcRenderer.invoke('prefs:get', key, fallback),
    set: (key: string, value: unknown): Promise<boolean> =>
      ipcRenderer.invoke('prefs:set', key, value),
    onUiChanged: (cb: (key: string, value: unknown) => void): (() => void) => {
      const listener = (_e: unknown, key: unknown, value: unknown): void =>
        cb(String(key), value)
      ipcRenderer.on('ui:changed', listener)
      return () => ipcRenderer.removeListener('ui:changed', listener)
    }
  },
  movie: {
    ...crud<Movie, MovieInput>('movie'),
    metadata: (): Promise<{
      directors: string[]
      writers: string[]
      actors: string[]
      genres: string[]
    }> => ipcRenderer.invoke('movie:metadata'),
    pickCover: (entityId: string, sub?: string): Promise<string | null> =>
      ipcRenderer.invoke('movie:pick-poster', entityId, sub)
  },
  book: {
    ...crud<Book, BookInput>('book'),
    metadata: (): Promise<{
      authors: string[]
      translators: string[]
      genres: string[]
      publishers: string[]
    }> => ipcRenderer.invoke('book:metadata'),
    pickCover: (entityId: string, sub?: string): Promise<string | null> =>
      ipcRenderer.invoke('book:pick-cover', entityId, sub)
  },
  game: {
    ...crud<Game, GameInput>('game'),
    metadata: (): Promise<{
      platforms: string[]
      genres: string[]
      developer: string[]
    }> => ipcRenderer.invoke('game:metadata'),
    pickCover: (entityId: string, sub?: string): Promise<string | null> =>
      ipcRenderer.invoke('game:pick-cover', entityId, sub)
  },
  // 子模块
  review: {
    list: (kind: ReviewKind, parentId: string): Promise<Review[]> =>
      ipcRenderer.invoke('review:list', kind, parentId),
    save: (kind: ReviewKind, input: ReviewInput, isNew: boolean): Promise<boolean> =>
      ipcRenderer.invoke('review:save', kind, input, isNew),
    remove: (kind: ReviewKind, id: string): Promise<boolean> =>
      ipcRenderer.invoke('review:delete', kind, id),
    newId: (): Promise<string> => ipcRenderer.invoke('review:new-id'),
    pickImages: (reviewId: string): Promise<string[]> =>
      ipcRenderer.invoke('review:pick-images', reviewId)
  },
  imageCollection: {
    list: (kind: 'poster' | 'screenshot', parentId: string): Promise<MediaImage[]> =>
      ipcRenderer.invoke('image-collection:list', kind, parentId),
    add: (
      kind: 'poster' | 'screenshot',
      parentId: string,
      sub?: string
    ): Promise<MediaImage[]> =>
      ipcRenderer.invoke('image-collection:add', kind, parentId, sub),
    remove: (kind: 'poster' | 'screenshot', id: string): Promise<boolean> =>
      ipcRenderer.invoke('image-collection:remove', kind, id)
  },
  excerpt: {
    list: (bookId: string): Promise<BookExcerpt[]> =>
      ipcRenderer.invoke('excerpt:list', bookId),
    save: (e: BookExcerpt & { isNew: boolean }): Promise<boolean> =>
      ipcRenderer.invoke('excerpt:save', e),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('excerpt:delete', id)
  },
  progress: {
    list: (kind: ProgressKind, parentId: string): Promise<ProgressEntry[]> =>
      ipcRenderer.invoke('progress:list', kind, parentId),
    save: (kind: ProgressKind, e: ProgressEntry, isNew: boolean): Promise<boolean> =>
      ipcRenderer.invoke('progress:save', kind, e, isNew),
    toggle: (kind: ProgressKind, id: string, done: boolean): Promise<boolean> =>
      ipcRenderer.invoke('progress:toggle', kind, id, done),
    remove: (kind: ProgressKind, id: string): Promise<boolean> =>
      ipcRenderer.invoke('progress:delete', kind, id),
    batchGenerate: (
      kind: ProgressKind,
      parentId: string,
      startNo: number,
      count: number
    ): Promise<number> =>
      ipcRenderer.invoke('progress:batch-generate', kind, parentId, startNo, count),
    newId: (): Promise<string> => ipcRenderer.invoke('progress:new-id'),
    pickImages: (kind: ProgressKind, parentId: string): Promise<string[]> =>
      ipcRenderer.invoke('progress:pick-images', kind, parentId)
  },
  completion: {
    list: (gameId: string): Promise<GameCompletion[]> =>
      ipcRenderer.invoke('completion:list', gameId),
    add: (c: GameCompletion): Promise<boolean> =>
      ipcRenderer.invoke('completion:add', c),
    remove: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('completion:delete', id)
  },
  // 人物
  person: {
    list: (
      keyword?: string,
      includeDeleted?: boolean,
      sort?: 'updated' | 'created' | 'name' | 'birth'
    ): Promise<Person[]> => ipcRenderer.invoke('person:list', keyword, includeDeleted, sort),
    get: (id: string): Promise<Person | null> => ipcRenderer.invoke('person:get', id),
    names: (): Promise<string[]> => ipcRenderer.invoke('person:names'),
    create: (input: PersonInput): Promise<Person> =>
      ipcRenderer.invoke('person:create', input),
    update: (input: PersonInput): Promise<Person> =>
      ipcRenderer.invoke('person:update', input),
    softDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('person:delete', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('person:restore', id),
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke('person:purge', id),
    newId: (): Promise<string> => ipcRenderer.invoke('person:new-id'),
    pickPhoto: (personId: string): Promise<string | null> =>
      ipcRenderer.invoke('person:pick-photo', personId),
    tmdbCastPreview: (
      tmdbId: number,
      mediaType: 'movie' | 'tv'
    ): Promise<TmdbCastEntry[]> =>
      ipcRenderer.invoke('person:tmdb-cast-preview', tmdbId, mediaType),
    importTmdbCast: (
      movieId: string,
      entries: TmdbCastEntry[],
      picks: Record<string, string>
    ): Promise<{ created: number; linked: number; skipped: number }> =>
      ipcRenderer.invoke('person:import-tmdb-cast', movieId, entries, picks),
    tmdbSearchPeople: (query: string): Promise<TmdbPersonSearchItem[]> =>
      ipcRenderer.invoke('person:tmdb-search-people', query),
    tmdbFetchPerson: (tmdbId: number, localPersonId: string): Promise<TmdbPersonInfo> =>
      ipcRenderer.invoke('person:tmdb-fetch-person', tmdbId, localPersonId)
  },
  personLink: {
    byWork: (kind: MediaKind, workId: string): Promise<PersonLinkWithPerson[]> =>
      ipcRenderer.invoke('person-link:by-work', kind, workId),
    works: (personId: string): Promise<PersonWork[]> =>
      ipcRenderer.invoke('person-link:works', personId),
    replace: (kind: MediaKind, workId: string, links: PersonLink[]): Promise<boolean> =>
      ipcRenderer.invoke('person-link:replace', kind, workId, links)
  },
  character: {
    list: (kind: CharacterKind, parentId: string): Promise<Character[]> =>
      ipcRenderer.invoke('character:list', kind, parentId),
    save: (kind: CharacterKind, input: CharacterInput, isNew: boolean): Promise<boolean> =>
      ipcRenderer.invoke('character:save', kind, input, isNew),
    remove: (kind: CharacterKind, id: string): Promise<boolean> =>
      ipcRenderer.invoke('character:delete', kind, id),
    newId: (): Promise<string> => ipcRenderer.invoke('character:new-id'),
    pickImage: (characterId: string): Promise<string | null> =>
      ipcRenderer.invoke('character:pick-image', characterId),
    importTmdb: (
      movieId: string,
      tmdbId: number,
      mediaType: 'movie' | 'tv'
    ): Promise<{ created: number; skipped: number }> =>
      ipcRenderer.invoke('character:import-tmdb', movieId, tmdbId, mediaType)
  },
  // 片单
  playlist: {
    list: (includeDeleted?: boolean): Promise<Playlist[]> =>
      ipcRenderer.invoke('playlist:list', includeDeleted),
    get: (id: string): Promise<Playlist | null> => ipcRenderer.invoke('playlist:get', id),
    create: (input: PlaylistInput): Promise<Playlist> =>
      ipcRenderer.invoke('playlist:create', input),
    update: (input: PlaylistInput): Promise<Playlist> =>
      ipcRenderer.invoke('playlist:update', input),
    softDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('playlist:delete', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('playlist:restore', id),
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke('playlist:purge', id),
    newId: (): Promise<string> => ipcRenderer.invoke('playlist:new-id'),
    items: (id: string): Promise<PlaylistItemView[]> =>
      ipcRenderer.invoke('playlist:items', id),
    addItem: (playlistId: string, itemId: string): Promise<boolean> =>
      ipcRenderer.invoke('playlist:add-item', playlistId, itemId),
    removeItem: (playlistId: string, itemRowId: string): Promise<boolean> =>
      ipcRenderer.invoke('playlist:remove-item', playlistId, itemRowId)
  },
  // 笔记
  note: {
    list: (q?: {
      keyword?: string
      tag?: string
      sortMode?: number
      includeDeleted?: boolean
      limit?: number
      offset?: number
    }): Promise<Note[]> => ipcRenderer.invoke('note:list', q),
    get: (id: string): Promise<Note | null> => ipcRenderer.invoke('note:get', id),
    tags: (): Promise<string[]> => ipcRenderer.invoke('note:tags'),
    create: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('note:create', input),
    update: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('note:update', input),
    softDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('note:delete', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('note:restore', id),
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke('note:purge', id),
    togglePin: (id: string, pinned: boolean): Promise<boolean> =>
      ipcRenderer.invoke('note:toggle-pin', id, pinned),
    newId: (): Promise<string> => ipcRenderer.invoke('note:new-id'),
    pickImages: (noteId: string): Promise<string[]> =>
      ipcRenderer.invoke('note:pick-images', noteId)
  },
  // 自定义模块
  customModule: {
    list: (includeDeleted?: boolean): Promise<CustomModule[]> =>
      ipcRenderer.invoke('cm:list', includeDeleted),
    get: (id: string): Promise<CustomModule | null> => ipcRenderer.invoke('cm:get', id),
    create: (input: CustomModuleInput): Promise<CustomModule> =>
      ipcRenderer.invoke('cm:create', input),
    update: (input: CustomModuleInput): Promise<CustomModule> =>
      ipcRenderer.invoke('cm:update', input),
    setEnabled: (id: string, enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke('cm:set-enabled', id, enabled),
    softDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('cm:delete', id),
    newId: (): Promise<string> => ipcRenderer.invoke('cm:new-id'),
    nextSort: (): Promise<number> => ipcRenderer.invoke('cm:next-sort')
  },
  customDesign: {
    list: (moduleId: string): Promise<CustomModuleDesign[]> =>
      ipcRenderer.invoke('cm-design:list', moduleId),
    get: (id: string): Promise<CustomModuleDesign | null> =>
      ipcRenderer.invoke('cm-design:get', id),
    active: (moduleId: string): Promise<CustomModuleDesign | null> =>
      ipcRenderer.invoke('cm-design:active', moduleId),
    save: (input: CustomModuleDesignInput, isNew: boolean): Promise<CustomModuleDesign> =>
      ipcRenderer.invoke('cm-design:save', input, isNew),
    setActive: (moduleId: string, designId: string): Promise<boolean> =>
      ipcRenderer.invoke('cm-design:set-active', moduleId, designId),
    softDelete: (moduleId: string, designId: string): Promise<boolean> =>
      ipcRenderer.invoke('cm-design:delete', moduleId, designId),
    newId: (): Promise<string> => ipcRenderer.invoke('cm-design:new-id')
  },
  customItem: {
    list: (moduleId: string): Promise<CustomModuleItem[]> =>
      ipcRenderer.invoke('cm-item:list', moduleId),
    deleted: (): Promise<CustomModuleItem[]> => ipcRenderer.invoke('cm-item:deleted'),
    get: (id: string): Promise<CustomModuleItem | null> => ipcRenderer.invoke('cm-item:get', id),
    count: (moduleId: string): Promise<number> => ipcRenderer.invoke('cm-item:count', moduleId),
    search: (moduleId: string, keyword: string): Promise<CustomModuleItem[]> =>
      ipcRenderer.invoke('cm-item:search', moduleId, keyword),
    create: (input: CustomModuleItemInput): Promise<CustomModuleItem> =>
      ipcRenderer.invoke('cm-item:create', input),
    update: (input: CustomModuleItemInput): Promise<CustomModuleItem> =>
      ipcRenderer.invoke('cm-item:update', input),
    softDelete: (id: string): Promise<boolean> => ipcRenderer.invoke('cm-item:delete', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('cm-item:restore', id),
    purge: (id: string): Promise<boolean> => ipcRenderer.invoke('cm-item:purge', id),
    newId: (): Promise<string> => ipcRenderer.invoke('cm-item:new-id'),
    pickPoster: (moduleId: string, itemId: string): Promise<string | null> =>
      ipcRenderer.invoke('cm-item:pick-poster', moduleId, itemId),
    pickImages: (moduleId: string, itemId: string): Promise<string[]> =>
      ipcRenderer.invoke('cm-item:pick-images', moduleId, itemId)
  },
  stats: {
    overview: (): Promise<StatsOverview> => ipcRenderer.invoke('stats:overview'),
    calendar: (mode: 0 | 1): Promise<CalendarEntry[]> =>
      ipcRenderer.invoke('stats:calendar', mode),
    gallery: (): Promise<GalleryImage[]> => ipcRenderer.invoke('stats:gallery'),
    home: (): Promise<HomeStats> => ipcRenderer.invoke('stats:home'),
    dayItems: (
      day: string
    ): Promise<{ kind: string; id: string; title: string; cover: string | null }[]> =>
      ipcRenderer.invoke('stats:day-items', day)
  },
  excel: {
    export: (kind: 'movie' | 'book' | 'game'): Promise<string | null> =>
      ipcRenderer.invoke('export:excel', kind)
  },
  shell: {
    openPath: (p: string): Promise<boolean> => ipcRenderer.invoke('shell:open-path', p)
  },
  image: {
    saveAs: (src: string, suggestedName?: string): Promise<boolean> =>
      ipcRenderer.invoke('image:save-as', src, suggestedName)
  },
  profile: {
    pickAvatar: (): Promise<string | null> =>
      ipcRenderer.invoke('profile:pick-avatar')
  },
  search: {
    tmdbTest: (token: string, authType: string, proxy: string): Promise<string> =>
      ipcRenderer.invoke('search:tmdb-test', token, authType, proxy),
    bgmTest: (token: string, proxy: string): Promise<boolean> =>
      ipcRenderer.invoke('search:bgm-test', token, proxy),
    tmdbSearch: (
      query: string,
      page: number
    ): Promise<{ results: TmdbSearchItem[]; page: number; totalPages: number }> =>
      ipcRenderer.invoke('search:tmdb-search', query, page),
    tmdbDetail: (id: number, mediaType: 'movie' | 'tv'): Promise<TmdbDetail> =>
      ipcRenderer.invoke('search:tmdb-detail', id, mediaType),
    bgmSearch: (
      query: string,
      offset: number
    ): Promise<{ results: BgmSearchItem[]; total: number }> =>
      ipcRenderer.invoke('search:bgm-search', query, offset),
    bgmDetail: (id: number): Promise<BgmDetail> =>
      ipcRenderer.invoke('search:bgm-detail', id),
    downloadImage: (
      url: string,
      source: 'tmdb' | 'bgm',
      category: 'movies' | 'books' | 'games',
      entityId: string
    ): Promise<string | null> =>
      ipcRenderer.invoke('search:download-image', url, source, category, entityId),
    vipTokenCheck: (
      token: string,
      type: 'movie' | 'book'
    ): Promise<{ valid: boolean; message: string }> =>
      ipcRenderer.invoke('search:vip-token-check', token, type),
    vipSearch: (
      kind: 'movie' | 'book',
      query: string,
      page: number
    ): Promise<{
      results: {
        id: string
        title: string
        cover: string
        subtitle: string
        extra: string
        raw: Record<string, unknown>
      }[]
      page: number
      totalPages: number
    }> => ipcRenderer.invoke('search:vip-search', kind, query, page),
    tokenDoc: (): Promise<string> => ipcRenderer.invoke('search:token-doc')
  },
  backup: {
    export: (): Promise<{ path: string; imageCount: number } | null> =>
      ipcRenderer.invoke('backup:export'),
    import: (): Promise<RestoreOutcome | null> => ipcRenderer.invoke('backup:import')
  },
  webdav: {
    getConfig: (): Promise<WebDavConfig | null> => ipcRenderer.invoke('webdav:get-config'),
    saveConfig: (cfg: WebDavConfig): Promise<boolean> =>
      ipcRenderer.invoke('webdav:save-config', cfg),
    clearConfig: (): Promise<boolean> => ipcRenderer.invoke('webdav:clear-config'),
    test: (cfg: WebDavConfig): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('webdav:test', cfg),
    upload: (): Promise<SyncOutcome> => ipcRenderer.invoke('webdav:upload'),
    download: (): Promise<SyncOutcome> => ipcRenderer.invoke('webdav:download'),
    onDownloadProgress: (
      cb: (p: { received: number; total: number; percent: number }) => void
    ): (() => void) => {
      const listener = (
        _e: unknown,
        p: { received: number; total: number; percent: number }
      ): void => cb(p)
      ipcRenderer.on('webdav:download-progress', listener)
      return () => ipcRenderer.removeListener('webdav:download-progress', listener)
    },
    onUploadProgress: (
      cb: (p: { received: number; total: number; percent: number; stage: string }) => void
    ): (() => void) => {
      const listener = (
        _e: unknown,
        p: { received: number; total: number; percent: number; stage: string }
      ): void => cb(p)
      ipcRenderer.on('webdav:upload-progress', listener)
      return () => ipcRenderer.removeListener('webdav:upload-progress', listener)
    },
    lastSync: (): Promise<string> => ipcRenderer.invoke('webdav:last-sync')
  },
  incSync: {
    upload: (): Promise<IncSyncResult> => ipcRenderer.invoke('inc-sync:upload'),
    download: (): Promise<IncSyncResult> => ipcRenderer.invoke('inc-sync:download'),
    restore: (): Promise<IncSyncResult> => ipcRenderer.invoke('inc-sync:restore'),
    forcePush: (): Promise<IncSyncResult> => ipcRenderer.invoke('inc-sync:force-push'),
    info: (
      fetchRemoteVersion?: boolean
    ): Promise<{ lastSync: string; manifestVersion: number | null }> =>
      ipcRenderer.invoke('inc-sync:info', fetchRemoteVersion),
    onProgress: (cb: (p: IncSyncProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: IncSyncProgress): void => cb(p)
      ipcRenderer.on('inc-sync:progress', listener)
      return () => ipcRenderer.removeListener('inc-sync:progress', listener)
    }
  },
  tag: {
    list: (type?: TagType): Promise<Tag[]> => ipcRenderer.invoke('tag:list', type),
    add: (type: TagType, name: string): Promise<Tag> =>
      ipcRenderer.invoke('tag:add', type, name),
    rename: (id: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke('tag:rename', id, name),
    toggleHidden: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('tag:toggle-hidden', id),
    move: (id: string, parentId: string, beforeId: string | null): Promise<boolean> =>
      ipcRenderer.invoke('tag:move', id, parentId, beforeId),
    remove: (id: string, mode: TagDeleteMode, replacementName?: string): Promise<boolean> =>
      ipcRenderer.invoke('tag:remove', id, mode, replacementName),
    sync: (): Promise<number> => ipcRenderer.invoke('tag:sync'),
    usage: (type: TagType): Promise<Record<string, number>> =>
      ipcRenderer.invoke('tag:usage', type)
  },
  // 桌面悬浮球（独立置顶窗口）
  float: {
    dragStart: (): void => ipcRenderer.send('float:drag-start'),
    dragMove: (): void => ipcRenderer.send('float:drag-move'),
    dragEnd: (): void => ipcRenderer.send('float:drag-end'),
    toggleMenu: (): Promise<void> => ipcRenderer.invoke('float:toggle-menu'),
    setMode: (mode: 'menu' | 'result'): Promise<void> =>
      ipcRenderer.invoke('float:set-mode', mode),
    hide: (): void => ipcRenderer.send('float:hide'),
    getEnabled: (): Promise<boolean> => ipcRenderer.invoke('float:get-enabled'),
    setEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('float:set-enabled', enabled),
    onBusy: (cb: (busy: boolean) => void): (() => void) => {
      const listener = (_e: unknown, busy: boolean): void => cb(busy)
      ipcRenderer.on('float:busy', listener)
      return () => ipcRenderer.removeListener('float:busy', listener)
    },
    onMode: (cb: (mode: 'menu' | 'result') => void): (() => void) => {
      const listener = (_e: unknown, mode: 'menu' | 'result'): void => cb(mode)
      ipcRenderer.on('float:mode', listener)
      return () => ipcRenderer.removeListener('float:mode', listener)
    },
    onHidden: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('float:hidden', listener)
      return () => ipcRenderer.removeListener('float:hidden', listener)
    },
    presented: (): void => ipcRenderer.send('float:panel-presented')
  },
  // OCR：悬浮球发起截屏选区识别
  ocr: {
    capture: (): Promise<OcrLine[] | null> => ipcRenderer.invoke('ocr:capture'),
    cloudConfig: (): Promise<{
      configured: boolean
      model: string
      provider: 'xf' | 'baidu' | 'local'
    }> => ipcRenderer.invoke('ocr:cloud-config'),
    cloudTest: (): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('ocr:cloud-test'),
    enginesScan: (force?: boolean): Promise<EngineScanResult> =>
      ipcRenderer.invoke('ocr:engines-scan', force),
    engineOpenDir: (): Promise<{ ok: boolean; error: string }> =>
      ipcRenderer.invoke('ocr:engine-open-dir'),
    overlayInit: (
      displayId: string
    ): Promise<{
      dataUrl: string
      scaleFactor: number
      pixels: { width: number; height: number } | null
    } | null> => ipcRenderer.invoke('ocr:overlay-init', displayId),
    overlayRecognize: (png: ArrayBuffer): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('ocr:overlay-result', png),
    overlayCancel: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('ocr:overlay-cancel'),
    copyText: (text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('ocr:copy-text', text)
  },
  // 截屏标注：独立于 OCR 的微信式截图工具
  shot: {
    capture: (): Promise<{ canceled: boolean; lines: OcrLine[] | null }> =>
      ipcRenderer.invoke('shot:capture'),
    overlayInit: (
      displayId: string
    ): Promise<{
      dataUrl: string
      scaleFactor: number
      pixels: { width: number; height: number } | null
    } | null> => ipcRenderer.invoke('shot:overlay-init', displayId),
    overlayOcr: (png: ArrayBuffer): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('shot:overlay-ocr', png),
    overlayCancel: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('shot:overlay-cancel'),
    overlaySave: (png: ArrayBuffer): Promise<{ ok: boolean; canceled?: boolean }> =>
      ipcRenderer.invoke('shot:overlay-save', png),
    overlayPin: (payload: {
      dataUrl: string
      width: number
      height: number
      x?: number
      y?: number
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke('shot:overlay-pin', payload),
    pinInit: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('shot:pin-init', id),
    pinClose: (): void => ipcRenderer.send('shot:pin-close')
  },
  util: {
    uuid: (): string => randomUUID()
  },
  maintenance: {
    clearCache: (): Promise<{ bytes: number; orphanImages: number; emptyDirs: number }> =>
      ipcRenderer.invoke('maintenance:clear-cache'),
    cleanEmptyDirs: (): Promise<{ removed: number }> =>
      ipcRenderer.invoke('maintenance:clean-empty-dirs'),
    purgeDeleted: (): Promise<{ rows: number; tables: number }> =>
      ipcRenderer.invoke('maintenance:purge-deleted')
  },
  // 无边框窗口控制
  window: {
    minimize: (): void => ipcRenderer.send('win:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('win:toggle-max'),
    close: (): void => ipcRenderer.send('win:close'),
    onMaximizedChange: (cb: (maximized: boolean) => void): void => {
      const listener = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('win:max-changed', listener)
    },
    onCloseQuery: (cb: () => void): void => {
      ipcRenderer.on('win:close-query', () => cb())
    },
    closeDecision: (quit: boolean, remember: boolean): void => {
      ipcRenderer.send('win:close-decision', { quit, remember })
    },
    closeCancel: (): void => ipcRenderer.send('win:close-cancel'),
    toggleDevTools: (): void => ipcRenderer.send('win:toggle-devtools'),
    setIcon: (src: string | null): Promise<boolean> =>
      ipcRenderer.invoke('win:set-icon', src),
    shellInfo: (): Promise<{
      material: 'mica' | 'solid'
      accent: string
      dark: boolean
    }> => ipcRenderer.invoke('win:shell-info')
  }
}

contextBridge.exposeInMainWorld('mook', api)

export type MookApi = typeof api
