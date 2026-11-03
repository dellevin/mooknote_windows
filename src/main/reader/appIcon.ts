import fs from 'node:fs'
import path from 'node:path'

// 与主窗口一致：开发态显式指定源码图标，打包后省略即使用 exe 内嵌图标
export function readerWindowIcon(): { icon?: string } {
  const devIcon = path.join(__dirname, '../../src/assets/icon/app_icon.png')
  return fs.existsSync(devIcon) ? { icon: devIcon } : {}
}
