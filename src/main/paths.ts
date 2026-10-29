import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// 数据根目录。Electron 下用 userData（%APPDATA%/mooknote-windows）。
// 备份/同步以逻辑相对路径存储图片，所以根目录与 Android 不同也能互相恢复。
let dataRoot = ''

export function initPaths(): string {
  dataRoot = app.getPath('userData')
  fs.mkdirSync(imagesRoot(), { recursive: true })
  return dataRoot
}

export function getDataRoot(): string {
  return dataRoot
}export function dbPath(): string {
  return path.join(dataRoot, 'mooknote.db')
}

export function imagesRoot(): string {
  return path.join(dataRoot, 'images')
}

export function prefsPath(): string {
  return path.join(dataRoot, 'prefs.json')
}
