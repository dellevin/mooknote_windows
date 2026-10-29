// MookNote 数据库 schema —— 与 Flutter 版 database_helper.dart v53 的最终表结构一致。
// 仅在全新库上 CREATE TABLE IF NOT EXISTS；若用户放入 Android 的 mooknote.db，表已存在，不改动。
// 列名一律 snake_case，List 字段存 JSON TEXT，bool 存 INTEGER 0/1，时间为 UTC ISO8601 字符串。

export const SCHEMA_VERSION = 53

export const SCHEMA_STATEMENTS: string[] = [
  // ---------- 影视 ----------
  `CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    poster_path TEXT,
    release_date TEXT,
    directors TEXT,
    writers TEXT,
    actors TEXT,
    genres TEXT,
    alternate_titles TEXT,
    summary TEXT,
    rating REAL,
    status TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'movie',
    watch_date TEXT,
    watch_count INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    cover_offset REAL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS movie_reviews (
    id TEXT PRIMARY KEY,
    movie_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reviewer TEXT,
    source TEXT,
    review_type INTEGER DEFAULT 1,
    review_date TEXT,
    images TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (movie_id) REFERENCES movies (id)
  )`,
  `CREATE TABLE IF NOT EXISTS movie_posters (
    id TEXT PRIMARY KEY,
    movie_id TEXT NOT NULL,
    poster_path TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (movie_id) REFERENCES movies (id)
  )`,
  `CREATE TABLE IF NOT EXISTS movie_episodes (
    id TEXT PRIMARY KEY,
    movie_id TEXT NOT NULL,
    episode_no INTEGER NOT NULL DEFAULT 0,
    title TEXT DEFAULT '',
    watched INTEGER DEFAULT 0,
    watch_date TEXT,
    rating REAL,
    review TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_movie_episodes_movie ON movie_episodes(movie_id)`,

  // ---------- 书籍 ----------
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cover_path TEXT,
    authors TEXT,
    translators TEXT,
    alternate_titles TEXT,
    publisher TEXT,
    genres TEXT,
    summary TEXT,
    rating REAL,
    status TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'book',
    isbn TEXT,
    publish_date TEXT,
    start_date TEXT,
    finish_date TEXT,
    read_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    cover_offset REAL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS book_reviews (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reviewer TEXT,
    source TEXT,
    review_type INTEGER DEFAULT 1,
    review_date TEXT,
    images TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books (id)
  )`,
  `CREATE TABLE IF NOT EXISTS book_excerpts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter TEXT,
    content TEXT NOT NULL,
    comment TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books (id)
  )`,
  `CREATE TABLE IF NOT EXISTS book_chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_no INTEGER NOT NULL DEFAULT 0,
    title TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    read_date TEXT,
    rating REAL,
    review TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_book_chapters_book ON book_chapters(book_id)`,

  // EPUB 阅读器
  `CREATE TABLE IF NOT EXISTS reader_books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT DEFAULT '',
    cover_path TEXT,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_extension TEXT NOT NULL DEFAULT 'epub',
    last_read_cfi TEXT DEFAULT '',
    reading_percentage REAL DEFAULT 0.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    book_id TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    publisher TEXT DEFAULT '',
    isbn TEXT DEFAULT '',
    authors TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS book_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    cfi TEXT NOT NULL DEFAULT '',
    chapter TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'highlight',
    color TEXT NOT NULL DEFAULT 'FFEB3B',
    reader_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_book_annotations_book_id ON book_annotations(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_book_annotations_type ON book_annotations(book_id, type)`,

  // ---------- 笔记 ----------
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    content TEXT NOT NULL,
    content_type TEXT DEFAULT 'markdown',
    tags TEXT,
    images TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0
  )`,

  // ---------- 游戏 ----------
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cover_path TEXT,
    rating REAL,
    status TEXT NOT NULL DEFAULT 'want_to_play',
    category TEXT NOT NULL DEFAULT 'digital',
    platforms TEXT DEFAULT '[]',
    versions TEXT DEFAULT '[]',
    genres TEXT DEFAULT '[]',
    play_time_hours INTEGER DEFAULT 0,
    play_time_minutes INTEGER DEFAULT 0,
    purchase_platforms TEXT DEFAULT '[]',
    purchase_date TEXT,
    purchase_price TEXT,
    summary TEXT,
    cover_offset REAL DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    developer TEXT DEFAULT '[]',
    release_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS game_reviews (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reviewer TEXT,
    source TEXT,
    review_type INTEGER DEFAULT 1,
    review_date TEXT,
    images TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games (id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_screenshots (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    screenshot_path TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games (id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_completions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    completion_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games (id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_levels (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    level_no INTEGER NOT NULL DEFAULT 0,
    title TEXT DEFAULT '',
    cleared INTEGER DEFAULT 0,
    clear_date TEXT,
    rating REAL,
    review TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_game_levels_game ON game_levels(game_id)`,

  // ---------- 片单 ----------
  `CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT NOT NULL,
    cover_path TEXT,
    item_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    added_at TEXT NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists (id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id)`,

  // ---------- 人物 ----------
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT,
    birth_date TEXT,
    birth_place TEXT,
    alternate_names TEXT DEFAULT '[]',
    occupation TEXT DEFAULT '[]',
    summary TEXT,
    photo_path TEXT,
    cover_offset REAL DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS movie_people (
    id TEXT PRIMARY KEY,
    movie_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    role_type TEXT NOT NULL,
    character_name TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (movie_id) REFERENCES movies (id),
    FOREIGN KEY (person_id) REFERENCES people (id)
  )`,
  `CREATE TABLE IF NOT EXISTS book_people (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    role_type TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (book_id) REFERENCES books (id),
    FOREIGN KEY (person_id) REFERENCES people (id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_people (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    role_type TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES games (id),
    FOREIGN KEY (person_id) REFERENCES people (id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_movie_people_movie ON movie_people(movie_id)`,
  `CREATE INDEX IF NOT EXISTS idx_movie_people_person ON movie_people(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_book_people_book ON book_people(book_id)`,
  `CREATE INDEX IF NOT EXISTS idx_book_people_person ON book_people(person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_game_people_game ON game_people(game_id)`,
  `CREATE INDEX IF NOT EXISTS idx_game_people_person ON game_people(person_id)`,

  // ---------- 角色 ----------
  `CREATE TABLE IF NOT EXISTS movie_characters (
    id TEXT PRIMARY KEY,
    movie_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    aliases TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    description TEXT,
    image_path TEXT,
    sort_order INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_movie_characters_movie ON movie_characters(movie_id)`,
  `CREATE TABLE IF NOT EXISTS book_characters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    aliases TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    description TEXT,
    image_path TEXT,
    sort_order INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_book_characters_book ON book_characters(book_id)`,
  `CREATE TABLE IF NOT EXISTS game_characters (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    aliases TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    description TEXT,
    image_path TEXT,
    sort_order INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_game_characters_game ON game_characters(game_id)`,

  // ---------- 标签 ----------
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(name, type)
  )`,

  // ---------- 图片元数据 ----------
  `CREATE TABLE IF NOT EXISTS image_assets (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ---------- 自定义模块 ----------
  `CREATE TABLE IF NOT EXISTS custom_modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active_design_id TEXT,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS custom_module_designs (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    name TEXT NOT NULL,
    fields_json TEXT DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_designs_module ON custom_module_designs(module_id)`,
  `CREATE TABLE IF NOT EXISTS custom_module_items (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    cover_path TEXT,
    rating REAL,
    status TEXT,
    data_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_items_module ON custom_module_items(module_id)`,

  // ---------- 增量同步 ----------
  `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_tombstones (
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    client_id TEXT NOT NULL,
    pushed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity_id, entity_type)
  )`
]
