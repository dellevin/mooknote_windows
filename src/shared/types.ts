// 与 Flutter data_models.dart 对齐的领域模型（camelCase），DAO 负责与 snake_case 行互转。

export type MovieStatus = 'want_to_watch' | 'watching' | 'watched' | 'abandoned'

export interface Movie {
  id: string
  title: string
  posterPath: string | null
  releaseDate: string | null // ISO UTC
  directors: string[]
  writers: string[]
  actors: string[]
  genres: string[]
  alternateTitles: string[]
  summary: string | null
  rating: number | null
  status: MovieStatus
  category: string
  watchDate: string | null
  watchCount: number
  duration: number // 分钟
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  coverOffset: number
}

// 新建/编辑表单提交的负载（时间戳由主进程补）
export type MovieInput = Omit<
  Movie,
  'createdAt' | 'updatedAt' | 'isDeleted'
>

export const MOVIE_STATUS_LABELS: Record<MovieStatus, string> = {
  want_to_watch: '想看',
  watching: '在看',
  watched: '已看',
  abandoned: '弃看'
}

export const MOVIE_CATEGORY_LABELS: Record<string, string> = {
  movie: '电影',
  tv: '剧集',
  anime: '动画',
  variety: '综艺',
  documentary: '纪录片',
  short: '短片',
  other: '其他'
}

export const MOVIE_SORT_LABELS: Record<number, string> = {
  0: '最近更新',
  1: '最近添加',
  2: '评分最高',
  3: '观看日期',
  4: '上映日期'
}

// ========== 书籍 ==========
export type BookStatus = 'want_to_read' | 'reading' | 'read' | 'abandoned'

export interface Book {
  id: string
  title: string
  coverPath: string | null
  authors: string[]
  translators: string[]
  alternateTitles: string[]
  publisher: string | null
  genres: string[]
  summary: string | null
  rating: number | null
  status: BookStatus
  category: string
  isbn: string | null
  publishDate: string | null
  startDate: string | null
  finishDate: string | null
  readCount: number
  readDuration: number // 阅读总时长（分钟）
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  coverOffset: number
}

export type BookInput = Omit<Book, 'createdAt' | 'updatedAt' | 'isDeleted'>

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  want_to_read: '想读',
  reading: '在读',
  read: '读过',
  abandoned: '弃读'
}

export const BOOK_CATEGORY_LABELS: Record<string, string> = {
  book: '图书',
  novel: '小说',
  comic: '漫画',
  newspaper: '报纸杂志',
  paper: '论文'
}

export const BOOK_SORT_LABELS: Record<number, string> = {
  0: '最近更新',
  1: '最近添加',
  2: '评分最高',
  3: '读完日期',
  4: '出版日期'
}

// ========== 游戏 ==========
export type GameStatus = 'want_to_play' | 'playing' | 'completed' | 'abandoned'

export interface Game {
  id: string
  title: string
  coverPath: string | null
  rating: number | null
  status: GameStatus
  category: string
  platforms: string[]
  versions: string[]
  genres: string[]
  playTimeHours: number
  playTimeMinutes: number
  playCount: number
  developer: string[]
  releaseDate: string | null
  purchasePlatforms: string[]
  purchaseDate: string | null
  purchasePrice: string | null
  summary: string | null
  coverOffset: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export type GameInput = Omit<Game, 'createdAt' | 'updatedAt' | 'isDeleted'>

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  want_to_play: '想玩',
  playing: '在玩',
  completed: '已通关',
  abandoned: '弃玩'
}

export const GAME_CATEGORY_LABELS: Record<string, string> = {
  digital: '数字版',
  cartridge: '卡带',
  disc: '光盘'
}

export const GAME_SORT_LABELS: Record<number, string> = {
  0: '最近更新',
  1: '最近添加',
  2: '评分最高',
  3: '发售日期'
}

// ========== 评价（影视/书/游戏三表同构） ==========
export type ReviewKind = 'movie' | 'book' | 'game'
export type ReviewType = 1 | 2 // 1 短评，2 长评

export interface Review {
  id: string
  parentId: string
  content: string
  reviewer: string | null
  source: string | null
  reviewType: ReviewType
  reviewDate: string | null
  images: string[]
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export type ReviewInput = Omit<Review, 'createdAt' | 'updatedAt' | 'isDeleted'>

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  1: '短评',
  2: '长评'
}

