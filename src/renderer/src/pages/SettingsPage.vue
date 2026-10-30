<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NModal,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  useMessage,
  useDialog
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type { WebDavConfig } from '@shared/types'
import {
  FONT_OPTIONS,
  ICON_OPTIONS,
  applyFont,
  applyIcon,
  preloadFontFaces,
  fontPreviewStack
} from '@/utils/theme'
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
  { id: 'env', label: '运行环境' }
]

const info = ref<AppInfo | null>(null)
const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const exporting = ref<string | null>(null)
const activeMenu = ref('appearance')

function jumpTo(id: string): void {
  activeMenu.value = id
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
const incBusy = ref(false)
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

const backupModeOptions: SelectOption[] = [
  { label: '整包 zip（旧模式，远程保留最新 5 个备份）', value: 'full' },
  { label: '增量同步（多端双向合并，与手机版互通）', value: 'inc' }
]

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
    incBusy.value = true
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
      incBusy.value = false
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

// ── 外观：字体 / 窗口图标（切换即自动保存） ──
const uiFont = ref('system')
const uiIcon = ref('default')

async function onFontPick(v: string): Promise<void> {
  uiFont.value = v
  try {
    await window.mook.prefs.set('uiFont', v)
    applyFont(v)
  } catch (e) {
    message.error('保存失败：' + String(e))
  }
}

async function onIconPick(key: string): Promise<void> {
  uiIcon.value = key
  try {
    await window.mook.prefs.set('uiIcon', key)
    await applyIcon(key)
  } catch (e) {
    message.error('保存失败：' + String(e))
  }
}

onMounted(async () => {
  preloadFontFaces()
  info.value = await window.mook.appInfo()
  uiFont.value = await window.mook.prefs.get<string>('uiFont', 'system')
  uiIcon.value = await window.mook.prefs.get<string>('uiIcon', 'default')
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

    <div class="panels">
      <div id="set-appearance" class="panel">
        <NCard title="软件外观" size="small" class="card">
          <p class="hint">自定义应用界面字体与窗口图标，选择后自动保存并立即生效，下次启动时保留。</p>

          <div class="form-row icon-row">
            <label class="lbl">界面字体</label>
            <div class="icon-picker">
              <button
                v-for="ft in FONT_OPTIONS"
                :key="ft.key"
                type="button"
                class="icon-tile font-tile"
                :class="{ on: uiFont === ft.key }"
                :title="ft.label"
                @click="onFontPick(ft.key)"
              >
                <span
                  class="font-preview"
                  :style="{
                    fontFamily: fontPreviewStack(ft),
                    transform: `translateY(${ft.yOffset}em)`
                  }"
                >Aa 永</span>
                <span class="icon-name">{{ ft.label }}</span>
              </button>
            </div>
          </div>

          <div class="form-row icon-row">
            <label class="lbl">窗口图标</label>
            <div class="icon-picker">
              <button
                v-for="ic in ICON_OPTIONS"
                :key="ic.key"
                type="button"
                class="icon-tile"
                :class="{ on: uiIcon === ic.key }"
                :title="ic.label"
                @click="onIconPick(ic.key)"
              >
                <img :src="ic.url" :alt="ic.label" draggable="false" />
                <span class="icon-name">{{ ic.label }}</span>
              </button>
            </div>
          </div>
        </NCard>
      </div>

      <div id="set-search" class="panel">
        <NCard title="在线搜索" size="small" class="card">
          <!-- TMDB -->
          <div class="search-sec">
            <div class="sec-title">TMDB</div>
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
          </div>

          <!-- Bangumi -->
          <div class="search-sec">
            <div class="sec-title">Bangumi</div>
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
          </div>

          <!-- 增强搜索 -->
          <div class="search-sec">
            <div class="sec-title">增强搜索</div>
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
            <label class="lbl">备份模式</label>
            <NSelect
              :value="backupMode"
              :options="backupModeOptions"
              size="small"
              class="ctrl"
              @update:value="onBackupModePick"
            />
          </div>
          <p class="hint">
            <template v-if="backupMode === 'inc'">
              增量模式：与手机版共用同一目录（<code>inc2/</code>）双向合并，按更新时间解决冲突、自动传播删除，只传变化的数据与图片，云端自动压实。首次同步会建立基线。
              <template v-if="incVersion != null"> · 云端基线 v{{ incVersion }}</template>
            </template>
            <template v-else>
              上传为单个 zip 备份（与安卓版一致），远程保留最新 5 个；下载取最新备份覆盖本地，兼容远程的分片目录备份。
            </template>
            支持 Basic / Digest 认证。
          </p>

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
            <template v-if="backupMode === 'full'">
              <NButton size="small" :loading="davUploading" @click="davUpload">上传备份</NButton>
              <NButton size="small" :loading="davDownloading" @click="davDownload">
                下载并恢复
              </NButton>
            </template>
          </NSpace>

          <NSpace v-if="backupMode === 'inc'" :size="10" class="save-row">
            <NButton size="small" type="primary" :loading="incBusy" @click="runInc('upload')">
              立即同步（双向）
            </NButton>
            <NButton size="small" :loading="incBusy" @click="runInc('download')">仅下载</NButton>
            <NButton size="small" :loading="incBusy" @click="runInc('restore')">
              恢复（以云端为准）
            </NButton>
            <NButton size="small" :loading="incBusy" @click="runInc('forcePush')">
              强制推送（以本机为准）
            </NButton>
          </NSpace>
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
          </NSpace>
        </NCard>
      </div>
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
  color: #1f2329;
  margin-bottom: 16px;
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
  color: var(--accent);
}
.tab.on {
  color: var(--accent);
  font-weight: 600;
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
.icon-picker {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.icon-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 76px;
  padding: 10px 6px 8px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.icon-tile:hover {
  border-color: #cfd4dd;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.08);
}
.icon-tile.on {
  border-color: #1f2329;
  box-shadow: 0 0 0 1px #1f2329 inset;
}
.icon-tile img {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 8px;
}
.icon-name {
  font-size: 12px;
  color: #5b616c;
  white-space: nowrap;
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
}
.font-preview {
  height: 40px;
  min-width: 40px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  line-height: 1;
  white-space: nowrap;
  color: #1f2329;
  border-radius: 8px;
  background: #f4f5f8;
}
.save-row {
  margin-top: 14px;
}

/* ── 在线搜索分区 ── */
.search-sec + .search-sec {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #eef0f4;
}
.sec-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
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
  color: var(--accent);
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
