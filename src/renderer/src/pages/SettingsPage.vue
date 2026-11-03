<script setup lang="ts">
import { computed, h, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NModal,
  NProgress,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
  useDialog
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type { WebDavConfig } from '@shared/types'
import {
  FONT_OPTIONS,
  applyFont,
  preloadFontFaces,
  fontPreviewStack
} from '@/utils/theme'
import { SKINS, currentSkin, applySkin } from '@/utils/skin'
import { renderMarkdown } from '@/utils/markdown'

interface AppInfo {
  version: string
  dataRoot: string
  dbPath: string
  imagesRoot: string
  platform: string
}

const MENU = [
  { id: 'appearance', label: '软件外观' },
  { id: 'search', label: '在线搜索' },
  { id: 'backup', label: '本地备份' },
  { id: 'webdav', label: 'WebDAV 备份' },
  { id: 'excel', label: '导出 Excel' },
  { id: 'float', label: '其他配置项' },
  { id: 'env', label: '运行环境' }
]

const info = ref<AppInfo | null>(null)
const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const exporting = ref<string | null>(null)
const activeMenu = ref('float')
// 悬浮球页内部的左侧子菜单，默认进入 OCR
const FLOAT_SUBS = [
  { id: 'general', label: '悬浮球' },
  { id: 'ocr', label: 'OCR' }
] as const
const floatSub = ref<(typeof FLOAT_SUBS)[number]['id']>('general')
const ballEnabled = ref(true)
// 悬浮球菜单里各功能模块的显隐（prefs: ocrMenuEnabled / shotEnabled）
const ocrMenuEnabled = ref(true)
const shotEnabled = ref(true)
const colorEnabled = ref(true)

async function onBallEnabledToggle(v: boolean): Promise<void> {
  await window.mook.float.setEnabled(v)
  ballEnabled.value = v
}
async function onOcrMenuToggle(v: boolean): Promise<void> {
  ocrMenuEnabled.value = v
  await window.mook.prefs.set('ocrMenuEnabled', v)
}
async function onShotEnabledToggle(v: boolean): Promise<void> {
  shotEnabled.value = v
  await window.mook.prefs.set('shotEnabled', v)
}
async function onColorEnabledToggle(v: boolean): Promise<void> {
  colorEnabled.value = v
  await window.mook.prefs.set('colorEnabled', v)
}
// 功能模块以标签形式横向排列、自动换行；支持按名称搜索
const floatModuleKeyword = ref('')
const floatModules = computed(() => [
  { id: 'ocr', label: 'OCR 识别', enabled: ocrMenuEnabled.value, toggle: onOcrMenuToggle },
  { id: 'shot', label: '截屏', enabled: shotEnabled.value, toggle: onShotEnabledToggle },
  { id: 'color', label: '取色', enabled: colorEnabled.value, toggle: onColorEnabledToggle }
])
const filteredFloatModules = computed(() => {
  const kw = floatModuleKeyword.value.trim().toLowerCase()
  if (!kw) return floatModules.value
  return floatModules.value.filter((m: (typeof floatModules.value)[number]) =>
    m.label.toLowerCase().includes(kw)
  )
})

// 在线搜索页内部的左侧子菜单
const SEARCH_SUBS = [
  { id: 'tmdb', label: 'TMDB' },
  { id: 'bgm', label: 'Bangumi' },
  { id: 'vip', label: '增强搜索' }
] as const
const searchSub = ref<(typeof SEARCH_SUBS)[number]['id']>('tmdb')

// 滚动时同步顶部高亮到当前可见面板（否则高亮停留在上次点击项）
function onPanelsScroll(e: Event): void {
  const box = e.currentTarget as HTMLElement
  const line = box.getBoundingClientRect().top + 24
  let current = activeMenu.value
  for (const m of MENU) {
    const el = document.getElementById(`set-${m.id}`)
    if (el && el.getBoundingClientRect().top <= line) current = m.id
  }
  if (current !== activeMenu.value) activeMenu.value = current
}

function jumpTo(id: string): void {
  activeMenu.value = id
  void window.mook.prefs.set('settingsActiveTab', id)
  document
    .getElementById(`set-${id}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function exportExcel(kind: 'movie' | 'book' | 'game'): Promise<void> {
  exporting.value = kind
  try {
    const dest = await window.mook.excel.export(kind)
    if (dest) message.success('已导出：' + dest)
  } catch (e) {
    message.error('导出失败：' + String(e))
  } finally {
    exporting.value = null
  }
}

function openPath(p: string): void {
  void window.mook.shell.openPath(p)
}

// http(s) 外链交给系统默认浏览器（主进程 setWindowOpenHandler 已拦截）
function openExternal(url: string): void {
  window.open(url, '_blank')
}

function toggleDevTools(): void {
  window.mook.window.toggleDevTools()
}

// ── 维护：清理缓存 / 清理空文件夹 ──
const clearingCache = ref(false)
const cleaningEmptyDirs = ref(false)
const purgingDeleted = ref(false)

function fmtBytesSize(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

async function clearCache(): Promise<void> {
  dialog.warning({
    title: '清理缓存数据',
    content:
      '将清除应用的网络/GPU 缓存和临时文件，并删除数据库已不引用的孤立图片（删除笔记/影评等后残留的图片文件，不影响仍在使用的数据）。可能需要重新联网加载部分内容。确定继续？',
    positiveText: '清理',
    negativeText: '取消',
    onPositiveClick: async () => {
      clearingCache.value = true
      try {
        const r = await window.mook.maintenance.clearCache()
        const extras = [
          r.orphanImages ? `删除 ${r.orphanImages} 张孤立图片` : '',
          r.emptyDirs ? `删除 ${r.emptyDirs} 个空文件夹` : ''
        ]
          .filter(Boolean)
          .join('，')
        message.success(`缓存已清理，释放 ${fmtBytesSize(r.bytes)}${extras ? `，${extras}` : ''}`)
      } catch (e) {
        message.error('清理失败：' + String(e))
      } finally {
        clearingCache.value = false
      }
    }
  })
}

async function cleanEmptyDirs(): Promise<void> {
  cleaningEmptyDirs.value = true
  try {
    const r = await window.mook.maintenance.cleanEmptyDirs()
    r.removed
      ? message.success(`已删除 ${r.removed} 个空文件夹`)
      : message.info('未发现空文件夹')
  } catch (e) {
    message.error('清理失败：' + String(e))
  } finally {
    cleaningEmptyDirs.value = false
  }
}

function purgeDeleted(): void {
  dialog.warning({
    title: '清除所有软删除数据',
    content:
      '将物理删除各模块回收站中（is_deleted=1）的全部条目，删除后无法恢复。条目引用的图片文件可在完成后用「清理缓存数据」回收磁盘空间。确定继续？',
    positiveText: '永久删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      purgingDeleted.value = true
      try {
        const r = await window.mook.maintenance.purgeDeleted()
        r.rows
          ? message.success(`已永久删除 ${r.rows} 条回收站数据（${r.tables} 张表）`)
          : message.info('回收站是空的')
      } catch (e) {
        message.error('清除失败：' + String(e))
      } finally {
        purgingDeleted.value = false
      }
    }
  })
}

// ── 数据库查看跳转到独立页面 /db ──

// ── 在线搜索凭证 ──
const authOptions: SelectOption[] = [
  { label: 'API Token（v4 Bearer，推荐）', value: 'bearer' },
  { label: 'API Key（v3）', value: 'apikey' }
]
const tmdbToken = ref('')
const tmdbAuthType = ref<'bearer' | 'apikey'>('bearer')
const tmdbProxy = ref('')
const bgmToken = ref('')
const bgmProxy = ref('')
const testing = ref<string | null>(null)
const savingTmdb = ref(false)
const savingBgm = ref(false)

async function saveTmdb(): Promise<void> {
  savingTmdb.value = true
  try {
    await window.mook.prefs.set('tmdbApiToken', tmdbToken.value.trim())
    await window.mook.prefs.set('tmdbAuthType', tmdbAuthType.value)
    await window.mook.prefs.set('tmdbProxy', tmdbProxy.value.trim())
    message.success('TMDB 配置已保存')
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    savingTmdb.value = false
  }
}

async function saveBgm(): Promise<void> {
  savingBgm.value = true
  try {
    await window.mook.prefs.set('bangumiAccessToken', bgmToken.value.trim())
    await window.mook.prefs.set('bangumiProxy', bgmProxy.value.trim())
    message.success('Bangumi 配置已保存')
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    savingBgm.value = false
  }
}

async function testTmdb(): Promise<void> {
  const t = tmdbToken.value.trim()
  // v4 Read Access Token 是三段式 JWT（含两个点）；v3 API Key 是 32 位十六进制
  if (tmdbAuthType.value === 'bearer' && (t.match(/\./g) || []).length !== 2) {
    message.warning('当前 Token 不像完整的 API Read Access Token（应为含两个点的长串），请重新完整复制')
  }
  testing.value = 'tmdb'
  try {
    const auth = await window.mook.search.tmdbTest(
      tmdbToken.value.trim(),
      tmdbAuthType.value,
      tmdbProxy.value.trim()
    )
    message.success('TMDB 连接成功（鉴权方式：' + (auth === 'apikey' ? 'API Key' : 'Token') + '）')
  } catch (e) {
    message.error('TMDB 连接失败：' + String(e))
  } finally {
    testing.value = null
  }
}

async function testBgm(): Promise<void> {
  testing.value = 'bgm'
  try {
    await window.mook.search.bgmTest(bgmToken.value.trim(), bgmProxy.value.trim())
    message.success('Bangumi 连接成功')
  } catch (e) {
    message.error('Bangumi 连接失败：' + String(e))
  } finally {
    testing.value = null
  }
}

// ── 增强搜索（VIP 服务，prefs 键与 App 版一致） ──
const movieVipToken = ref('')
const bookVipToken = ref('')
const savingEnhanced = ref(false)
const testingEnhanced = ref(false)
// null=未测试/测试中, true=有效, false=无效
const movieVipValid = ref<boolean | null>(null)
const bookVipValid = ref<boolean | null>(null)
const movieVipMsg = ref('')
const bookVipMsg = ref('')
const tokenDocShow = ref(false)
const tokenDocLoading = ref(false)
const tokenDocHtml = ref('')

async function saveEnhanced(): Promise<void> {
  savingEnhanced.value = true
  try {
    await window.mook.prefs.set('movieSearchToken', movieVipToken.value.trim())
    await window.mook.prefs.set('bookSearchToken', bookVipToken.value.trim())
    await window.mook.prefs.set('enhancedSearchEnabled', true)
    message.success('已保存')
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    savingEnhanced.value = false
  }
}

// 与 App 版一致：先按当前类型校验，失败后用另一种类型重试，提示是否填错位置
async function verifyVip(
  token: string,
  own: 'movie' | 'book',
  setValid: (v: boolean | null) => void,
  setMsg: (s: string) => void
): Promise<void> {
  const other: 'movie' | 'book' = own === 'movie' ? 'book' : 'movie'
  const r = await window.mook.search.vipTokenCheck(token, own)
  if (r.valid) {
    setValid(true)
    setMsg(r.message || 'Token 有效')
    return
  }
  const retry = await window.mook.search.vipTokenCheck(token, other)
  setValid(false)
  setMsg(
    retry.valid
      ? `该 Token 可能是${other === 'movie' ? '影视' : '书籍'}类型，请检查是否填错位置`
      : r.message || 'Token 无效'
  )
}

async function testEnhanced(): Promise<void> {
  const mt = movieVipToken.value.trim()
  const bt = bookVipToken.value.trim()
  if (!mt && !bt) {
    message.warning('请先填写至少一个 Token')
    return
  }
  testingEnhanced.value = true
  if (mt) movieVipValid.value = null
  if (bt) bookVipValid.value = null
  movieVipMsg.value = ''
  bookVipMsg.value = ''
  try {
    const tasks: Promise<void>[] = []
    if (mt)
      tasks.push(
        verifyVip(mt, 'movie', (v) => (movieVipValid.value = v), (s) => (movieVipMsg.value = s))
      )
    if (bt)
      tasks.push(
        verifyVip(bt, 'book', (v) => (bookVipValid.value = v), (s) => (bookVipMsg.value = s))
      )
    await Promise.all(tasks)
    if (mt)
      message[movieVipValid.value ? 'success' : 'error'](
        `影视 Token${movieVipValid.value ? '有效' : '无效'}：${movieVipMsg.value || (movieVipValid.value ? 'Token 有效' : 'Token 无效')}`
      )
    if (bt)
      message[bookVipValid.value ? 'success' : 'error'](
        `书籍 Token${bookVipValid.value ? '有效' : '无效'}：${bookVipMsg.value || (bookVipValid.value ? 'Token 有效' : 'Token 无效')}`
      )
  } finally {
    testingEnhanced.value = false
  }
}

async function openTokenDoc(): Promise<void> {
  tokenDocShow.value = true
  if (tokenDocHtml.value) return
  tokenDocLoading.value = true
  try {
    const md = await window.mook.search.tokenDoc()
    tokenDocHtml.value = renderMarkdown(md)
  } catch (e) {
    tokenDocHtml.value = `<p style="color:#888">加载失败，请检查网络：${String(e)}</p>`
  } finally {
    tokenDocLoading.value = false
  }
}

// ── 本地备份 / 恢复 ──
const backingUp = ref(false)
const restoring = ref(false)

async function localBackup(): Promise<void> {
  backingUp.value = true
  try {
    const r = await window.mook.backup.export()
    if (r) message.success(`备份完成（${r.imageCount} 张图片）：${r.path}`)
  } catch (e) {
    message.error('备份失败：' + String(e))
  } finally {
    backingUp.value = false
  }
}

function statsText(stats?: Record<string, number>): string {
  if (!stats) return ''
  return Object.entries(stats)
    .map(([k, v]) => `${k} ${v}`)
    .join('，')
}

function promptReload(): void {
  dialog.warning({
    title: '数据已恢复',
    content: '需要重新加载窗口以显示恢复的数据，是否立即重新加载？',
    positiveText: '重新加载',
    negativeText: '稍后',
    onPositiveClick: () => window.location.reload()
  })
}

async function localRestore(): Promise<void> {
  dialog.warning({
    title: '确认恢复',
    content: '恢复将覆盖当前全部本地数据（数据库与图片），建议先做一次备份。确定继续？',
    positiveText: '选择备份并恢复',
    negativeText: '取消',
    onPositiveClick: async () => {
      restoring.value = true
      try {
        const r = await window.mook.backup.import()
        if (!r) return
        if (r.success) {
          message.success('恢复完成：' + statsText(r.stats))
          promptReload()
        } else {
          message.error(r.error ?? '恢复失败')
        }
      } catch (e) {
        message.error('恢复失败：' + String(e))
      } finally {
        restoring.value = false
      }
    }
  })
}

// ── WebDAV ──
const davCfg = ref<WebDavConfig>({ url: '', username: '', password: '', path: '/mooknote' })
const davTesting = ref(false)
const davUploading = ref(false)
const davDownloading = ref(false)
const davSaving = ref(false)
const lastSync = ref('')
const davProgress = ref({ active: false, percent: 0, received: 0, total: 0 })
const uploadProgress = ref({ active: false, percent: 0, received: 0, total: 0, stage: 'transfer' })

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

function fmtSyncTime(s: string): string {
  if (!s) return '从未同步'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

async function saveDav(): Promise<boolean> {
  if (!davCfg.value.url.trim()) {
    message.warning('请填写服务器地址')
    return false
  }
  davSaving.value = true
  try {
    await window.mook.webdav.saveConfig({
      url: davCfg.value.url.trim(),
      username: davCfg.value.username.trim(),
      password: davCfg.value.password,
      path: davCfg.value.path.trim()
    })
    message.success('已保存')
    return true
  } finally {
    davSaving.value = false
  }
}

// 上传/下载前静默确保配置已存，不弹“已保存”提示
async function persistDavSilent(): Promise<boolean> {
  if (!davCfg.value.url.trim()) {
    message.warning('请填写服务器地址')
    return false
  }
  await window.mook.webdav.saveConfig({
    url: davCfg.value.url.trim(),
    username: davCfg.value.username.trim(),
    password: davCfg.value.password,
    path: davCfg.value.path.trim()
  })
  return true
}

async function testDav(): Promise<void> {
  davTesting.value = true
  try {
    const r = await window.mook.webdav.test({
      url: davCfg.value.url.trim(),
      username: davCfg.value.username.trim(),
      password: davCfg.value.password,
      path: davCfg.value.path.trim()
    })
    r.success ? message.success(r.message) : message.error(r.message)
  } catch (e) {
    message.error('连接失败：' + String(e))
  } finally {
    davTesting.value = false
  }
}

async function davUpload(): Promise<void> {
  if (!(await persistDavSilent())) return
  uploadProgress.value = { active: false, percent: 0, received: 0, total: 0, stage: 'transfer' }

  const d = dialog.warning({
    title: '上传备份',
    positiveText: '开始上传',
    negativeText: '取消',
    content: () =>
      h('div', null, [
        h('p', { style: 'margin:0 0 10px' }, '将本地数据打包为 zip 上传到 WebDAV，远程保留最新 5 个备份。'),
        uploadProgress.value.active
          ? h('div', null, [
              h(NProgress, {
                type: 'line',
                percentage: uploadProgress.value.percent,
                height: 8,
                borderRadius: 4,
                indicatorPlacement: 'inside',
                processing: true
              }),
              h(
                'div',
                { style: 'margin-top:6px;font-size:12px;color:#7a808a' },
                uploadProgress.value.stage === 'verify'
                  ? '上传完成，正在服务器端校验文件…'
                  : uploadProgress.value.stage === 'cleanup'
                    ? '校验通过，正在清理旧备份…'
                    : uploadProgress.value.total > 0
                      ? `上传中 ${uploadProgress.value.percent}%（${fmtBytes(
                          uploadProgress.value.received
                        )} / ${fmtBytes(uploadProgress.value.total)}）`
                      : '正在上传…'
              )
            ])
          : null
      ]),
    onPositiveClick: async () => {
      davUploading.value = true
      uploadProgress.value = { active: true, percent: 0, received: 0, total: 0, stage: 'transfer' }
      const off = window.mook.webdav.onUploadProgress((p) => {
        uploadProgress.value = { active: true, ...p }
      })
      try {
        const r = await window.mook.webdav.upload()
        if (r.success) {
          message.success(`上传成功（${r.imageCount ?? 0} 张图片）`)
          lastSync.value = new Date().toISOString()
        } else {
          message.error(r.message)
        }
      } finally {
        off()
        davUploading.value = false
        uploadProgress.value.active = false
        d.destroy()
      }
    }
  })
}

// ── 增量同步（inc2，与手机版互通） ──
type BackupMode = 'full' | 'inc'
type IncAction = 'upload' | 'download' | 'restore' | 'forcePush'
const backupMode = ref<BackupMode>('full')
// 当前正在执行的增量动作；null 表示空闲。按钮只在自己动作执行时转圈
const incBusy = ref<IncAction | null>(null)
const incLastSync = ref('')
const incVersion = ref<number | null>(null)
const incProgress = ref({
  stage: '',
  message: '',
  upRecords: 0,
  downRecords: 0,
  upImages: 0,
  downImages: 0,
  dedupImages: 0
})

async function onBackupModePick(v: BackupMode): Promise<void> {
  backupMode.value = v
  await window.mook.prefs.set('webdav_backup_mode', v)
  if (v === 'inc') await refreshIncInfo()
}

async function refreshIncInfo(fetchRemoteVersion = true): Promise<void> {
  const info2 = await window.mook.incSync.info(fetchRemoteVersion)
  incLastSync.value = info2.lastSync
  incVersion.value = info2.manifestVersion
}

const INC_CONFIRM: Partial<Record<IncAction, string>> = {
  restore: '将以云端快照覆盖本机全部数据与图片，本机尚未同步的变更会丢失。确定继续？',
  forcePush: '将以本机数据重建云端基线，远程增量历史会被覆盖替换。确定继续？'
}

function runInc(action: IncAction): void {
  const exec = async (): Promise<void> => {
    if (!(await persistDavSilent())) return
    incBusy.value = action
    incProgress.value = {
      stage: 'connect',
      message: '准备中…',
      upRecords: 0,
      downRecords: 0,
      upImages: 0,
      downImages: 0,
      dedupImages: 0
    }
    const titleMap: Record<IncAction, string> = {
      upload: '立即同步（双向）',
      download: '仅下载',
      restore: '恢复（以云端为准）',
      forcePush: '强制推送（以本机为准）'
    }
    const d = dialog.create({
      title: titleMap[action],
      closable: false,
      maskClosable: false,
      content: () =>
        h('div', null, [
          h(NProgress, {
            type: 'line',
            percentage: 100,
            height: 8,
            borderRadius: 4,
            indicatorPlacement: 'inside',
            processing: true
          }),
          h('div', { style: 'margin-top:8px;font-size:13px' }, incProgress.value.message),
          h(
            'div',
            { style: 'margin-top:6px;font-size:12px;color:#7a808a' },
            `上行 ${incProgress.value.upRecords} 条 / 图片 ${incProgress.value.upImages}（去重 ${incProgress.value.dedupImages}） · 下行 ${incProgress.value.downRecords} 条 / 图片 ${incProgress.value.downImages}`
          )
        ])
    })
    const off = window.mook.incSync.onProgress((p) => {
      incProgress.value = p
    })
    try {
      const r =
        action === 'upload'
          ? await window.mook.incSync.upload()
          : action === 'download'
            ? await window.mook.incSync.download()
            : action === 'restore'
              ? await window.mook.incSync.restore()
              : await window.mook.incSync.forcePush()
      if (r.success) {
        message.success(
          `${r.message}（上行 ${r.uploadedRecords} 条/图片 ${r.uploadedImages}，下行 ${r.downloadedRecords} 条/图片 ${r.downloadedImages}）`
        )
        await refreshIncInfo()
        if (r.needReload) promptReload()
      } else {
        message.error(r.message)
      }
    } catch (e) {
      message.error('同步失败：' + String(e))
    } finally {
      off()
      incBusy.value = null
      d.destroy()
    }
  }

  const confirmText = INC_CONFIRM[action]
  if (confirmText) {
    dialog.warning({
      title: '请确认',
      content: confirmText,
      positiveText: '继续',
      negativeText: '取消',
      onPositiveClick: () => exec()
    })
  } else {
    void exec()
  }
}

async function davDownload(): Promise<void> {
  if (!(await persistDavSilent())) return
  davProgress.value = { active: false, percent: 0, received: 0, total: 0 }

  const d = dialog.warning({
    title: '确认云端恢复',
    positiveText: '下载并覆盖',
    negativeText: '取消',
    content: () =>
      h('div', null, [
        h('p', { style: 'margin:0 0 10px' }, '将下载远程最新备份并覆盖当前全部本地数据，确定继续？'),
        davProgress.value.active
          ? h('div', null, [
              h(NProgress, {
                type: 'line',
                percentage: davProgress.value.percent,
                height: 8,
                borderRadius: 4,
                indicatorPlacement: 'inside',
                processing: true
              }),
              h(
                'div',
                { style: 'margin-top:6px;font-size:12px;color:#7a808a' },
                davProgress.value.total > 0
                  ? `下载中 ${davProgress.value.percent}%（${fmtBytes(
                      davProgress.value.received
                    )} / ${fmtBytes(davProgress.value.total)}）`
                  : '正在下载…'
              )
            ])
          : null
      ]),
    onPositiveClick: async () => {
      davDownloading.value = true
      davProgress.value = { active: true, percent: 0, received: 0, total: 0 }
      const off = window.mook.webdav.onDownloadProgress((p) => {
        davProgress.value = { active: true, ...p }
      })
      try {
        const r = await window.mook.webdav.download()
        if (r.success) {
          message.success('恢复完成：' + statsText(r.stats))
          promptReload()
        } else {
          message.error(r.message)
        }
      } finally {
        off()
        davDownloading.value = false
        davProgress.value.active = false
        d.destroy()
      }
    }
  })
}

// ── OCR 识别模块：以可搜索标签的形式列出提供方，后续新增模块只需往 OCR_PROVIDERS 加一项 ──
interface OcrProvider {
  id: string
  label: string
  /** 该模块是否已配置（用于标签/卡片状态） */
  ready: () => boolean
}
const ocrProviders: OcrProvider[] = [
  { id: 'xfxingchen', label: '讯飞星辰 MaaS', ready: () => xfConfigured.value },
  { id: 'baidu', label: '百度智能云', ready: () => baiduConfigured.value },
  { id: 'local', label: '本地 OCR', ready: () => localReady.value }
]
const ocrProvider = ref('xfxingchen')
const ocrProviderKeyword = ref('')
const filteredOcrProviders = computed(() => {
  const kw = ocrProviderKeyword.value.trim().toLowerCase()
  if (!kw) return ocrProviders
  return ocrProviders.filter((p) => p.label.toLowerCase().includes(kw))
})
// 标签灯：当前选中=绿；未选中但已配置=黄；未配置=红
function ocrDotClass(id: string): 'on' | 'ready' | 'none' {
  if (ocrProvider.value === id) return 'on'
  const p = ocrProviders.find((x) => x.id === id)
  return p && p.ready() ? 'ready' : 'none'
}
// 切换提供方即写回 prefs：识别与「测试连接」都按当前提供方走
async function onPickOcrProvider(id: string): Promise<void> {
  ocrProvider.value = id
  const provider = id === 'baidu' ? 'baidu' : id === 'local' ? 'local' : 'xf'
  await window.mook.prefs.set('ocrProvider', provider)
}

// ── 云端 OCR：讯飞星辰视觉大模型，凭证仅保存在本地 prefs ──
const xfApiKey = ref('')
const xfEndpoint = ref('')
const xfModel = ref('')
const xfConfigured = ref(false)
const XF_MODEL_OPTIONS = [
  { label: 'PaddleOCR v1.6（xoppaddleocrv16）', value: 'xoppaddleocrv16' },
  { label: 'DeepSeek OCR（xopdeepseekocr）', value: 'xopdeepseekocr' },
  { label: '混元 OCR（xophunyuanocr）', value: 'xophunyuanocr' }
]

// ── 百度智能云 OCR：AK/SK 换 access_token，调通用文字识别 ──
const baiduAk = ref('')
const baiduSk = ref('')
const baiduEndpoint = ref('general_basic')
const baiduConfigured = ref(false)
const BAIDU_ENDPOINT_OPTIONS = [
  { label: '通用文字识别（标准版）', value: 'general_basic' },
  { label: '通用文字识别（标准含位置版）', value: 'general' },
  { label: '通用文字识别（高精度版）', value: 'accurate_basic' },
  { label: '通用文字识别（高精度含位置版）', value: 'accurate' }
]

// ── 本地 OCR：RapidOCR-json / PaddleOCR-json 子进程，引擎用户手动放入 resources ──
type EngineState = Awaited<ReturnType<typeof window.mook.ocr.enginesScan>>['engines']['rapid']
const engineScan = ref<Awaited<ReturnType<typeof window.mook.ocr.enginesScan>> | null>(null)
const localEngineId = ref<'rapid' | 'paddle'>('rapid')
const localLanguageKey = ref('')
const localAngle = ref(true)
const localMaxSideLen = ref(1024)
const localReady = ref(false)
const LOCAL_SIDE_OPTIONS = [
  { label: '1024（更快）', value: 1024 },
  { label: '2048（更清晰）', value: 2048 },
  { label: '9999（不限制）', value: 9999 }
]
const currentEngine = computed<EngineState | null>(
  () => engineScan.value?.engines[localEngineId.value] ?? null
)
const localLanguageOptions = computed(() =>
  (currentEngine.value?.languages ?? []).map((l) => ({ label: l.label, value: l.key }))
)

async function scanLocalEngines(force = true): Promise<void> {
  engineScan.value = await window.mook.ocr.enginesScan(force)
  // 已保存的引擎不存在/未就绪时，自动落到可用的那个
  const cur = engineScan.value.engines[localEngineId.value]
  if (!cur || cur.status !== 'ready') {
    const other =
      engineScan.value.engines[localEngineId.value === 'rapid' ? 'paddle' : 'rapid']
    if (other.status === 'ready') localEngineId.value = other.id
  }
  const eng = engineScan.value.engines[localEngineId.value]
  localReady.value = eng.status === 'ready'
  if (eng.status === 'ready') {
    const has = eng.languages.some((l) => l.key === localLanguageKey.value)
    if (!has) localLanguageKey.value = eng.languages[0].key
  }
}

async function onPickLocalEngine(id: 'rapid' | 'paddle'): Promise<void> {
  localEngineId.value = id
  const eng = engineScan.value?.engines[id]
  localLanguageKey.value = eng?.languages[0]?.key ?? ''
  await persistLocalOcr()
  await scanLocalEngines(false)
}

async function persistLocalOcr(): Promise<void> {
  const p = window.mook.prefs.set.bind(window.mook.prefs)
  await Promise.all([
    p('localOcrEngine', localEngineId.value),
    p('localOcrLanguage', localLanguageKey.value),
    p('localOcrAngle', localAngle.value),
    p('localOcrMaxSideLen', localMaxSideLen.value)
  ])
}

async function refreshEngines(): Promise<void> {
  await scanLocalEngines(true)
  message.success('已重新扫描引擎目录')
}
async function openEngineDir(): Promise<void> {
  const r = await window.mook.ocr.engineOpenDir()
  if (!r.ok) message.error('打开目录失败：' + r.error)
}
// 模板安全包装：NSwitch update:value
function onLocalAngleToggle(v: boolean): void {
  localAngle.value = v
  void persistLocalOcr()
}

async function loadCloudOcr(): Promise<void> {
  const p = window.mook.prefs
  await scanLocalEngines(true)
  const cfg = await window.mook.ocr.cloudConfig()
  const providerMap = { xf: 'xfxingchen', baidu: 'baidu', local: 'local' } as const
  ocrProvider.value = providerMap[cfg.provider] ?? 'xfxingchen'
  xfApiKey.value = await p.get('xfOcrApiKey', '')
  xfEndpoint.value = await p.get('xfOcrEndpoint', '')
  xfModel.value = (await p.get('xfOcrModel', '')) || 'xoppaddleocrv16'
  xfConfigured.value = cfg.provider === 'xf' ? cfg.configured : !!xfApiKey.value
  baiduAk.value = await p.get('baiduOcrAk', '')
  baiduSk.value = await p.get('baiduOcrSk', '')
  baiduEndpoint.value =
    (await p.get('baiduOcrEndpoint', '')) ||
    (cfg.provider === 'baidu' ? cfg.model : '') ||
    'general_basic'
  baiduConfigured.value = cfg.provider === 'baidu' ? cfg.configured : !!baiduAk.value && !!baiduSk.value
  // 本地引擎偏好
  localEngineId.value = (await p.get('localOcrEngine', 'rapid')) === 'paddle' ? 'paddle' : 'rapid'
  localAngle.value = (await p.get('localOcrAngle', true)) !== false
  const side = Number(await p.get('localOcrMaxSideLen', 1024))
  localMaxSideLen.value = side > 0 ? side : 1024
  await scanLocalEngines(false)
  const eng = engineScan.value?.engines[localEngineId.value]
  const savedLang = String(await p.get('localOcrLanguage', ''))
  localLanguageKey.value =
    eng?.languages.some((l) => l.key === savedLang) ? savedLang : (eng?.languages[0]?.key ?? '')
  localReady.value = eng?.status === 'ready'
}
async function saveCloudCredentials(): Promise<void> {
  const p = window.mook.prefs.set.bind(window.mook.prefs)
  const tasks =
    ocrProvider.value === 'baidu'
      ? [
          p('baiduOcrAk', baiduAk.value.trim()),
          p('baiduOcrSk', baiduSk.value.trim()),
          p('baiduOcrEndpoint', baiduEndpoint.value)
        ]
      : ocrProvider.value === 'local'
        ? [
            p('localOcrEngine', localEngineId.value),
            p('localOcrLanguage', localLanguageKey.value),
            p('localOcrAngle', localAngle.value),
            p('localOcrMaxSideLen', localMaxSideLen.value)
          ]
        : [
            p('xfOcrApiKey', xfApiKey.value.trim()),
            p('xfOcrEndpoint', xfEndpoint.value.trim()),
            p('xfOcrModel', xfModel.value.trim())
          ]
  await Promise.all(tasks)
  await loadCloudOcr()
  message.success('OCR 配置已保存')
}

// 测试：先把界面上未保存的输入落盘（同时写回当前提供方），再发真实请求验证密钥
const cloudTesting = ref(false)
async function testCurrentCloud(): Promise<void> {
  if (cloudTesting.value) return
  cloudTesting.value = true
  try {
    await saveCloudCredentials()
    const r = await window.mook.ocr.cloudTest()
    if (r.ok) message.success(r.message)
    else message.error(r.message)
  } catch (e) {
    message.error('测试失败：' + String(e))
  } finally {
    cloudTesting.value = false
  }
}

// ── 外观：皮肤 / 字体（切换即自动保存） ──
const skinKey = computed(() => currentSkin.value.key)

async function onSkinPick(key: string): Promise<void> {
  try {
    await applySkin(key)
  } catch (e) {
    message.error('保存失败：' + String(e))
  }
}

// 关闭窗口行为：ask=每次询问 tray=最小化到托盘 quit=退出程序
const closeAction = ref<'ask' | 'tray' | 'quit'>('ask')
async function onCloseActionPick(v: 'ask' | 'tray' | 'quit'): Promise<void> {
  closeAction.value = v
  await window.mook.prefs.set('closeAction', v)
  message.success('已保存')
}

const uiFont = ref('system')
// 预览区跟随鼠标悬停的卡片，移出后回到当前选中字体
const previewFont = ref('system')
const previewOpt = computed(
  () => FONT_OPTIONS.find((f) => f.key === previewFont.value) ?? FONT_OPTIONS[0]
)

async function onFontPick(v: string): Promise<void> {
  uiFont.value = v
  previewFont.value = v
  try {
    await window.mook.prefs.set('uiFont', v)
    applyFont(v)
  } catch (e) {
    message.error('保存失败：' + String(e))
  }
}

onMounted(async () => {
  preloadFontFaces()
  info.value = await window.mook.appInfo()
  closeAction.value = await window.mook.prefs.get<'ask' | 'tray' | 'quit'>('closeAction', 'ask')
  uiFont.value = await window.mook.prefs.get<string>('uiFont', 'system')
  previewFont.value = uiFont.value
  tmdbToken.value = await window.mook.prefs.get<string>('tmdbApiToken', '')
  tmdbAuthType.value = await window.mook.prefs.get<'bearer' | 'apikey'>('tmdbAuthType', 'bearer')
  tmdbProxy.value = await window.mook.prefs.get<string>('tmdbProxy', '')
  bgmToken.value = await window.mook.prefs.get<string>('bangumiAccessToken', '')
  bgmProxy.value = await window.mook.prefs.get<string>('bangumiProxy', '')
  // 增强搜索默认开启
  void window.mook.prefs.set('enhancedSearchEnabled', true)
  movieVipToken.value = await window.mook.prefs.get<string>('movieSearchToken', '')
  bookVipToken.value = await window.mook.prefs.get<string>('bookSearchToken', '')

  const cfg = await window.mook.webdav.getConfig()
  if (cfg) davCfg.value = cfg
  lastSync.value = await window.mook.webdav.lastSync()
  backupMode.value = await window.mook.prefs.get<BackupMode>('webdav_backup_mode', 'full')
  // 挂载时只读本地状态，不发起网络请求；版本号在切到增量模式或同步后拉取
  await refreshIncInfo(false)
  await loadCloudOcr()
  ballEnabled.value = await window.mook.float.getEnabled()
  ocrMenuEnabled.value =
    (await window.mook.prefs.get<boolean>('ocrMenuEnabled', true)) !== false
  shotEnabled.value = (await window.mook.prefs.get<boolean>('shotEnabled', true)) !== false
  colorEnabled.value = (await window.mook.prefs.get<boolean>('colorEnabled', true)) !== false
  // 恢复上次选中的 tab，并把对应面板滚动到顶部（默认悬浮球页）
  const saved = await window.mook.prefs.get<string>('settingsActiveTab', 'float')
  if (MENU.some((m) => m.id === saved)) {
    activeMenu.value = saved
    await nextTick()
    document.getElementById(`set-${saved}`)?.scrollIntoView({ block: 'start' })
  }
})
</script>

<template>
  <div ref="rootEl" class="page">
    <h2 class="title">设置</h2>

    <div class="tabs">
      <button
        v-for="m in MENU"
        :key="m.id"
        type="button"
        class="tab"
        :class="{ on: activeMenu === m.id }"
        @click="jumpTo(m.id)"
      >
        {{ m.label }}
      </button>
    </div>

    <div class="panels" @scroll="onPanelsScroll">
      <div id="set-appearance" class="panel">
        <NCard title="软件外观" size="small" class="card">
          <p class="hint">自定义个性皮肤与界面字体，选择后自动保存并立即生效，下次启动时保留。</p>

          <div class="form-row icon-row">
            <label class="lbl">个性皮肤</label>
            <div class="skin-picker">
              <button
                v-for="sk in SKINS"
                :key="sk.key"
                type="button"
                class="skin-tile"
                :class="{ on: skinKey === sk.key }"
                :title="sk.label"
                @click="onSkinPick(sk.key)"
              >
                <span class="skin-card" :style="{ background: sk.swatch }">
                  <span class="skin-glyph" :style="{ color: sk.glyph }">M</span>
                </span>
                <span class="skin-name">{{ sk.label }}</span>
              </button>
            </div>
          </div>

          <div class="form-row font-row-block">
            <label class="lbl">界面字体</label>
            <div class="font-stage">
              <div class="font-cards">
                <button
                  v-for="ft in FONT_OPTIONS"
                  :key="ft.key"
                  type="button"
                  class="font-card"
                  :class="{ on: uiFont === ft.key }"
                  :title="ft.desc"
                  @click="onFontPick(ft.key)"
                  @mouseenter="previewFont = ft.key"
                  @mouseleave="previewFont = uiFont"
                >
                  <span class="font-card-yong" :style="{ fontFamily: fontPreviewStack(ft) }">
                    永
                  </span>
                  <span class="font-card-name" :style="{ fontFamily: fontPreviewStack(ft) }">
                    {{ ft.label }}
                  </span>
                </button>
              </div>

              <div class="font-preview-box">
                <div class="font-preview-head">
                  <span class="font-preview-name">{{ previewOpt.label }}</span>
                  <span class="font-preview-desc">{{ previewOpt.desc }}</span>
                </div>
                <p
                  class="font-preview-text"
                  :style="{ fontFamily: fontPreviewStack(previewOpt) }"
                >
                  永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭，修禊事也。
                </p>
                <p
                  class="font-preview-en"
                  :style="{ fontFamily: fontPreviewStack(previewOpt) }"
                >
                  ABCDEFG abcdefg 0123456789 — The quick brown fox jumps over the lazy dog.
                </p>
              </div>
            </div>
          </div>

          <div class="form-row">
            <label class="lbl">关闭窗口操作</label>
            <NRadioGroup :value="closeAction" @update:value="onCloseActionPick">
              <NSpace>
                <NRadio value="ask">每次询问</NRadio>
                <NRadio value="tray">最小化到托盘</NRadio>
                <NRadio value="quit">退出程序</NRadio>
              </NSpace>
            </NRadioGroup>
          </div>
        </NCard>
      </div>

      <div id="set-search" class="panel">
        <NCard title="在线搜索" size="small" class="card sub-card">
          <div class="sub-settings">
            <div class="sub-side">
              <button
                v-for="s in SEARCH_SUBS"
                :key="s.id"
                type="button"
                class="sub-side-item"
                :class="{ on: searchSub === s.id }"
                @click="searchSub = s.id"
              >
                {{ s.label }}
              </button>
            </div>
            <div class="sub-main">
              <!-- TMDB -->
              <template v-if="searchSub === 'tmdb'">
                <h3 class="sub-main-title">TMDB</h3>
                <p class="hint">
                  需在 themoviedb.org 申请 API Token 或 v3 API Key。代理支持 http://、https://，留空则直连。
                </p>

                <div class="form-row">
                  <label class="lbl">鉴权方式</label>
                  <NSelect
                    v-model:value="tmdbAuthType"
                    :options="authOptions"
                    size="small"
                    class="ctrl"
                  />
                </div>
                <div class="form-row">
                  <label class="lbl">Token / Key</label>
                  <NInput
                    v-model:value="tmdbToken"
                    size="small"
                    type="password"
                    show-password-on="click"
                    placeholder="粘贴 API Token 或 v3 API Key"
                    class="ctrl"
                  />
                </div>
                <div class="form-row">
                  <label class="lbl">代理</label>
                  <NInput
                    v-model:value="tmdbProxy"
                    size="small"
                    placeholder="http://127.0.0.1:7890（仅 TMDB 使用，可留空直连）"
                    class="ctrl"
                  />
                </div>

                <NSpace :size="10" class="save-row">
                  <NButton size="small" type="primary" :loading="savingTmdb" @click="saveTmdb">
                    保存
                  </NButton>
                  <NButton size="small" :loading="testing === 'tmdb'" @click="testTmdb">
                    测试连接
                  </NButton>
                  <NButton
                    size="small"
                    @click="openExternal('https://www.themoviedb.org/settings/api?language=zh-CN')"
                  >
                    获取 Token
                  </NButton>
                </NSpace>
              </template>

              <!-- Bangumi -->
              <template v-else-if="searchSub === 'bgm'">
                <h3 class="sub-main-title">Bangumi</h3>
                <p class="hint">
                  填写个人访问令牌后可使用Bangumi搜索接口。代理支持 http://、https://，留空则直连。
                </p>

                <div class="form-row">
                  <label class="lbl">Token</label>
                  <NInput
                    v-model:value="bgmToken"
                    size="small"
                    type="password"
                    show-password-on="click"
                    placeholder="个人访问令牌（可留空）"
                    class="ctrl"
                  />
                </div>
                <div class="form-row">
                  <label class="lbl">代理</label>
                  <NInput
                    v-model:value="bgmProxy"
                    size="small"
                    placeholder="http://127.0.0.1:7890（可留空）"
                    class="ctrl"
                  />
                </div>

                <NSpace :size="10" class="save-row">
                  <NButton size="small" type="primary" :loading="savingBgm" @click="saveBgm">保存</NButton>
                  <NButton size="small" :loading="testing === 'bgm'" @click="testBgm">测试连接</NButton>
                  <NButton size="small" @click="openExternal('https://bangumi.github.io/api/')">
                    获取 Token
                  </NButton>
                </NSpace>
              </template>

              <!-- 增强搜索 -->
              <template v-else>
                <h3 class="sub-main-title">增强搜索</h3>
                <p class="hint">
                  开发者自己创建的一个搜索功能，可以搜索书籍影视等信息汇集了7w+影视数据，300w+书籍数据
                </p>

                <div class="form-row vip-row">
                  <label class="lbl">影视增强 Token</label>
                  <div class="ctrl vip-field">
                    <NInput
                      v-model:value="movieVipToken"
                      size="small"
                      type="password"
                      show-password-on="click"
                      placeholder="输入影视搜索 Token"
                    />
                  </div>
                </div>

                <div class="form-row vip-row">
                  <label class="lbl">书籍增强 Token</label>
                  <div class="ctrl vip-field">
                    <NInput
                      v-model:value="bookVipToken"
                      size="small"
                      type="password"
                      show-password-on="click"
                      placeholder="输入书籍搜索 Token"
                    />
                  </div>
                </div>

                <NSpace :size="10" class="save-row vip-actions">
                  <NButton size="small" type="primary" :loading="savingEnhanced" @click="saveEnhanced">
                    保存
                  </NButton>
                  <NButton size="small" :loading="testingEnhanced" @click="testEnhanced">
                    测试连接
                  </NButton>
                  <NButton size="small"  @click="openTokenDoc">获取 Token</NButton>
                </NSpace>
              </template>
            </div>
          </div>
        </NCard>
      </div>

      <div id="set-backup" class="panel">
        <NCard title="本地备份与恢复" size="small" class="card">
          <p class="hint">
            备份为单个 zip（data.json + 全部图片），与安卓版 MookNote 备份完全互通，可互相恢复。
          </p>
          <NSpace :size="12">
            <NButton size="small" type="primary" :loading="backingUp" @click="localBackup">
              导出备份
            </NButton>
            <NButton size="small" :loading="restoring" @click="localRestore">从备份恢复</NButton>
          </NSpace>
        </NCard>

      </div>

      <div id="set-webdav" class="panel">
        <NCard title="WebDAV 备份" size="small" class="card">
          <template #header-extra>
            <span class="sync-time">
              {{
                backupMode === 'inc'
                  ? `上次同步：${fmtSyncTime(incLastSync)}`
                  : `上次同步：${fmtSyncTime(lastSync)}`
              }}
            </span>
          </template>

          <div class="form-row">
            <label class="lbl">服务器地址</label>
            <NInput
              v-model:value="davCfg.url"
              size="small"
              placeholder="https://dav.example.com"
              class="ctrl"
            />
          </div>
          <div class="form-row">
            <label class="lbl">账号</label>
            <NInput v-model:value="davCfg.username" size="small" class="ctrl" />
          </div>
          <div class="form-row">
            <label class="lbl">密码 / 应用密码</label>
            <NInput
              v-model:value="davCfg.password"
              size="small"
              type="password"
              show-password-on="click"
              :input-props="{ autocomplete: 'new-password' }"
              class="ctrl"
            />
          </div>
          <div class="form-row">
            <label class="lbl">备份目录</label>
            <NInput v-model:value="davCfg.path" size="small" placeholder="/mooknote" class="ctrl" />
          </div>

          <NSpace :size="10" class="save-row">
            <NButton size="small" type="primary" :loading="davSaving" @click="saveDav">
              保存配置
            </NButton>
            <NButton size="small" :loading="davTesting" @click="testDav">测试连接</NButton>
          </NSpace>

          <label class="lbl backup-mode-lbl">备份模式</label>
          <div class="backup-modes">
            <div
              class="mode-card"
              :class="{ on: backupMode === 'full' }"
              @click="onBackupModePick('full')"
            >
              <div class="mode-card-head">
                <span class="mode-radio"></span>
                <span class="mode-name">整包 zip 备份</span>
              </div>
              <p class="mode-desc">
                上传为单个 zip 备份（与安卓版一致），远程保留最新 5 个；下载取最新备份覆盖本地。
              </p>
              <div class="mode-actions">
                <NButton
                  size="tiny"
                  :disabled="backupMode !== 'full'"
                  :loading="davUploading"
                  @click.stop="davUpload"
                >
                  上传备份
                </NButton>
                <NButton
                  size="tiny"
                  :disabled="backupMode !== 'full'"
                  :loading="davDownloading"
                  @click.stop="davDownload"
                >
                  下载并恢复
                </NButton>
              </div>
            </div>

            <div
              class="mode-card"
              :class="{ on: backupMode === 'inc' }"
              @click="onBackupModePick('inc')"
            >
              <div class="mode-card-head">
                <span class="mode-radio"></span>
                <span class="mode-name">增量同步</span>
                <span v-if="incVersion != null" class="mode-ver">v{{ incVersion }}</span>
              </div>
              <p class="mode-desc">
                与手机版共用同一目录（<code>inc2/</code>）双向合并，按更新时间解决冲突、自动传播删除，只传变化的数据与图片，云端自动压实。
              </p>
              <div class="mode-actions">
                <NButton
                  size="tiny"
                  type="primary"
                  :disabled="backupMode !== 'inc' || incBusy !== null"
                  :loading="incBusy === 'upload'"
                  @click.stop="runInc('upload')"
                >
                  立即同步（双向）
                </NButton>
                <NButton
                  size="tiny"
                  :disabled="backupMode !== 'inc' || incBusy !== null"
                  :loading="incBusy === 'download'"
                  @click.stop="runInc('download')"
                >
                  仅下载
                </NButton>
                <NButton
                  size="tiny"
                  :disabled="backupMode !== 'inc' || incBusy !== null"
                  :loading="incBusy === 'restore'"
                  @click.stop="runInc('restore')"
                >
                  恢复
                </NButton>
                <NButton
                  size="tiny"
                  :disabled="backupMode !== 'inc' || incBusy !== null"
                  :loading="incBusy === 'forcePush'"
                  @click.stop="runInc('forcePush')"
                >
                  强制推送
                </NButton>
              </div>
            </div>
          </div>
          <p class="hint">支持 Basic / Digest 认证。</p>
        </NCard>
      </div>

      <div id="set-excel" class="panel">
        <NCard title="导出 Excel" size="small" class="card">
          <template #header-extra>
            <NTag size="small" :bordered="false">.xlsx</NTag>
          </template>
          <p class="hint">将当前未删除的数据导出为 Excel 表格，可在保存对话框中选择位置。</p>
          <NSpace :size="12">
            <NButton size="small" :loading="exporting === 'movie'" @click="exportExcel('movie')">
              导出影视
            </NButton>
            <NButton size="small" :loading="exporting === 'book'" @click="exportExcel('book')">
              导出书籍
            </NButton>
            <NButton size="small" :loading="exporting === 'game'" @click="exportExcel('game')">
              导出游戏
            </NButton>
          </NSpace>
        </NCard>
      </div>

      <div id="set-float" class="panel">
        <NCard title="其他配置项" size="small" class="card float-card">
          <div class="float-settings">
            <div class="float-side">
              <button
                v-for="s in FLOAT_SUBS"
                :key="s.id"
                type="button"
                class="float-side-item"
                :class="{ on: floatSub === s.id }"
                @click="floatSub = s.id"
              >
                {{ s.label }}
              </button>
            </div>
            <div class="float-main">
              <template v-if="floatSub === 'general'">
                <h3 class="float-main-title">悬浮球</h3>
                <div class="form-row">
                  <label class="lbl">显示悬浮球</label>
                  <NSwitch :value="ballEnabled" @update:value="onBallEnabledToggle" />
                </div>
                <p class="hint">关闭后悬浮球在桌面隐藏，重新打开即可恢复，拖动后的位置会保留。</p>

                <h3 class="float-main-title" style="margin-top: 18px">功能模块</h3>
                <p class="hint">控制悬浮球菜单中显示哪些功能入口，点击标签即可开关。</p>
                <NInput
                  v-model:value="floatModuleKeyword"
                  size="small"
                  class="float-module-search"
                  clearable
                  placeholder="搜索功能模块"
                />
                <div class="float-module-tags">
                  <button
                    v-for="m in filteredFloatModules"
                    :key="m.id"
                    type="button"
                    class="float-module-chip"
                    :class="{ on: m.enabled }"
                    @click="m.toggle(!m.enabled)"
                  >
                    <span class="float-module-dot" :class="{ on: m.enabled }"></span>
                    {{ m.label }}
                  </button>
                  <span v-if="!filteredFloatModules.length" class="float-module-empty">
                    没有匹配的功能模块
                  </span>
                </div>
              </template>
              <template v-else>
                <h3 class="float-main-title">OCR 识别</h3>
                <p class="hint">
                  悬浮球截屏后调用下方识别模块识别文字。每个模块独立配置，密钥仅保存在本机。
                </p>

                <!-- 提供方标签：可搜索，选中后下方显示该 OCR 模块配置；后续新增只需往 OCR_PROVIDERS 加标签 -->
                <div class="ocr-provider-bar">
                  <NInput
                    v-model:value="ocrProviderKeyword"
                    size="small"
                    class="ocr-provider-search"
                    clearable
                    placeholder="搜索识别模块"
                  />
                  <div class="ocr-provider-tags">
                    <button
                      v-for="p in filteredOcrProviders"
                      :key="p.id"
                      type="button"
                      class="ocr-tag"
                      :class="{ on: ocrProvider === p.id }"
                      @click="onPickOcrProvider(p.id)"
                    >
                      <span class="ocr-tag-label">{{ p.label }}</span>
                      <span class="ocr-tag-dot" :class="ocrDotClass(p.id)" />
                    </button>
                    <span v-if="!filteredOcrProviders.length" class="ocr-provider-empty">无匹配的识别模块</span>
                  </div>
                </div>

                <div v-if="ocrProvider === 'xfxingchen'" class="ocr-modules">
                  <section class="ocr-module">
                    <header class="ocr-module-head">
                      <div class="ocr-module-name">
                        <span class="ocr-module-title">讯飞星辰 MaaS</span>
                        <NTag size="small" :type="xfConfigured ? 'success' : 'warning'" :bordered="false">
                          {{ xfConfigured ? '已配置' : '未配置' }}
                        </NTag>
                      </div>
                      <span class="ocr-module-desc">视觉 OCR 大模型，选择模型并填写 API Key</span>
                    </header>
                    <div class="form-row">
                      <label class="lbl">接口地址</label>
                      <NInput
                        v-model:value="xfEndpoint"
                        size="small"
                        class="ctrl"
                        placeholder="https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">API Key</label>
                      <NInput
                        v-model:value="xfApiKey"
                        size="small"
                        class="ctrl"
                        type="password"
                        show-password-on="click"
                        placeholder="ak-xxxxxxxx"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">OCR 模型</label>
                      <NSelect
                        v-model:value="xfModel"
                        size="small"
                        class="ctrl"
                        filterable
                        tag
                        :options="XF_MODEL_OPTIONS"
                        placeholder="选择或直接输入 OCR 模型 ID"
                      />
                    </div>
                    <NSpace :size="10" class="save-row">
                      <NButton size="small" type="primary" @click="saveCloudCredentials">保存</NButton>
                      <NButton size="small" :loading="cloudTesting" @click="testCurrentCloud">测试连接</NButton>
                    </NSpace>
                  </section>
                </div>

                <div v-else-if="ocrProvider === 'baidu'" class="ocr-modules">
                  <section class="ocr-module">
                    <header class="ocr-module-head">
                      <div class="ocr-module-name">
                        <span class="ocr-module-title">百度智能云 OCR</span>
                        <NTag size="small" :type="baiduConfigured ? 'success' : 'warning'" :bordered="false">
                          {{ baiduConfigured ? '已配置' : '未配置' }}
                        </NTag>
                      </div>
                      <span class="ocr-module-desc">通用文字识别（pp_ocr），填写应用的 API Key / Secret Key</span>
                    </header>
                    <div class="form-row">
                      <label class="lbl">API Key</label>
                      <NInput
                        v-model:value="baiduAk"
                        size="small"
                        class="ctrl"
                        type="password"
                        show-password-on="click"
                        placeholder="应用的 API Key（AK）"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">Secret Key</label>
                      <NInput
                        v-model:value="baiduSk"
                        size="small"
                        class="ctrl"
                        type="password"
                        show-password-on="click"
                        placeholder="应用的 Secret Key（SK）"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">识别接口</label>
                      <NSelect
                        v-model:value="baiduEndpoint"
                        size="small"
                        class="ctrl"
                        :options="BAIDU_ENDPOINT_OPTIONS"
                      />
                    </div>
                    <NSpace :size="10" class="save-row">
                      <NButton size="small" type="primary" @click="saveCloudCredentials">保存</NButton>
                      <NButton size="small" :loading="cloudTesting" @click="testCurrentCloud">测试连接</NButton>
                    </NSpace>
                  </section>
                </div>

                <div v-else-if="ocrProvider === 'local'" class="ocr-modules">
                  <section class="ocr-module">
                    <header class="ocr-module-head">
                      <div class="ocr-module-name">
                        <span class="ocr-module-title">本地 OCR</span>
                        <NTag size="small" :type="localReady ? 'success' : 'error'" :bordered="false">
                          {{ localReady ? '引擎就绪' : '引擎未就绪' }}
                        </NTag>
                      </div>
                      <span class="ocr-module-desc">
                        离线识别，引擎需手动下载放入引擎目录后点「刷新检测」
                      </span>
                    </header>

                    <div class="form-row">
                      <label class="lbl">引擎</label>
                      <div class="ctrl local-engine-row">
                        <button
                          v-for="en in engineScan ? [engineScan.engines.rapid, engineScan.engines.paddle] : []"
                          :key="en.id"
                          type="button"
                          class="local-engine-chip"
                          :class="{ on: localEngineId === en.id }"
                          :disabled="en.status !== 'ready'"
                          :title="en.message"
                          @click="onPickLocalEngine(en.id)"
                        >
                          <span class="le-dot" :class="en.status" />
                          {{ en.label }}
                        </button>
                      </div>
                    </div>

                    <div v-if="currentEngine && currentEngine.status !== 'ready'" class="local-warn">
                      {{ currentEngine.label }}：{{ currentEngine.message }}
                    </div>

                    <div class="form-row">
                      <label class="lbl">语言模型</label>
                      <NSelect
                        v-model:value="localLanguageKey"
                        size="small"
                        class="ctrl"
                        :options="localLanguageOptions"
                        :disabled="!localReady"
                        placeholder="未检测到可用模型"
                        @update:value="persistLocalOcr"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">最大边长</label>
                      <NSelect
                        v-model:value="localMaxSideLen"
                        size="small"
                        class="ctrl"
                        :options="LOCAL_SIDE_OPTIONS"
                        @update:value="persistLocalOcr"
                      />
                    </div>
                    <div class="form-row">
                      <label class="lbl">方向分类</label>
                      <NSwitch
                        :value="localAngle"
                        @update:value="onLocalAngleToggle"
                      />
                    </div>

                    <div class="local-dir">
                      <span class="local-dir-label">引擎目录：</span>
                      <span class="path">{{ engineScan?.roots[0] ?? '' }}</span>
                    </div>
                    <div class="local-guide">
                      <div class="local-guide-title">引擎不随软件安装，需自行下载后离线使用：</div>
                      <div class="local-guide-links">
                        <a href="#" @click.prevent="openExternal('https://github.com/hiroi-sora/RapidOCR-json/releases')">
                          下载 RapidOCR-json
                        </a>
                        <a href="#" @click.prevent="openExternal('https://github.com/hiroi-sora/PaddleOCR-json/releases')">
                          下载 PaddleOCR-json
                        </a>
                      </div>
                      <div class="local-guide-step">
                        解压后把整个引擎文件夹（含 exe 与 models）放进上面的引擎目录，再点「刷新检测」。
                      </div>
                    </div>

                    <NSpace :size="10" class="save-row">
                      <NButton size="small" type="primary" :disabled="!localReady" @click="saveCloudCredentials">
                        保存
                      </NButton>
                      <NButton size="small" :loading="cloudTesting" :disabled="!localReady" @click="testCurrentCloud">
                        测试连接
                      </NButton>
                      <NButton size="small" @click="refreshEngines">刷新检测</NButton>
                      <NButton size="small" @click="openEngineDir">打开引擎目录</NButton>
                    </NSpace>
                  </section>
                </div>
              </template>
            </div>
          </div>
        </NCard>
      </div>

      <div id="set-env" class="panel">
        <NCard v-if="info" title="运行环境" size="small" class="card">
          <NDescriptions label-placement="left" :column="1" size="small">
            <NDescriptionsItem label="平台">{{ info.platform }}</NDescriptionsItem>
            <NDescriptionsItem label="应用版本">
              {{ info.version }}
            </NDescriptionsItem>
            <NDescriptionsItem label="数据库">
              <NSpace align="center" :size="8">
                <span class="path">{{ info.dbPath }}</span>
                <NButton size="tiny" type="primary" quaternary @click="router.push('/db')">
                  查看数据
                </NButton>
              </NSpace>
            </NDescriptionsItem>
            <NDescriptionsItem label="数据目录">
              <NSpace align="center" :size="8">
                <span class="path">{{ info.dataRoot }}</span>
                <NButton size="tiny" quaternary @click="openPath(info!.dataRoot)">打开</NButton>
              </NSpace>
            </NDescriptionsItem>
            <NDescriptionsItem label="图片目录">
              <NSpace align="center" :size="8">
                <span class="path">{{ info.imagesRoot }}</span>
                <NButton size="tiny" quaternary @click="openPath(info!.imagesRoot)">打开</NButton>
              </NSpace>
            </NDescriptionsItem>
            <NDescriptionsItem label="调试模式">
              <NButton size="tiny" quaternary @click="toggleDevTools">
                打开调试器（DevTools）
              </NButton>
            </NDescriptionsItem>
          </NDescriptions>

          <NSpace :size="10" class="save-row">
            <NButton size="small" :loading="clearingCache" @click="clearCache">
              清理缓存数据
            </NButton>
            <NButton size="small" :loading="cleaningEmptyDirs" @click="cleanEmptyDirs">
              清理空文件夹
            </NButton>
            <NButton
              size="small"
              type="error"
              secondary
              :loading="purgingDeleted"
              @click="purgeDeleted"
            >
              清除所有软删除
            </NButton>
          </NSpace>
        </NCard>
      </div>

      <!-- 底部占位：保证最后一个分区也能滚动到顶部（标题紧贴 tab 栏下方） -->
      <div class="panels-bottom-spacer" aria-hidden="true"></div>
    </div>

    <NModal
      v-model:show="tokenDocShow"
      preset="card"
      title="获取 Token"
      :style="{ width: '440px', maxWidth: 'calc(100vw - 48px)' }"
    >
      <div v-if="tokenDocLoading" class="token-doc-loading">加载中…</div>
      <!-- 内容来自官方 Markdown 文档，已经 renderMarkdown（DOMPurify）消毒 -->
      <div v-else class="token-doc markdown-body" v-html="tokenDocHtml"></div>
    </NModal>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 24px 0;
}
.title {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--text-strong);
  margin-bottom: 16px;
}
/* 所有卡片标题加黑加粗 */
.page :deep(.n-card-header__main) {
  font-weight: 700;
  color: var(--text-strong);
}
.tabs {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 18px;
  border-bottom: 1px solid #eceef3;
}
.tab {
  position: relative;
  font-size: 13px;
  padding: 9px 18px;
  border: none;
  background: transparent;
  color: #555;
  cursor: pointer;
  transition:
    color var(--d1) var(--fluent-ease),
    background-color var(--d1) var(--fluent-ease);
}
.tab::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background: transparent;
  border-radius: 0;
  transition: background var(--d1) var(--fluent-ease);
}
.tab:hover {
  color: var(--accent-ink);
}
.tab.on {
  color: var(--accent-ink);
  font-weight: 600;
}
.float-card .n-card__content,
.sub-card .n-card__content {
  padding-top: 4px;
}
.float-settings,
.sub-settings {
  display: flex;
  gap: 18px;
  align-items: stretch;
}
.float-side,
.sub-side {
  width: 104px;
  flex: 0 0 104px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-right: 1px solid rgba(17, 17, 17, 0.08);
}
.float-side-item,
.sub-side-item {
  text-align: left;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-strong, #1f2329);
  font-size: 13.5px;
  font-family: inherit;
  cursor: pointer;
}
.float-side-item:hover,
.sub-side-item:hover {
  background: rgba(17, 17, 17, 0.06);
}
.float-side-item.on,
.sub-side-item.on {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent-ink);
  font-weight: 600;
}
.float-main,
.sub-main {
  flex: 1;
  min-width: 0;
}
.float-main-title,
.sub-main-title {
  margin: 4px 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
}
/* 悬浮球功能模块：搜索框 + 横向换行标签 */
.float-module-search {
  max-width: 260px;
  margin: 6px 0 10px;
}
.float-module-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.float-module-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.12));
  background: var(--surface, #fff);
  color: var(--text-dim, #9aa0ac);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.float-module-chip:hover {
  background: rgba(17, 17, 17, 0.05);
}
.float-module-chip.on {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border-color: color-mix(in srgb, var(--accent-ink) 40%, var(--surface));
  color: var(--accent-ink);
  font-weight: 600;
}
.float-module-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: #f0a020;
}
.float-module-dot.on {
  background: #18a058;
}
.float-module-empty {
  font-size: 12px;
  color: var(--text-dim, #9aa0ac);
}
/* OCR 识别模块：每个提供方一个独立小卡，后续并列追加即可 */
.ocr-provider-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 6px 0 12px;
}
.ocr-provider-search {
  max-width: 260px;
}
.ocr-provider-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.ocr-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.12));
  background: var(--surface, #fff);
  color: var(--text-strong, #1f2329);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.ocr-tag:hover {
  background: rgba(17, 17, 17, 0.05);
}
.ocr-tag.on {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border-color: color-mix(in srgb, var(--accent-ink) 40%, var(--surface));
  color: var(--accent-ink);
  font-weight: 600;
}
.ocr-tag-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
/* 当前选中=绿；未选中但已配置=黄；未配置=红 */
.ocr-tag-dot.on {
  background: #18a058;
}
.ocr-tag-dot.ready {
  background: #f0a020;
}
.ocr-tag-dot.none {
  background: #d03050;
}
.ocr-provider-empty {
  font-size: 12px;
  color: var(--text-dim, #9aa0ac);
}
/* 本地 OCR 引擎选择 */
.local-engine-row {
  display: flex;
  gap: 8px;
}
.local-engine-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid rgba(17, 17, 17, 0.14);
  background: var(--surface, #fff);
  color: var(--text-strong, #1f2329);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.local-engine-chip.on {
  border-color: var(--accent, #2563eb);
  color: var(--accent, #2563eb);
}
.local-engine-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.le-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.le-dot.ready {
  background: #18a058;
}
.le-dot.incomplete {
  background: #f0a020;
}
.le-dot.missing {
  background: #d03050;
}
.local-warn {
  margin: 2px 0 8px;
  font-size: 12.5px;
  color: #d03050;
}
.local-dir {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 6px;
  font-size: 12px;
}
.local-dir-label {
  color: var(--text-dim, #9aa0ac);
  flex: 0 0 auto;
}
.local-guide {
  margin: 4px 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(17, 17, 17, 0.04);
  font-size: 12.5px;
  line-height: 1.7;
}
.local-guide-title {
  color: var(--text-strong, #1f2329);
}
.local-guide-links {
  display: flex;
  gap: 16px;
  margin: 2px 0;
}
.local-guide-links a {
  color: var(--accent, #2563eb);
  text-decoration: none;
}
.local-guide-links a:hover {
  text-decoration: underline;
}
.local-guide-step {
  color: var(--text-dim, #9aa0ac);
}
.ocr-modules {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}
.ocr-module {
  border: 1px solid var(--fluent-stroke, rgba(17, 17, 17, 0.08));
  border-radius: 12px;
  padding: 12px 14px 14px;
  background: var(--fluent-card, rgba(255, 255, 255, 0.6));
}
.ocr-module-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
}
.ocr-module-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ocr-module-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong, #1f2329);
}
.ocr-module-desc {
  font-size: 12px;
  color: var(--text-dim, #9aa0ac);
}
.tab.on::after {
  background: var(--accent);
}
.panels {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  padding-bottom: 32px;
}
.panel {
  min-height: 120px;
}
.panels-bottom-spacer {
  height: 65vh;
  flex-shrink: 0;
  pointer-events: none;
}
.card {
  margin-bottom: 16px;
}
.path {
  font-size: 12.5px;
  color: #5b616c;
  word-break: break-all;
}
.sync-time {
  font-size: 12px;
  color: #8a909c;
}
.hint {
  font-size: 12.5px;
  color: #8a909c;
  margin-bottom: 12px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.lbl {
  width: 130px;
  flex-shrink: 0;
  font-size: 13px;
  color: #5b616c;
  text-align: left;
}
.ctrl {
  flex: 1;
}
.icon-row {
  align-items: flex-start;
}

/* 个性皮肤：大色块 + 名称 */
.skin-picker {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.skin-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.skin-card {
  position: relative;
  width: 188px;
  height: 104px;
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid transparent;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.12s ease;
}
.skin-tile:hover .skin-card {
  transform: translateY(-2px);
}
.skin-tile.on .skin-card {
  border-color: var(--accent-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-ink) 18%, transparent);
}
.skin-glyph {
  position: absolute;
  right: 16px;
  bottom: 2px;
  font-size: 64px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -2px;
}
.skin-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  padding-left: 2px;
}

/* 界面字体：大卡片 + 预览区 */
.font-row-block {
  margin-top: 4px;
  align-items: flex-start;
}
.font-row-block .lbl {
  padding-top: 6px;
}
.font-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.font-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.font-card {
  width: 148px;
  height: 104px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #e9ebf1;
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.12s ease;
}
.font-card:hover {
  border-color: color-mix(in srgb, var(--accent-ink) 40%, #e9ebf1);
  box-shadow: 0 4px 14px rgba(17, 17, 17, 0.08);
  transform: translateY(-2px);
}
.font-card.on {
  border-color: var(--accent-ink);
  box-shadow: 0 0 0 1px var(--accent-ink) inset;
}
.font-card-yong {
  font-size: 38px;
  font-weight: 600;
  line-height: 1;
  color: var(--text-strong);
}
.font-card-name {
  font-size: 12.5px;
  color: #57606a;
  white-space: nowrap;
}

/* 实时预览区：跟随悬停/选中字体 */
.font-preview-box {
  border: 1px solid #e9ebf1;
  border-radius: 12px;
  background: #fafbfc;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.font-preview-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.font-preview-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
}
.font-preview-desc {
  font-size: 12px;
  color: #8a909c;
}
.font-preview-text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--text-strong);
}
.font-preview-en {
  font-size: 12.5px;
  line-height: 1.6;
  color: #6b7280;
}
.save-row {
  margin-top: 14px;
}

/* ── WebDAV 备份模式选择卡片 ── */
.backup-mode-lbl {
  display: block;
  margin: 18px 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
}
.backup-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mode-card {
  display: flex;
  flex-direction: column;
  padding: 14px;
  border: 1.5px solid #e6e8ee;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.mode-card:hover {
  border-color: color-mix(in srgb, var(--accent-ink) 40%, #e6e8ee);
}
.mode-card.on {
  border-color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 7%, #ffffff);
  box-shadow: 0 0 0 1px var(--accent-ink) inset;
}
.mode-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.mode-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid #c0c4cc;
  flex-shrink: 0;
  position: relative;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.mode-card.on .mode-radio {
  border-color: var(--accent-ink);
}
.mode-card.on .mode-radio::after {
  content: '';
  position: absolute;
  inset: 2.5px;
  border-radius: 50%;
  background: var(--accent-ink);
}
.mode-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
}
.mode-ver {
  margin-left: auto;
  font-size: 11px;
  color: #8a909c;
}
.mode-desc {
  font-size: 12px;
  line-height: 1.6;
  color: #8a909c;
  margin-bottom: 12px;
  flex: 1;
}
.mode-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── 在线搜索分区 ── */
.search-sec + .search-sec {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #eef0f4;
}
.sec-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  margin-bottom: 10px;
}

/* ── 增强搜索 ── */
.vip-row {
  align-items: flex-start;
  margin-top: 12px;
}
.vip-actions {
  align-items: center;
}
/* ── 数据库查看器已迁移至独立页面 /db ── */
.token-doc-loading {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: #9aa0aa;
}
.token-doc {
  max-height: 72vh;
  overflow-y: auto;
  padding-right: 6px;
  font-size: 13.5px;
  line-height: 1.8;
  color: #2f3540;
}
/* 文档内图片：竖屏单列自适应 */
.token-doc :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 10px auto;
  border-radius: 8px;
  border: 1px solid #eef0f4;
}
.token-doc :deep(h1) {
  font-size: 19px;
  font-weight: 600;
  margin: 8px 0 14px;
}
.token-doc :deep(h2) {
  font-size: 16px;
  font-weight: 600;
  margin: 18px 0 10px;
}
.token-doc :deep(h3) {
  font-size: 14.5px;
  font-weight: 600;
  margin: 16px 0 8px;
}
.token-doc :deep(p) {
  margin-bottom: 8px;
}
.token-doc :deep(ul) {
  padding-left: 20px;
  margin-bottom: 8px;
}
.token-doc :deep(li) {
  margin-bottom: 4px;
}
.token-doc :deep(a) {
  color: var(--accent-ink);
}
.token-doc :deep(code) {
  background: #f2f3f5;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12.5px;
}
.token-doc :deep(pre) {
  background: #f2f3f5;
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
}
.token-doc :deep(blockquote) {
  border-left: 3px solid #d9dde3;
  padding-left: 12px;
  color: #7a808a;
}
</style>
