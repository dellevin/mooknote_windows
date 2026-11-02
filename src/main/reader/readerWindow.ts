import { BrowserWindow } from 'electron'
import path from 'node:path'
import { registerBookFile, startReaderServer } from './server'
import { getBookFilePath } from './importer'
import { getProgress } from './library'
import { prefs } from '../prefs'

let readerWin: BrowserWindow | null = null

export function getReaderWindow(): BrowserWindow | null {
  return readerWin && !readerWin.isDestroyed() ? readerWin : null
}

// 打开（或聚焦）阅读窗口的书架视图
export function openReaderWindow(): BrowserWindow {
  if (readerWin && !readerWin.isDestroyed()) {
    if (readerWin.isMinimized()) readerWin.restore()
    readerWin.show()
    readerWin.focus()
    return readerWin
  }

  readerWin = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    frame: true,
    autoHideMenuBar: true,
    title: 'MookNote 阅读',
    backgroundColor: '#f5f1e8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  loadShelf(readerWin)

  readerWin.on('closed', () => {
    readerWin = null
  })

  return readerWin
}

export function focusReaderWindow(): boolean {
  if (readerWin && !readerWin.isDestroyed()) {
    if (readerWin.isMinimized()) readerWin.restore()
    readerWin.show()
    readerWin.focus()
    return true
  }
  return false
}

function loadShelf(win: BrowserWindow): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#/reader`)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: '/reader' })
}

// 从阅读页返回书架视图
export function backToShelf(): void {
  const win = getReaderWindow()
  if (win) loadShelf(win)
}

// foliate-js 阅读视图默认排版（可被 prefs.readerStyle 覆盖）
export interface ReaderStyle {
  fontSize: number
  spacing: number
  sideMargin: number
  topMargin: number
  bottomMargin: number
  pageTurnStyle: 'slide' | 'scroll' | 'noAnimation'
  fontColor: string
  backgroundColor: string
  maxColumnCount: number
  fontWeight: number
}

export const DEFAULT_STYLE: ReaderStyle = {
  fontSize: 1.15,
  spacing: 1.8,
  sideMargin: 7,
  topMargin: 44,
  bottomMargin: 44,
  pageTurnStyle: 'slide',
  fontColor: '#26231d',
  backgroundColor: '#f5f1e8',
  maxColumnCount: 1,
  fontWeight: 400
}

// 打开某本书：窗口整页切换到 foliate-js reader.html（含书 id 与续读 cfi）
export async function openBookInWindow(bookId: string): Promise<boolean> {
  const win = openReaderWindow()
  const filePath = getBookFilePath(bookId)
  if (!filePath) return false

  const progress = getProgress(bookId)
  const port = await startReaderServer()
  const bookUrl = registerBookFile(filePath)
  const saved = prefs.get<Partial<ReaderStyle>>('readerStyle', {})
  const s = { ...DEFAULT_STYLE, ...saved }

  const params = new URLSearchParams({
    bookId: JSON.stringify(bookId),
    importing: JSON.stringify(false),
    url: JSON.stringify(bookUrl),
    initialCfi: JSON.stringify(progress?.cfi ?? ''),
    style: JSON.stringify({
      fontSize: s.fontSize,
      fontName: 'system',
      fontPath: '',
      fontWeight: s.fontWeight,
      letterSpacing: 0,
      spacing: s.spacing,
      paragraphSpacing: 12,
      textIndent: 2,
      fontColor: s.fontColor,
      backgroundColor: s.backgroundColor,
      topMargin: s.topMargin,
      bottomMargin: s.bottomMargin,
      sideMargin: s.sideMargin,
      justify: true,
      hyphenate: false,
      pageTurnStyle: s.pageTurnStyle,
      maxColumnCount: s.maxColumnCount,
      columnThreshold: 600,
      writingMode: 'auto',
      textAlign: 'auto',
      backgroundImage: '',
      bgimgBlur: 0,
      bgimgOpacity: 1,
      bgimgFit: 'cover',
      allowScript: false,
      customCSS: '',
      customCSSEnabled: false,
      useBookStyles: true,
      headingFontSize: 1.3,
      codeHighlightTheme: 'github'
    }),
    readingRules: JSON.stringify({ convertChineseMode: 'none', bionicReadingMode: false })
  })

  await win.loadURL(`http://127.0.0.1:${port}/reader.html?${params.toString()}`)
  return true
}
