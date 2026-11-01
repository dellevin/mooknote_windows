<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useInfiniteScroll } from '@/utils/infiniteScroll'
import {
  NButton,
  NInput,
  NSpin,
  NModal,
  NCheckbox,
  NSelect,
  useMessage,
  useDialog
} from 'naive-ui'

type Row = Record<string, unknown>
interface ColInfo {
  name: string
  type: string
  notNull: boolean
  defaultValue: string | null
  pk: number
}
interface FieldState {
  name: string
  type: string
  isNull: boolean
  value: string
}

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const tables = ref<string[]>([])
const tableFilter = ref('')
const filteredTables = computed(() => {
  const q = tableFilter.value.trim().toLowerCase()
  return q ? tables.value.filter((t) => t.toLowerCase().includes(q)) : tables.value
})
const activeTable = ref<string | null>(null)
const columns = ref<string[]>([])
const columnInfo = ref<ColInfo[]>([])
const primaryKeys = ref<string[]>([])
const rows = ref<Row[]>([])
const total = ref(0)
const page = ref(0)
const PAGE_SIZE = 15
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const tableWrap = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
// 列宽拖拽
const DEFAULT_COL_WIDTH = 160
const colWidths = ref<Record<string, number>>({})
let dragState: { name: string; startX: number; startW: number } | null = null

function colStyle(name: string): Record<string, string> {
  const w = colWidths.value[name]
  return w ? { width: `${w}px` } : {}
}

function onColMouseDown(e: MouseEvent, name: string): void {
  e.preventDefault()
  e.stopPropagation()
  dragState = {
    name,
    startX: e.clientX,
    startW: (e.currentTarget as HTMLElement).closest('th')?.offsetWidth ?? DEFAULT_COL_WIDTH
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onColMouseMove)
  window.addEventListener('mouseup', onColMouseUp)
}

function onColMouseMove(e: MouseEvent): void {
  if (!dragState) return
  const w = Math.max(48, dragState.startW + e.clientX - dragState.startX)
  colWidths.value = { ...colWidths.value, [dragState.name]: w }
}

function onColMouseUp(): void {
  dragState = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onColMouseMove)
  window.removeEventListener('mouseup', onColMouseUp)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onColMouseMove)
  window.removeEventListener('mouseup', onColMouseUp)
})

// SQL 结果懒加载：数据一次性返回，DOM 分批挂载
const SQL_PAGE = 60
const sqlRenderCount = ref(SQL_PAGE)
const sqlVisibleRows = computed(() => sqlRows.value.slice(0, sqlRenderCount.value))
const sqlHasMore = computed(() => sqlRenderCount.value < sqlRows.value.length)
// 按字段搜索
const searchColumn = ref<string | null>(null)
const searchKeyword = ref('')
const columnOptions = computed(() => columns.value.map((c) => ({ label: c, value: c })))

function currentSearch(): { column: string; keyword: string } | undefined {
  return searchColumn.value && searchKeyword.value.trim()
    ? { column: searchColumn.value, keyword: searchKeyword.value.trim() }
    : undefined
}
const tableLoading = ref(false)
const sqlRunning = ref(false)

// SQL 编辑器
const sql = ref('')
const sqlColumns = ref<string[]>([])
const sqlRows = ref<Row[]>([])
const sqlMode = ref(false)

// 新增 / 编辑弹窗
const formShow = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const formSaving = ref(false)
const fields = ref<FieldState[]>([])
const editPk = ref<{ name: string; value: unknown }[]>([])

function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

async function loadTables(): Promise<void> {
  tables.value = await window.mook.db.tables()
  if (tables.value[0]) await loadTable(tables.value[0])
}