// ========== 子图片集：海报墙 / 截图 ==========
export interface MediaImage {
  id: string
  parentId: string
  imagePath: string
  createdAt: string
}

// ========== 书籍摘抄 ==========
export interface BookExcerpt {
  id: string
  bookId: string
  chapter: string | null
  content: string
  comment: string | null
  createdAt: string
  updatedAt: string
}

// ========== 进度记录：分集 / 章节 / 关卡 ==========
export interface ProgressEntry {
  id: string
  parentId: string
  no: number
  title: string
  done: boolean // watched/read/cleared
  date: string | null
  rating: number | null
  review: string
  images: string[]
  duration?: number // 仅分集：本集时长（分钟）
  createdAt: string
  updatedAt: string
}

export type ProgressKind = 'episode' | 'chapter' | 'level'

// ========== 游戏通关记录 ==========
export interface GameCompletion {
  id: string
  gameId: string
  completionDate: string
  note: string
  createdAt: string
  updatedAt: string
}

// ========== 人物 ==========
export type MediaKind = 'movie' | 'book' | 'game'

export interface Person {
  id: string
  name: string
  gender: string | null // male / female / other
  birthDate: string | null
  birthPlace: string | null
  alternateNames: string[]
  occupation: string[]
  summary: string | null
  photoPath: string | null
  coverOffset: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export type PersonInput = Omit<Person, 'createdAt' | 'updatedAt' | 'isDeleted'>

// 作品 ↔ 人物关联（role_type: movie=director/writer/actor, book=author/translator, game=developer）
export interface PersonLink {
  id: string
  workId: string
  personId: string
  roleType: string
  characterName: string | null
  sortOrder: number
}

// 详情页用：关联 + 人物快照
export interface PersonLinkWithPerson extends PersonLink {
  name: string
  photoPath: string | null
  occupation: string[]
}

// 人物详情页用：作品信息
export interface PersonWork {
  kind: MediaKind
  linkId: string
  workId: string
  roleType: string
  characterName: string | null
  sortOrder: number
  title: string
  coverPath: string | null
  status: string
  rating: number | null
  isDeleted: boolean
}

// ========== 角色 ==========
export interface Character {
  id: string
  parentId: string
  name: string
  role: string | null
  aliases: string[]
  tags: string[]
  description: string | null
  imagePath: string | null
  sortOrder: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export type CharacterInput = Omit<Character, 'createdAt' | 'updatedAt' | 'isDeleted'>
export type CharacterKind = MediaKind

// ========== 片单 ==========
export type PlaylistType = 'movie' | 'book' | 'game'

export interface Playlist {
  id: string
  name: string
  description: string
  type: PlaylistType
  coverPath: string | null
  itemCount: number
  sortOrder: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export type PlaylistInput = Omit<
  Playlist,
  'itemCount' | 'sortOrder' | 'isDeleted' | 'createdAt' | 'updatedAt'
>

// 片单详情用：条目 + 媒体快照
export interface PlaylistItemView {
  id: string
  itemId: string
  sortOrder: number
  addedAt: string
  title: string
  coverPath: string | null
  status: string
  rating: number | null
  isDeleted: boolean
}

export const PLAYLIST_TYPE_LABELS: Record<PlaylistType, string> = {
  movie: '影视',
  book: '书籍',
  game: '游戏'
}

// ========== 笔记 ==========
export interface Note {
  id: string
  title: string
  content: string
  contentType: string // markdown
  tags: string[]
  images: string[]
  isPinned: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export type NoteInput = Omit<Note, 'createdAt' | 'updatedAt' | 'isDeleted'>

// ========== 标签管理 ==========
// 标签按媒介类型分四类，与 Flutter 端一致；条目 JSON 里只存名称字符串，不存 id
export type TagType = 'movie_genre' | 'book_genre' | 'game_genre' | 'note_tag'

export const TAG_TYPE_LABELS: Record<TagType, string> = {
  movie_genre: '影视',
  book_genre: '书籍',
  game_genre: '游戏',
  note_tag: '笔记'
}

export interface Tag {
  id: string
  name: string
  type: TagType
  isHidden: boolean
  parentId: string
  sortOrder: number
  createdAt: string
}

// 删除模式：仅删标签（条目保留名称）/ 从所有条目移除 / 合并到另一个标签
export type TagDeleteMode = 'detach' | 'purge' | 'merge'

export const NOTE_SORT_LABELS: Record<number, string> = {
  0: '最近更新',
  1: '最近创建',
  2: '标题排序'
}

export const PERSON_ROLE_LABELS: Record<MediaKind, Record<string, string>> = {
  movie: { director: '导演', writer: '编剧', actor: '演员' },
  book: { author: '作者', translator: '译者' },
  game: { developer: '开发者' }
}


// ========== 自定义模块 ==========
// 字段类型，名称与 Flutter CustomFieldType 枚举一致（存于 fields_json）
export type CustomFieldType =
  | 'poster' // 海报图
  | 'status' // 状态（自定义选项）
  | 'rating' // 评分
  | 'count' // 次数
  | 'text' // 单文本
  | 'multiText' // 多文本列表
  | 'date' // 日期
  | 'longText' // 长文本
  | 'duration' // 时长（总分钟数）
  | 'progress' // 进度 {current,total}
  | 'dateRange' // 日期区间 {start,end}
  | 'multiImage' // 多图

export interface CustomFieldDef {
  key: string
  type: CustomFieldType
  label: string
  required: boolean
  options: string[] // 仅 status
  isTitle: boolean // 仅 text，至多一个
  halfWidth: boolean
  halfOnLeft: boolean
  icon: string
}

export interface CustomModule {
  id: string
  name: string
  icon: string
  sortOrder: number
  activeDesignId: string | null
  isEnabled: boolean
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface CustomModuleInput {
  id: string
  name: string
  icon: string
  sortOrder: number
  activeDesignId?: string | null
  isEnabled: boolean
}

export interface CustomModuleDesign {
  id: string
  moduleId: string
  name: string
  fields: CustomFieldDef[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface CustomModuleDesignInput {
  id: string
  moduleId: string
  name: string
  fields: CustomFieldDef[]
}

// data_json: { [fieldKey]: value }，值类型随字段：
// poster=string  status=string  rating=number  count=number
// text/longText=string  multiText=string[]  date=ISO string
// duration=number(分钟)  progress={current,total}
// dateRange={start,end}  multiImage=string[]
export type CustomFieldValue =
  | string
  | number
  | string[]
  | { current: number; total: number }
  | { start: string | null; end: string | null }
  | null

export interface CustomModuleItem {
  id: string
  moduleId: string
  title: string
  coverPath: string | null
  rating: number | null
  status: string | null
  data: Record<string, CustomFieldValue>
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface CustomModuleItemInput {
  id: string
  moduleId: string
  title: string
  coverPath: string | null
  rating: number | null
  status: string | null
  data: Record<string, CustomFieldValue>
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  poster: '封面图',
  status: '状态',
  rating: '评分',
  count: '次数',
  text: '单行文本',
  multiText: '多行标签',
  date: '日期',
  longText: '长文本',
  duration: '时长',
  progress: '进度',
  dateRange: '日期区间',
  multiImage: '多图'
}

// ========== 统计 / 日历 / 图库（阶段5） ==========
export interface StatusCount {
  status: string
  count: number
}

export interface KindOverview {
  total: number
  byStatus: StatusCount[]
  rated: number
  avgRating: number | null
}

export interface StatsOverview {
  movies: KindOverview
  books: KindOverview
  games: KindOverview
  notes: number
  people: number
  playlists: number
  customModules: number
  customItems: number
  reviews: number
  imageCount: number
}

export type CalendarKind = 'movie' | 'book' | 'game'

export interface CalendarEntry {
  kind: CalendarKind
  id: string
  title: string
  date: string // yyyy-mm-dd
  coverPath: string | null
  status: string
  rating: number | null
  note?: string
}

export interface HeatDay {
  date: string // yyyy-mm-dd
  count: number
}

export interface HomeStats {
  days: HeatDay[]
  activeDays: number
  totalCount: number
}

export interface GalleryImage {
  path: string
  category: string
  entityType: string
  entityId: string
  entityTitle: string
  createdAt: string
}

// ========== 在线搜索（阶段6） ==========
export interface TmdbSearchItem {
  id: number
  mediaType: 'movie' | 'tv'
  title: string
  originalTitle: string
  date: string | null
  overview: string
  posterUrl: string | null // 远程完整 URL
  rating: number | null
}

// 演职人员（credits）
export interface TmdbCastPerson {
  tmdbId: number
  name: string
  character: string | null // 仅演员：饰演角色名
  job: string | null // 仅主创：Director / Screenplay / Writer
  profileUrl: string | null // 头像完整 URL
  order: number
}
export interface TmdbCredits {
  cast: TmdbCastPerson[]
  crew: TmdbCastPerson[]
}

// credits 聚合后的单个演职人员（同一人多身份合并），用于导入前预览
export interface TmdbCastEntry {
  tmdbId: number
  name: string
  profileUrl: string | null
  parts: { role: 'director' | 'writer' | 'actor'; character: string | null }[]
  order: number
}

export interface TmdbPersonSearchItem {
  id: number
  name: string
  profileUrl: string | null
  knownFor: string
}

export interface TmdbPersonInfo {
  name: string
  gender: string | null // male / female / other
  birthDate: string | null
  birthPlace: string | null
  alternateNames: string[]
  occupation: string[]
  summary: string | null
  photoPath: string | null // 已下载到本地的头像路径
}

export interface TmdbDetail extends TmdbSearchItem {
  genres: string[]
  directors: string[]
  actors: string[]
  runtime: number
  tagline: string
  status: string
}

export interface BgmSearchItem {
  id: number
  type: number // 1 书籍 2 动画 4 游戏 6 三次元
  title: string
  name: string
  date: string | null
  image: string | null
  rating: number | null
  summary: string
  tags: string[]
}

export interface BgmInfoboxItem {
  key: string
  value: string // 已拍平为单行
}

export interface BgmDetail extends BgmSearchItem {
  infobox: BgmInfoboxItem[]
  totalEps: number
}

// ========== 备份 / WebDAV ==========
export interface WebDavConfig {
  url: string
  username: string
  password: string
  path: string
}

export interface RestoreOutcome {
  success: boolean
  error?: string
  stats?: Record<string, number>
  imageCount: number
  imageFailures: number
  needReload?: boolean
}

export interface SyncOutcome {
  success: boolean
  message: string
  imageCount?: number
  needReload?: boolean
  stats?: Record<string, number>
  imageFailures?: number
}

// ========== 增量同步（inc2） ==========
export interface IncSyncProgress {
  stage: string
  message: string
  upRecords: number
  downRecords: number
  upImages: number
  downImages: number
  dedupImages: number
}

export interface IncSyncResult {
  success: boolean
  message: string
  uploadedRecords: number
  downloadedRecords: number
  uploadedImages: number
  downloadedImages: number
  dedupImages: number
  needReload: boolean
}

// OCR 识别结果行
export interface OcrLine {
  text: string
  confidence: number
}

// 屏幕取色结果
export interface PickedColor {
  r: number
  g: number
  b: number
  hex: string
}

// 云端 OCR 识别结果行
export type CloudOcrLine = OcrLine

// ========== 本地 OCR 引擎（RapidOCR-json / PaddleOCR-json） ==========
export type LocalOcrEngineId = 'rapid' | 'paddle'
export type LocalEngineStatusKind = 'ready' | 'incomplete' | 'missing'

export interface LocalLanguage {
  key: string
  label: string
  payload: string
}

export interface DiscoveredEngine {
  id: LocalOcrEngineId
  label: string
  status: LocalEngineStatusKind
  exePath: string
  dir: string
  languages: LocalLanguage[]
  message: string
}

export interface EngineScanResult {
  roots: string[]
  engines: Record<LocalOcrEngineId, DiscoveredEngine>
}

// ---- 电子书阅读器（独立 reader.db） ----
export interface ReaderBook {
  id: string
  title: string
  author: string | null
  format: string
  fileName: string
  originalName: string | null
  coverPath: string | null
  coverCustom: boolean
  importedAt: number
  lastReadAt: number | null
  percentage: number
  chapterTitle: string | null
  categoryIds: string[]
}

export interface ReaderCategory {
  id: string
  name: string
  sortOrder: number
  createdAt: number
  count: number
  hidden: boolean
}

export interface ReaderBookInput {
  filePath: string
}

export interface ReaderImportResult {
  ok: boolean
  book?: ReaderBook
  error?: string
}

export interface ReaderAnnotation {
  id: string
  bookId: string
  type: string
  value: string
  color: string | null
  note: string | null
  chapter: string | null
  createdAt: number
}
