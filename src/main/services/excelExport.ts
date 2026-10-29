import ExcelJS from 'exceljs'
import { movieDao } from '../db/dao/movieDao'
import { bookDao } from '../db/dao/bookDao'
import { gameDao } from '../db/dao/gameDao'
import {
  MOVIE_STATUS_LABELS,
  MOVIE_CATEGORY_LABELS,
  BOOK_STATUS_LABELS,
  BOOK_CATEGORY_LABELS,
  GAME_STATUS_LABELS,
  GAME_CATEGORY_LABELS
} from '../../shared/types'

function datePart(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
function dateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 19)
}
function join(list: string[]): string {
  return list.join('、')
}

function styleHeader(sheet: ExcelJS.Worksheet, cols: number): void {
  const header = sheet.getRow(1)
  header.font = { bold: true }
  for (let i = 1; i <= cols; i++) {
    sheet.getColumn(i).width = 16
  }
}

export async function exportMovies(dest: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('影视')
  sheet.addRow([
    '名称', '类别', '状态', '评分', '导演', '编剧', '主演', '类型', '别名',
    '上映时间', '观看日期', '观看次数', '时长(分钟)', '简介', '创建时间', '更新时间'
  ])
  for (const m of movieDao.list()) {
    sheet.addRow([
      m.title,
      MOVIE_CATEGORY_LABELS[m.category] ?? m.category,
      MOVIE_STATUS_LABELS[m.status] ?? m.status,
      m.rating ?? '',
      join(m.directors),
      join(m.writers),
      join(m.actors),
      join(m.genres),
      join(m.alternateTitles),
      datePart(m.releaseDate),
      datePart(m.watchDate),
      m.watchCount,
      m.duration,
      m.summary ?? '',
      dateTime(m.createdAt),
      dateTime(m.updatedAt)
    ])
  }
  styleHeader(sheet, 16)
  await wb.xlsx.writeFile(dest)
}

export async function exportBooks(dest: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('书籍')
  sheet.addRow([
    '名称', '类别', '状态', '评分', '作者', '译者', '类型', '出版社', '别名',
    'ISBN', '出版日期', '开始日期', '读完日期', '阅读次数', '简介', '创建时间', '更新时间'
  ])
  for (const b of bookDao.list()) {
    sheet.addRow([
      b.title,
      BOOK_CATEGORY_LABELS[b.category] ?? b.category,
      BOOK_STATUS_LABELS[b.status] ?? b.status,
      b.rating ?? '',
      join(b.authors),
      join(b.translators),
      join(b.genres),
      b.publisher ?? '',
      join(b.alternateTitles),
      b.isbn ?? '',
      datePart(b.publishDate),
      datePart(b.startDate),
      datePart(b.finishDate),
      b.readCount,
      b.summary ?? '',
      dateTime(b.createdAt),
      dateTime(b.updatedAt)
    ])
  }
  styleHeader(sheet, 17)
  await wb.xlsx.writeFile(dest)
}

export async function exportGames(dest: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('游戏')
  sheet.addRow([
    '名称', '类别', '状态', '评分', '平台', '类型', '版本', '开发商',
    '发售日期', '游玩次数', '游玩时长(小时)', '游玩时长(分钟)',
    '购入平台', '购入日期', '购入价格', '简介', '创建时间', '更新时间'
  ])
  for (const g of gameDao.list()) {
    sheet.addRow([
      g.title,
      GAME_CATEGORY_LABELS[g.category] ?? g.category,
      GAME_STATUS_LABELS[g.status] ?? g.status,
      g.rating ?? '',
      join(g.platforms),
      join(g.genres),
      join(g.versions),
      join(g.developer),
      datePart(g.releaseDate),
      g.playCount,
      g.playTimeHours,
      g.playTimeMinutes,
      join(g.purchasePlatforms),
      datePart(g.purchaseDate),
      g.purchasePrice ?? '',
      g.summary ?? '',
      dateTime(g.createdAt),
      dateTime(g.updatedAt)
    ])
  }
  styleHeader(sheet, 18)
  await wb.xlsx.writeFile(dest)
}
