# MookNote Windows

MookNote 的 Windows 桌面版（Electron + Vue 3），一款个人多媒体收藏与笔记管理软件，用于记录你看过、读过、玩过的一切。与安卓版 MookNote 数据互通，支持增量同步。

## 功能特性

- **收藏管理**：影视、书籍、游戏三大收藏库，覆盖评分、进度、评论、海报等，并支持人物、片单、标签、Markdown 笔记、日历、画廊、自定义模块与回收站；内置 TMDB / Bangumi 在线搜源，可一键录入元数据与封面。
- **首页统计**：展示各收藏的状态分布与评分概览，以及 GitHub 风格的年度贡献热力图。
- **桌面工具**：悬浮球、截图 OCR、截屏标注、桌面贴图、屏幕取色，以及基于 foliate-js 的电子书阅读器（支持 EPUB / TXT）。
- **备份与同步**：本地备份恢复、WebDAV 备份、与手机版 MookNote 互通的增量同步，并支持导出 Excel。

## 技术栈

| 分类        | 技术                                                    |
| ----------- | ------------------------------------------------------- |
| 桌面框架    | Electron 33                                             |
| 前端        | Vue 3.5 + TypeScript + vue-router 4（hash 模式）+ Pinia |
| UI          | naive-ui                                                |
| 构建        | electron-vite 2 + Vite 5                                |
| 本地数据库  | better-sqlite3                                          |
| Markdown    | Vditor（编辑）、marked + dompurify（渲染）              |
| 图片处理    | sharp                                                   |
| 网络请求    | undici（TMDB / Bangumi 搜源，支持代理）                 |
| 备份 / 导出 | adm-zip、exceljs、iconv-lite                            |
| 阅读器      | foliate-js（resources/reader 内置独立 Web 应用）        |

原生模块 `better-sqlite3` 与 `sharp` 通过 `electron-rebuild` 重编译，并在打包时 asarUnpack。

## 目录结构

```
src/
├── main/            主进程：窗口/托盘、IPC、数据库、后台服务
│   ├── db/          better-sqlite3 schema 与各模块 DAO
│   ├── ipc/         IPC 处理器（影视/书籍/游戏/人物/笔记/标签/统计/搜索/备份/OCR 等）
│   ├── services/    在线搜源、本地/云端 OCR、图片、备份、WebDAV、增量同步、Excel 导出
│   ├── reader/      电子书模块（独立 reader.db 与本地 server）
│   ├── floatBall.ts 桌面悬浮球
│   ├── paths.ts     用户数据目录解析
│   └── prefs.ts     轻量偏好存储（键名对齐安卓版 SharedPreferences）
├── preload/         预加载脚本，contextIsolation 下暴露安全 IPC 桥
├── renderer/        Vue 渲染进程
│   └── src/
│       ├── pages/       页面（含 OCR/截屏/取色/悬浮球/阅读器等 bare 独立窗口页）
│       ├── components/  业务组件
│       ├── stores/      Pinia
│       └── router/      路由
└── shared/          主进程与渲染进程共享的 TypeScript 类型
resources/
├── reader/          foliate-js 阅读器资源（打包为 extraResources）
└── （OCR 引擎资源）
```

## 数据存储位置

所有用户数据位于 Electron 的 `userData` 目录（Windows 下为 `%APPDATA%/mooknote-windows`）：

- `mooknote.db`：主数据库
- `prefs.json`：偏好设置
- `images/`：封面与截图等图片
- `reader.db`、`reader-library/`、`reader-covers/`：阅读器独立数据，不参与同步

## 开发与构建

```shell
# 安装依赖（postinstall 会自动重编译 better-sqlite3）
npm install

# 开发模式
npm run dev

# 仅构建（输出到 out/）
npm run build

# 预览构建产物
npm run start

# 原生模块改动后手动重编译
npm run rebuild

# 打包 NSIS 安装包（输出到 dist/）
npm run pack:win

# 免安装目录版
npm run dist:dir
```

国内网络下建议先配置 Electron 镜像再打包：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run pack:win
```

## 说明

- 当前无自动化测试与 CI 配置
- 许可证：AGPL-3.0