async function loadTable(table: string, targetPage = 0, resetSearch = true): Promise<void> {
  sqlMode.value = false
  activeTable.value = table
  page.value = targetPage
  colWidths.value = {}
  if (resetSearch) {
    searchKeyword.value = ''
    searchColumn.value = null
  }
  tableLoading.value = true
  try {
    const r = await window.mook.db.rows(
      table,
      PAGE_SIZE,
      targetPage * PAGE_SIZE,
      currentSearch()
    )
    columns.value = r.columns
    columnInfo.value = r.columnInfo
    primaryKeys.value = r.primaryKeys
    rows.value = r.rows
    total.value = r.total
  } catch (e) {
    message.error(String(e))
  } finally {
    tableLoading.value = false
  }
}

function gotoPage(p: number): void {
  if (!activeTable.value || p < 0 || p >= totalPages.value) return
  void loadTable(activeTable.value, p, false)
}

// SQL 结果一次性返回，滚动到底时再挂载下一批 DOM
useInfiniteScroll(
  sentinel,
  () => {
    sqlRenderCount.value += SQL_PAGE
  },
  {
    root: () => tableWrap.value,
    canLoad: () => sqlMode.value && sqlHasMore.value,
    margin: '300px 0px'
  }
)

async function refresh(): Promise<void> {
  if (activeTable.value) await loadTable(activeTable.value, page.value, false)
}

function runSearch(): void {
  if (!activeTable.value) return
  void loadTable(activeTable.value, 0, false)
}

function onSearchColumnChange(v: string | null): void {
  searchColumn.value = v
  if (searchKeyword.value.trim()) runSearch()
}

function clearSearch(): void {
  searchKeyword.value = ''
  searchColumn.value = null
  void refresh()
}

function toFieldState(name: string, v: unknown, info: ColInfo | undefined): FieldState {
  const isNull = v === null || v === undefined
  return {
    name,
    type: info?.type ?? '',
    isNull,
    value: isNull ? '' : cellText(v)
  }
}

function openAdd(): void {
  if (!activeTable.value) return
  formMode.value = 'add'
  editPk.value = []
  fields.value = columnInfo.value.map((c) => {
    const f = toFieldState(c.name, null, c)
    // 文本主键 id 预填 UUID，省去手填
    if (c.pk > 0 && c.name === 'id' && /TEXT|VARCHAR|CHAR/i.test(c.type || 'TEXT')) {
      f.isNull = false
      f.value = crypto.randomUUID()
    }
    return f
  })
  formShow.value = true
}

function openEdit(rowIndex: number): void {
  if (!primaryKeys.value.length) {
    message.warning('该表没有主键，无法编辑，可用 SQL 修改')
    return
  }
  const row = rows.value[rowIndex]
  formMode.value = 'edit'
  editPk.value = primaryKeys.value.map((name) => ({ name, value: row[name] }))
  fields.value = columns.value.map((c) =>
    toFieldState(c, row[c], columnInfo.value.find((ci) => ci.name === c))
  )
  formShow.value = true
}

function collectValues(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const f of fields.value) out[f.name] = f.isNull ? null : f.value
  return out
}

async function saveForm(): Promise<void> {
  if (!activeTable.value) return
  const values = collectValues()
  formSaving.value = true
  try {
    if (formMode.value === 'add') {
      // 新增：跳过未填且无默认值约束要求外的 NULL 字段，让 DEFAULT 生效
      const payload: Record<string, string | null> = {}
      for (const f of fields.value) {
        if (f.isNull && f.value === '') {
          const info = columnInfo.value.find((c) => c.name === f.name)
          if (info?.defaultValue !== null) continue // 交给数据库默认值
        }
        payload[f.name] = values[f.name]
      }
      await window.mook.db.insert(activeTable.value, payload)
      message.success('已新增一行')
    } else {
      // 编辑：逐字段 UPDATE（参数化，主键定位）
      for (const f of fields.value) {
        await window.mook.db.updateCell(
          activeTable.value,
          f.name,
          values[f.name],
          editPk.value
        )
      }
      message.success('已更新')
    }
    formShow.value = false
    await refresh()
  } catch (e) {
    message.error('保存失败：' + String(e))
  } finally {
    formSaving.value = false
  }
}

