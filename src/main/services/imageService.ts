import { dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { imagesRoot } from '../paths'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])

// 弹出文件选择框，返回选中的源文件绝对路径（可多选）
export async function pickImageFiles(multiple = false): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showOpenDialog(win!, {
    title: '选择图片',
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
  })
  return res.canceled ? [] : res.filePaths
}

// 将外部图片复制进应用沙箱目录 images/<category>/<entityId>[/sub]/<uuid><ext>
export function importImage(
  category: string,
  entityId: string,
  sourcePath: string,
  sub?: string
): string {
  const ext = path.extname(sourcePath).toLowerCase()
  const safeExt = IMAGE_EXTS.has(ext) ? ext : '.jpg'
  const dirParts = [imagesRoot(), category, entityId]
  if (sub) dirParts.push(sub)
  const dir = path.join(...dirParts)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${randomUUID()}${safeExt}`)
  fs.copyFileSync(sourcePath, dest)
  return dest
}

export function deleteEntityFolder(category: string, entityId: string): void {
  const dir = path.join(imagesRoot(), category, entityId)
  fs.rmSync(dir, { recursive: true, force: true })
}

// 在线搜索封面：把已下载的图片字节写入 images/<category>/<entityId>[/sub]/
export function writeImageBuffer(
  category: string,
  entityId: string,
  buffer: Buffer,
  ext = '.jpg',
  sub?: string
): string {
  const dirParts = [imagesRoot(), category, entityId]
  if (sub) dirParts.push(sub)
  const dir = path.join(...dirParts)
  fs.mkdirSync(dir, { recursive: true })
  const safeExt = IMAGE_EXTS.has(ext.toLowerCase()) ? ext.toLowerCase() : '.jpg'
  const dest = path.join(dir, `${randomUUID()}${safeExt}`)
  fs.writeFileSync(dest, buffer)
  return dest
}
