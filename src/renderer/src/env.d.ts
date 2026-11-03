/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

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
  HomeStats,
  CalendarEntry,
  GalleryImage,
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
  EngineScanResult,
  PickedColor
} from '@shared/types'

interface MediaQuery {
  status?: string
  category?: string
  keyword?: string
  sortMode?: number
  limit?: number
  offset?: number
  includeDeleted?: boolean
}

interface MediaCrud<T, I> {
  list: (q?: MediaQuery) => Promise<T[]>
  get: (id: string) => Promise<T | null>
  counts: () => Promise<Record<string, number>>
  create: (input: I) => Promise<T>
  update: (input: I) => Promise<T>
  softDelete: (id: string) => Promise<boolean>
  restore: (id: string) => Promise<boolean>
  purge: (id: string) => Promise<boolean>
  newId: () => Promise<string>
}

interface MookApi {
  appInfo: () => Promise<{
    version: string
    dataRoot: string
    dbPath: string
    imagesRoot: string
    platform: string
  }>
  db: {
    tables: () => Promise<string[]>
    count: (table: string) => Promise<number>
    rows: (
      table: string,
      limit?: number,
      offset?: number,
      search?: { column: string; keyword: string }
    ) => Promise<{
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
    }>
    insert: (
      table: string,
      values: Record<string, string | null>
    ) => Promise<number>
    deleteRow: (
      table: string,
      pk: { name: string; value: unknown }[]
    ) => Promise<number>
    updateCell: (
      table: string,
      column: string,
      value: unknown,
      pk: { name: string; value: unknown }[]
    ) => Promise<number>
    exec: (
      sql: string
    ) => Promise<{ columns: string[]; rows: Record<string, unknown>[]; changes: number }>
  }
  prefs: {
    all: () => Promise<Record<string, unknown>>
    get: <T>(key: string, fallback?: T) => Promise<T>
    set: (key: string, value: unknown) => Promise<boolean>
    onUiChanged: (cb: (key: string, value: unknown) => void) => () => void
  }
  movie: MediaCrud<Movie, MovieInput> & {
    metadata: () => Promise<{
      directors: string[]
      writers: string[]
      actors: string[]
      genres: string[]
    }>
    pickCover: (entityId: string, sub?: string) => Promise<string | null>
  }
  book: MediaCrud<Book, BookInput> & {
    metadata: () => Promise<{
      authors: string[]
      translators: string[]
      genres: string[]
      publishers: string[]
    }>
    pickCover: (entityId: string, sub?: string) => Promise<string | null>
  }
  game: MediaCrud<Game, GameInput> & {
    metadata: () => Promise<{
      platforms: string[]
      genres: string[]
      developer: string[]
    }>
    pickCover: (entityId: string, sub?: string) => Promise<string | null>
  }
  review: {
    list: (kind: ReviewKind, parentId: string) => Promise<Review[]>
    save: (kind: ReviewKind, input: ReviewInput, isNew: boolean) => Promise<boolean>
    remove: (kind: ReviewKind, id: string) => Promise<boolean>
    newId: () => Promise<string>
    pickImages: (reviewId: string) => Promise<string[]>
  }
  imageCollection: {
    list: (kind: 'poster' | 'screenshot', parentId: string) => Promise<MediaImage[]>
    add: (
      kind: 'poster' | 'screenshot',
      parentId: string,
      sub?: string
    ) => Promise<MediaImage[]>
    remove: (kind: 'poster' | 'screenshot', id: string) => Promise<boolean>
  }
  excerpt: {
    list: (bookId: string) => Promise<BookExcerpt[]>
    save: (e: BookExcerpt & { isNew: boolean }) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
  }
  progress: {
    list: (kind: ProgressKind, parentId: string) => Promise<ProgressEntry[]>
    save: (kind: ProgressKind, e: ProgressEntry, isNew: boolean) => Promise<boolean>
    toggle: (kind: ProgressKind, id: string, done: boolean) => Promise<boolean>
    remove: (kind: ProgressKind, id: string) => Promise<boolean>
    batchGenerate: (
      kind: ProgressKind,
      parentId: string,
      startNo: number,
      count: number
    ) => Promise<number>
    newId: () => Promise<string>
    pickImages: (kind: ProgressKind, parentId: string) => Promise<string[]>
  }
  completion: {
    list: (gameId: string) => Promise<GameCompletion[]>
    add: (c: GameCompletion) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
  }
  person: {
    list: (
      keyword?: string,
      includeDeleted?: boolean,
      sort?: 'updated' | 'created' | 'name' | 'birth'
    ) => Promise<Person[]>
    get: (id: string) => Promise<Person | null>
    names: () => Promise<string[]>
    create: (input: PersonInput) => Promise<Person>
    update: (input: PersonInput) => Promise<Person>
    softDelete: (id: string) => Promise<boolean>
    restore: (id: string) => Promise<boolean>
    purge: (id: string) => Promise<boolean>
    newId: () => Promise<string>
    pickPhoto: (personId: string) => Promise<string | null>
    tmdbCastPreview: (
      tmdbId: number,
      mediaType: 'movie' | 'tv'
    ) => Promise<TmdbCastEntry[]>
    importTmdbCast: (
      movieId: string,
      entries: TmdbCastEntry[],
      picks: Record<string, string>
    ) => Promise<{ created: number; linked: number; skipped: number }>
    tmdbSearchPeople: (query: string) => Promise<TmdbPersonSearchItem[]>
    tmdbFetchPerson: (tmdbId: number, localPersonId: string) => Promise<TmdbPersonInfo>
  }
  personLink: {
    byWork: (kind: MediaKind, workId: string) => Promise<PersonLinkWithPerson[]>
    works: (personId: string) => Promise<PersonWork[]>
    replace: (kind: MediaKind, workId: string, links: PersonLink[]) => Promise<boolean>
  }
  character: {
    list: (kind: CharacterKind, parentId: string) => Promise<Character[]>
    save: (kind: CharacterKind, input: CharacterInput, isNew: boolean) => Promise<boolean>
    remove: (kind: CharacterKind, id: string) => Promise<boolean>
    newId: () => Promise<string>
    pickImage: (characterId: string) => Promise<string | null>
    importTmdb: (
      movieId: string,
      tmdbId: number,
      mediaType: 'movie' | 'tv'
    ) => Promise<{ created: number; skipped: number }>
  }
  playlist: {
    list: (includeDeleted?: boolean) => Promise<Playlist[]>
    get: (id: string) => Promise<Playlist | null>
    create: (input: PlaylistInput) => Promise<Playlist>
    update: (input: PlaylistInput) => Promise<Playlist>
    softDelete: (id: string) => Promise<boolean>
    restore: (id: string) => Promise<boolean>
    purge: (id: string) => Promise<boolean>
    newId: () => Promise<string>
    items: (id: string) => Promise<PlaylistItemView[]>
    addItem: (playlistId: string, itemId: string) => Promise<boolean>
    removeItem: (playlistId: string, itemRowId: string) => Promise<boolean>
  }
  note: {
    list: (q?: {
      keyword?: string
      tag?: string
      sortMode?: number
      includeDeleted?: boolean
      limit?: number
      offset?: number
    }) => Promise<Note[]>
    get: (id: string) => Promise<Note | null>
    tags: () => Promise<string[]>
    create: (input: NoteInput) => Promise<Note>
    update: (input: NoteInput) => Promise<Note>
    softDelete: (id: string) => Promise<boolean>
    restore: (id: string) => Promise<boolean>
    purge: (id: string) => Promise<boolean>
    togglePin: (id: string, pinned: boolean) => Promise<boolean>
    newId: () => Promise<string>
    pickImages: (noteId: string) => Promise<string[]>
  }
  customModule: {
    list: (includeDeleted?: boolean) => Promise<CustomModule[]>
    get: (id: string) => Promise<CustomModule | null>
    create: (input: CustomModuleInput) => Promise<CustomModule>
    update: (input: CustomModuleInput) => Promise<CustomModule>
    setEnabled: (id: string, enabled: boolean) => Promise<boolean>
    softDelete: (id: string) => Promise<boolean>
    newId: () => Promise<string>
    nextSort: () => Promise<number>
  }
  customDesign: {
    list: (moduleId: string) => Promise<CustomModuleDesign[]>
    get: (id: string) => Promise<CustomModuleDesign | null>
    active: (moduleId: string) => Promise<CustomModuleDesign | null>
    save: (input: CustomModuleDesignInput, isNew: boolean) => Promise<CustomModuleDesign>
    setActive: (moduleId: string, designId: string) => Promise<boolean>
    softDelete: (moduleId: string, designId: string) => Promise<boolean>
    newId: () => Promise<string>
  }
  customItem: {
    list: (moduleId: string) => Promise<CustomModuleItem[]>
    deleted: () => Promise<CustomModuleItem[]>
    get: (id: string) => Promise<CustomModuleItem | null>
    count: (moduleId: string) => Promise<number>
    search: (moduleId: string, keyword: string) => Promise<CustomModuleItem[]>
    create: (input: CustomModuleItemInput) => Promise<CustomModuleItem>
    update: (input: CustomModuleItemInput) => Promise<CustomModuleItem>
    softDelete: (id: string) => Promise<boolean>
    restore: (id: string) => Promise<boolean>
    purge: (id: string) => Promise<boolean>
    newId: () => Promise<string>
    pickPoster: (moduleId: string, itemId: string) => Promise<string | null>
    pickImages: (moduleId: string, itemId: string) => Promise<string[]>
  }
  stats: {
    overview: () => Promise<StatsOverview>
    calendar: (mode: 0 | 1) => Promise<CalendarEntry[]>
    gallery: () => Promise<GalleryImage[]>
    home: () => Promise<HomeStats>
    dayItems: (
      day: string
    ) => Promise<{ kind: string; id: string; title: string; cover: string | null }[]>
  }
  excel: {
    export: (kind: 'movie' | 'book' | 'game') => Promise<string | null>
  }
  shell: {
    openPath: (p: string) => Promise<boolean>
  }
  image: {
    saveAs: (src: string, suggestedName?: string) => Promise<boolean>
  }
  profile: {
    pickAvatar: () => Promise<string | null>
  }
  search: {
    tmdbTest: (token: string, authType: string, proxy: string) => Promise<string>
    bgmTest: (token: string, proxy: string) => Promise<boolean>
    tmdbSearch: (
      query: string,
      page: number
    ) => Promise<{ results: TmdbSearchItem[]; page: number; totalPages: number }>
    tmdbDetail: (id: number, mediaType: 'movie' | 'tv') => Promise<TmdbDetail>
    bgmSearch: (
      query: string,
      offset: number
    ) => Promise<{ results: BgmSearchItem[]; total: number }>
    bgmDetail: (id: number) => Promise<BgmDetail>
    downloadImage: (
      url: string,
      source: 'tmdb' | 'bgm' | 'vip',
      category: 'movies' | 'books' | 'games',
      entityId: string
    ) => Promise<string | null>
    vipTokenCheck: (
      token: string,
      type: 'movie' | 'book'
    ) => Promise<{ valid: boolean; message: string }>
    vipSearch: (
      kind: 'movie' | 'book',
      query: string,
      page: number
    ) => Promise<{
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
    }>
    tokenDoc: () => Promise<string>
  }
  backup: {
    export: () => Promise<{ path: string; imageCount: number } | null>
    import: () => Promise<RestoreOutcome | null>
  }
  webdav: {
    getConfig: () => Promise<WebDavConfig | null>
    saveConfig: (cfg: WebDavConfig) => Promise<boolean>
    clearConfig: () => Promise<boolean>
    test: (cfg: WebDavConfig) => Promise<{ success: boolean; message: string }>
    upload: () => Promise<SyncOutcome>
    download: () => Promise<SyncOutcome>
    onDownloadProgress: (
      cb: (p: { received: number; total: number; percent: number }) => void
    ) => () => void
    onUploadProgress: (
      cb: (p: { received: number; total: number; percent: number; stage: string }) => void
    ) => () => void
    lastSync: () => Promise<string>
  }
  incSync: {
    upload: () => Promise<IncSyncResult>
    download: () => Promise<IncSyncResult>
    restore: () => Promise<IncSyncResult>
    forcePush: () => Promise<IncSyncResult>
    info: (fetchRemoteVersion?: boolean) => Promise<{ lastSync: string; manifestVersion: number | null }>
    onProgress: (cb: (p: IncSyncProgress) => void) => () => void
  }
  tag: {
    list: (type?: TagType) => Promise<Tag[]>
    add: (type: TagType, name: string) => Promise<Tag>
    rename: (id: string, name: string) => Promise<boolean>
    toggleHidden: (id: string) => Promise<boolean>
    move: (id: string, parentId: string, beforeId: string | null) => Promise<boolean>
    remove: (id: string, mode: TagDeleteMode, replacementName?: string) => Promise<boolean>
    sync: () => Promise<number>
    usage: (type: TagType) => Promise<Record<string, number>>
  }
  float: {
    dragStart: () => void
    dragMove: () => void
    dragEnd: () => void
    toggleMenu: () => Promise<void>
    toggleMain: () => Promise<{ ok: boolean }>
    setMode: (mode: 'menu' | 'result' | 'color') => Promise<void>
    hide: () => void
    getEnabled: () => Promise<boolean>
    setEnabled: (enabled: boolean) => Promise<{ ok: boolean }>
    onBusy: (cb: (busy: boolean) => void) => () => void
    onMode: (cb: (mode: 'menu' | 'result' | 'color') => void) => () => void
    onHidden: (cb: () => void) => () => void
    presented: (menuHeight?: number) => void
  }
  ocr: {
    capture: () => Promise<OcrLine[] | null>
    cloudConfig: () => Promise<{
      configured: boolean
      model: string
      provider: 'xf' | 'baidu' | 'local'
    }>
    cloudTest: () => Promise<{ ok: boolean; message: string }>
    enginesScan: (force?: boolean) => Promise<EngineScanResult>
    engineOpenDir: () => Promise<{ ok: boolean; error: string }>
    overlayInit: (
      displayId: string
    ) => Promise<{
      dataUrl: string
      scaleFactor: number
      pixels: { width: number; height: number } | null
    } | null>
    overlayRecognize: (png: ArrayBuffer) => Promise<{ ok: boolean }>
    overlayCancel: () => Promise<{ ok: boolean }>
    copyText: (text: string) => Promise<{ ok: boolean }>
  }
  shot: {
    capture: () => Promise<{ canceled: boolean; lines: OcrLine[] | null }>
    overlayInit: (
      displayId: string
    ) => Promise<{
      dataUrl: string
      scaleFactor: number
      pixels: { width: number; height: number } | null
    } | null>
    overlayOcr: (png: ArrayBuffer) => Promise<{ ok: boolean }>
    overlayCancel: () => Promise<{ ok: boolean }>
    overlaySave: (png: ArrayBuffer) => Promise<{ ok: boolean; canceled?: boolean }>
    overlayPin: (payload: {
      dataUrl: string
      width: number
      height: number
      x?: number
      y?: number
    }) => Promise<{ ok: boolean }>
    pinInit: (id: string) => Promise<string | null>
    pinClose: () => void
    pinZoom: (factor: number) => void
    pinDragStart: () => void
    pinDragMove: () => void
  }
  color: {
    capture: () => Promise<{ canceled: boolean; color: PickedColor | null }>
    overlayInit: (
      displayId: string
    ) => Promise<{ dataUrl: string; pixels: { width: number; height: number } | null } | null>
    overlayPick: (color: PickedColor) => Promise<{ ok: boolean }>
    overlayCancel: () => Promise<{ ok: boolean }>
  }
  util: {
    uuid: () => string
  }
  maintenance: {
    clearCache: () => Promise<{ bytes: number; orphanImages: number; emptyDirs: number }>
    cleanEmptyDirs: () => Promise<{ removed: number }>
    purgeDeleted: () => Promise<{ rows: number; tables: number }>
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    onMaximizedChange: (cb: (maximized: boolean) => void) => void
    onCloseQuery: (cb: () => void) => void
    closeDecision: (quit: boolean, remember: boolean) => void
    closeCancel: () => void
    toggleDevTools: () => void
    setIcon: (src: string | null) => Promise<boolean>
    shellInfo: () => Promise<{
      material: 'mica' | 'solid'
      accent: string
      dark: boolean
    }>
  }
}

declare global {
  interface Window {
    mook: MookApi
  }
}