function deleteRow(rowIndex: number): void {
  if (!activeTable.value || !primaryKeys.value.length) {
    message.warning('该表没有主键，无法删除，可用 SQL 删除')
    return
  }
  const row = rows.value[rowIndex]
  const pk = primaryKeys.value.map((name) => ({ name, value: row[name] }))
  const label = cellText(row[primaryKeys.value[0]])
  dialog.warning({
    title: '删除该行',
    content: `确定从 ${activeTable.value} 删除主键为「${label}」的行吗？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await window.mook.db.deleteRow(activeTable.value!, pk)
        message.success('已删除')
        await refresh()
      } catch (e) {
        message.error('删除失败：' + String(e))
      }
    }
  })
}

async function runSql(): Promise<void> {
  const text = sql.value.trim()
  if (!text) return
  sqlRunning.value = true
  try {
    const r = await window.mook.db.exec(text)
    sqlMode.value = true
    sqlColumns.value = r.columns
    sqlRows.value = r.rows
    sqlRenderCount.value = SQL_PAGE
    colWidths.value = {}
    if (r.columns.length) {
      message.success(`查询完成，${r.rows.length} 行`)
    } else {
      message.success(`执行成功，影响 ${r.changes} 行`)
      if (activeTable.value) await loadTable(activeTable.value)
    }
  } catch (e) {
    message.error('SQL 错误：' + String(e))
  } finally {
    sqlRunning.value = false
  }
}

const shownColumns = computed(() => (sqlMode.value ? sqlColumns.value : columns.value))
const shownRows = computed(() => (sqlMode.value ? sqlVisibleRows.value : rows.value))

onMounted(loadTables)
</script>

<template>
  <div class="page">
    <div class="head">
      <h2 class="title">数据库</h2>
      <NButton size="small" quaternary @click="router.push('/settings')">返回设置</NButton>
    </div>

    <div class="body">
      <!-- 左侧表列表（支持筛选） -->
      <aside class="sidebar">
        <div class="side-title">数据表（{{ tables.length }}）</div>
        <div class="side-filter">
          <NInput
            v-model:value="tableFilter"
            size="small"
            clearable
            :bordered="false"
            placeholder="筛选表名"
          />
        </div>
        <div class="table-list">
          <button
            v-for="t in filteredTables"
            :key="t"
            type="button"
            class="table-item"
            :class="{ on: !sqlMode && activeTable === t }"
            @click="loadTable(t)"
          >
            {{ t }}
          </button>
          <div v-if="!filteredTables.length" class="side-empty">没有匹配的表</div>
        </div>
      </aside>

      <!-- 右侧内容 -->
      <section class="main">
        <div class="sql-box">
          <NInput
            v-model:value="sql"
            type="textarea"
            size="small"
            :rows="3"
            placeholder="输入 SQL，如：SELECT * FROM movies LIMIT 50；Ctrl+Enter 执行"
            class="sql-input"
            @keydown.ctrl.enter="runSql"
          />
          <div class="sql-actions">
            <span class="sql-hint">Ctrl+Enter 执行</span>
            <NButton size="small" type="primary" :loading="sqlRunning" @click="runSql">
              运行
            </NButton>
            <NButton size="small" @click="activeTable && loadTable(activeTable)">
              查看表数据
            </NButton>
          </div>
        </div>

        <div class="meta-row">
          <template v-if="sqlMode">SQL 结果（{{ sqlRows.length }} 行）</template>
          <template v-else-if="activeTable">
            <div class="meta-left">
              {{ activeTable }} · 共 {{ total }} 行
              <span v-if="!primaryKeys.length" class="warn">（无主键，不可增删改）</span>
            </div>
            <div class="meta-search">
              <NSelect
                :value="searchColumn"
                :options="columnOptions"
                size="tiny"
                placeholder="选择字段"
                clearable
                filterable
                class="search-col"
                @update:value="onSearchColumnChange"
              />
              <NInput
                v-model:value="searchKeyword"
                size="tiny"
                placeholder="字段值（模糊）"
                clearable
                class="search-kw"
                :disabled="!searchColumn"
                @keyup.enter="runSearch"
                @clear="clearSearch"
              />
              <NButton size="tiny" :disabled="!searchColumn" @click="runSearch">搜索</NButton>
            </div>
            <div class="meta-actions">
              <NButton size="tiny" type="primary" :disabled="!primaryKeys.length" @click="openAdd">
                新增一行
              </NButton>
              <NButton size="tiny" @click="refresh">刷新</NButton>
            </div>
          </template>
        </div>

        <NSpin :show="tableLoading" class="spin-wrap">
          <div ref="tableWrap" class="table-wrap">
            <table class="grid">
              <colgroup>
                <col class="idx" />
                <col v-if="!sqlMode && primaryKeys.length" class="ops" />
                <col v-for="c in shownColumns" :key="c" :style="colStyle(c)" />
              </colgroup>
              <thead>
                <tr>
                  <th class="idx">#</th>
                  <th v-if="!sqlMode && primaryKeys.length" class="ops">操作</th>
                  <th v-for="c in shownColumns" :key="c">
                    <span class="th-label">{{ c }}</span>
                    <span class="col-resize" @mousedown="onColMouseDown($event, c)"></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in shownRows" :key="i">
                  <td class="idx">{{ i + 1 }}</td>
                  <td v-if="!sqlMode && primaryKeys.length" class="ops">
                    <button type="button" class="row-btn" @click="openEdit(i)">编辑</button>
                    <button type="button" class="row-btn danger" @click="deleteRow(i)">删除</button>
                  </td>
                  <td
                    v-for="c in shownColumns"
                    :key="c"
                    class="cell"
                    :title="cellText(row[c])"
                    @dblclick="!sqlMode && openEdit(i)"
                  >
                    <span :class="{ nullv: row[c] === null || row[c] === undefined }">
                      {{ cellText(row[c]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!shownRows.length" class="empty">暂无数据</div>
            <div v-if="sqlMode && sqlHasMore" ref="sentinel" class="sentinel">
              滚动加载更多…（已显示 {{ sqlRenderCount }} / {{ sqlRows.length }}）
            </div>
          </div>
        </NSpin>

        <!-- 分页（仅表浏览模式） -->
        <div v-if="!sqlMode && totalPages > 1" class="pager">
          <NButton size="tiny" :disabled="page <= 0" @click="gotoPage(page - 1)">上一页</NButton>
          <span class="pg">{{ page + 1 }} / {{ totalPages }}</span>
          <NButton size="tiny" :disabled="page >= totalPages - 1" @click="gotoPage(page + 1)">
            下一页
          </NButton>
        </div>
      </section>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <NModal
      :show="formShow"
      preset="card"
      :title="formMode === 'add' ? `新增一行 · ${activeTable}` : `编辑一行 · ${activeTable}`"
      :style="{ width: '680px' }"
      @update:show="(v) => (formShow = v)"
    >
      <div class="form-list">
        <div v-for="f in fields" :key="f.name" class="form-field">
          <div class="ff-label">
            <span class="ff-name" :class="{ pk: columnInfo.find((c) => c.name === f.name)?.pk }">
              {{ f.name }}
              <em v-if="f.type" class="ff-type">{{ f.type }}</em>
            </span>
            <NCheckbox v-model:checked="f.isNull" size="small">NULL</NCheckbox>
          </div>
          <NInput
            v-model:value="f.value"
            type="textarea"
            size="small"
            :rows="2"
            :disabled="formMode === 'edit' && primaryKeys.includes(f.name)"
            :placeholder="f.isNull ? '（NULL）' : '输入值，数字/JSON 按文本写入，由数据库转换'"
          />
        </div>
      </div>
      <template #footer>
        <div class="form-foot">
          <span class="ff-hint">空值勾选 NULL；有默认值的字段新增时留空则使用默认值</span>
          <NButton size="small" @click="formShow = false">取消</NButton>
          <NButton size="small" type="primary" :loading="formSaving" @click="saveForm">
            保存
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 24px 20px;
}
.head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.title {
  font-size: 18px;
  color: var(--text-strong);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}
.sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
}
.side-title {
  padding: 10px 12px;
  font-size: 12px;
  color: #9aa0aa;
  border-bottom: 1px solid #f0f1f4;
  flex-shrink: 0;
}
.side-filter {
  padding: 6px 8px;
  border-bottom: 1px solid #f0f1f4;
  background: #fafbfc;
  flex-shrink: 0;
}
.side-filter :deep(.n-input) {
  background: transparent;
}
.table-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.side-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: #b0b5bd;
  text-align: center;
}
.table-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  font-size: 13px;
  color: #3a3f45;
  cursor: pointer;
}
.table-item:hover {
  background: #f4f5f7;
}
.table-item.on {
  background: var(--accent);
  color: var(--on-accent);
}
.main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: var(--surface);
  padding: 12px;
}
.sql-box {
  flex-shrink: 0;
  margin-bottom: 10px;
}
.sql-input {
  font-family: 'Cascadia Code', Consolas, monospace;
}
.sql-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.sql-hint {
  flex: 1;
  font-size: 11px;
  color: #b0b5bd;
}
.meta-row {
  flex-shrink: 0;
  font-size: 12px;
  color: #7a808a;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.meta-search {
  flex: 1;
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0 12px;
}
.search-col {
  width: 150px;
}
.search-kw {
  width: 180px;
}
.meta-actions {
  display: flex;
  gap: 6px;
}
.warn {
  color: #d03050;
}
.spin-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.spin-wrap :deep(.n-spin-container),
.spin-wrap :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #eef0f4;
  border-radius: 8px;
}
.grid {
  border-collapse: collapse;
  font-size: 12.5px;
  white-space: nowrap;
  width: 100%;
  table-layout: fixed;
}
.grid th,
.grid td {
  padding: 6px 10px;
  border-bottom: 1px solid #f0f1f4;
  border-right: 1px solid #f5f6f8;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid th {
  position: sticky;
  top: 0;
  background: #f7f8fa;
  font-weight: 600;
  color: #5b616c;
  z-index: 1;
}
.th-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 8px;
}
.col-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
}
.col-resize:hover,
.col-resize:active {
  border-right: 2px solid var(--accent, #2563eb);
}
.idx {
  color: #b0b5bd;
  text-align: right;
  width: 48px;
}
.ops {
  white-space: nowrap;
  width: 104px;
}
.row-btn {
  border: none;
  background: transparent;
  color: #3b5bff;
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
}
.row-btn:hover {
  text-decoration: underline;
}
.row-btn.danger {
  color: #d03050;
}
.cell {
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell:hover {
  background: #fafbfc;
}
.nullv {
  color: #b0b5bd;
  font-style: italic;
}
.empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: #9aa0aa;
}
.sentinel {
  padding: 10px 0;
  text-align: center;
  font-size: 12px;
  color: #a8adb8;
}
.pager {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
}
.pg {
  font-size: 12.5px;
  color: #5b616c;
}
/* 弹窗表单 */
.form-list {
  max-height: 62vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ff-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ff-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #3a3f45;
}
.ff-name.pk {
  color: var(--text-strong);
}
.ff-name.pk::after {
  content: ' 🔑';
  font-size: 11px;
}
.ff-type {
  font-style: normal;
  font-weight: 400;
  color: #b0b5bd;
  font-size: 11px;
  margin-left: 4px;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ff-hint {
  flex: 1;
  font-size: 11.5px;
  color: #b0b5bd;
}
</style>
