// 增量同步实体规格（与 Flutter inc_entities.dart 一致）：
// 表名、LWW 时间戳列、图片列、随父实体整组同步的子表。

export interface IncEntitySpec {
  /** 表名 */
  table: string
  /** LWW / 变更检测时间戳列 */
  tsColumn: string
  /** 单值图片列 */
  imageColumns: string[]
  /** JSON 数组图片列（如 notes.images） */
  imageJsonColumn: string | null
  /** JSON 对象图片列（custom_module_items.data_json） */
  imageJsonMapColumn: string | null
  /** 随本行整组打包的子表：组名（子表名）→ 子表名 */
  groups: Record<string, string>
}

/** 仅作为父实体子组存在的表（自身不做行级 LWW） */
export interface IncGroupSpec {
  table: string
  parentTable: string
  parentColumn: string
  /** 检测「父行未改但子组新增」的时间戳列（可能为 null） */
  tsColumn: string | null
  /** JSON 数组图片列（分集/章节/关卡 images） */
  imageJsonColumn: string | null
}

function entity(s: Partial<IncEntitySpec> & { table: string; tsColumn: string }): IncEntitySpec {
  return {
    imageColumns: [],
    imageJsonColumn: null,
    imageJsonMapColumn: null,
    groups: {},
    ...s
  }
}

/** 行级同步实体（按时间戳 LWW），顺序即基线写入/应用顺序 */
export const ENTITIES: IncEntitySpec[] = [
  entity({
    table: 'movies',
    tsColumn: 'updated_at',
    imageColumns: ['poster_path'],
    groups: {
      movie_people: 'movie_people',
      movie_posters: 'movie_posters',
      movie_episodes: 'movie_episodes'
    }
  }),
  entity({
    table: 'books',
    tsColumn: 'updated_at',
    imageColumns: ['cover_path'],
    groups: { book_people: 'book_people', book_chapters: 'book_chapters' }
  }),
  entity({ table: 'notes', tsColumn: 'updated_at', imageJsonColumn: 'images' }),
  entity({
    table: 'games',
    tsColumn: 'updated_at',
    imageColumns: ['cover_path'],
    groups: {
      game_people: 'game_people',
      game_screenshots: 'game_screenshots',
      game_completions: 'game_completions',
      game_levels: 'game_levels'
    }
  }),
  entity({ table: 'movie_reviews', tsColumn: 'updated_at', imageJsonColumn: 'images' }),
  entity({ table: 'book_reviews', tsColumn: 'updated_at', imageJsonColumn: 'images' }),
  entity({ table: 'game_reviews', tsColumn: 'updated_at', imageJsonColumn: 'images' }),
  entity({ table: 'book_excerpts', tsColumn: 'updated_at' }),
  entity({ table: 'people', tsColumn: 'updated_at', imageColumns: ['photo_path'] }),
  entity({
    table: 'playlists',
    tsColumn: 'updated_at',
    imageColumns: ['cover_path'],
    groups: { playlist_items: 'playlist_items' }
  }),
  entity({ table: 'movie_characters', tsColumn: 'updated_at', imageColumns: ['image_path'] }),
  entity({ table: 'book_characters', tsColumn: 'updated_at', imageColumns: ['image_path'] }),
  entity({ table: 'game_characters', tsColumn: 'updated_at', imageColumns: ['image_path'] }),
  // 标签为追加式（无 updated_at），按 created_at 检测
  entity({ table: 'tags', tsColumn: 'created_at' }),
  // 图库自定义重命名（path 为逻辑路径，无需图片列处理）
  entity({ table: 'image_assets', tsColumn: 'updated_at' }),
  // 自定义分类模块三表；条目的海报路径在 data_json 对象值里
  entity({ table: 'custom_modules', tsColumn: 'updated_at' }),
  entity({ table: 'custom_module_designs', tsColumn: 'updated_at' }),
  entity({
    table: 'custom_module_items',
    tsColumn: 'updated_at',
    imageColumns: ['cover_path'],
    imageJsonMapColumn: 'data_json'
  })
]

/** 子组表规格 */
export const GROUPS: IncGroupSpec[] = [
  { table: 'movie_people', parentTable: 'movies', parentColumn: 'movie_id', tsColumn: null, imageJsonColumn: null },
  { table: 'movie_posters', parentTable: 'movies', parentColumn: 'movie_id', tsColumn: 'created_at', imageJsonColumn: null },
  { table: 'book_people', parentTable: 'books', parentColumn: 'book_id', tsColumn: null, imageJsonColumn: null },
  { table: 'game_people', parentTable: 'games', parentColumn: 'game_id', tsColumn: null, imageJsonColumn: null },
  { table: 'game_screenshots', parentTable: 'games', parentColumn: 'game_id', tsColumn: 'created_at', imageJsonColumn: null },
  { table: 'game_completions', parentTable: 'games', parentColumn: 'game_id', tsColumn: 'updated_at', imageJsonColumn: null },
  { table: 'movie_episodes', parentTable: 'movies', parentColumn: 'movie_id', tsColumn: 'updated_at', imageJsonColumn: 'images' },
  { table: 'book_chapters', parentTable: 'books', parentColumn: 'book_id', tsColumn: 'updated_at', imageJsonColumn: 'images' },
  { table: 'game_levels', parentTable: 'games', parentColumn: 'game_id', tsColumn: 'updated_at', imageJsonColumn: 'images' },
  { table: 'playlist_items', parentTable: 'playlists', parentColumn: 'playlist_id', tsColumn: 'added_at', imageJsonColumn: null }
]

export function specOf(table: string): IncEntitySpec | undefined {
  return ENTITIES.find((s) => s.table === table)
}

export function groupSpecOf(table: string): IncGroupSpec | undefined {
  return GROUPS.find((s) => s.table === table)
}

/** 子表单值图片列（非 JSON） */
export function groupImageColumn(groupTable: string): string | null {
  if (groupTable === 'movie_posters') return 'poster_path'
  if (groupTable === 'game_screenshots') return 'screenshot_path'
  return null
}

/** 历史上残留 is_deleted=1 行的子表：基线/推送需排除 */
const SOFT_DELETE_GROUPS = new Set([
  'movie_episodes',
  'book_chapters',
  'game_levels',
  'movie_posters',
  'game_screenshots'
])

export function softDeleteGroupWhere(table: string): string | null {
  return SOFT_DELETE_GROUPS.has(table) ? 'is_deleted = 0' : null
}
