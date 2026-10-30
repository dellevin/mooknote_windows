import { getDb } from '../../db'

// 子组（海报/截图/分集/章节/关卡/通关/人物关联）增删改后 bump 父行 updated_at，
// 使「仅改子组」也能越过推送水位、随父行整组推送（链接/子表行本身不总带时间戳）。
// 失败不阻塞原操作。
export function touchParent(parentTable: string, parentId: string): void {
  if (!parentTable || !parentId) return
  try {
    getDb()
      .prepare(`UPDATE ${parentTable} SET updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), parentId)
  } catch {
    // 忽略：父行可能已被删除
  }
}
