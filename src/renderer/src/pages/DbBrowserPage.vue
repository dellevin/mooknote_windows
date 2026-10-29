<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NInput, NSpin, useMessage } from 'naive-ui'

type Row = Record<string, unknown>

const router = useRouter()
const message = useMessage()

const tables = ref<string[]>([])
const activeTable = ref<string | null>(null)
const columns = ref<string[]>([])
const primaryKeys = ref<string[]>([])
const rows = ref<Row[]>([])
const total = ref(0)
const tableLoading = ref(false)
const sqlRunning = ref(false)

// SQL 编辑器
const sql = ref('')
const sqlColumns = ref<string[]>([])
const sqlRows = ref<Row[]>([])
const sqlMode = ref(false)

// 单元格编辑：{row index, column}
const editing = ref<{ row: number; col: string } | null>(null)
const editValue = ref('')

function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

async function loadTables(): Promise<void> {
  tables.value = await window.mook.db.tables()
  if (tables.value[0]) await loadTable(tables.value[0])
}

async function loadTable(table: string): Promise<void> {
  sqlMode.value = false
  activeTable.value = table
  tableLoading.value = true
  try {
    const r = await window.mook.db.rows(table, 200)
    columns.value = r.columns
    primaryKeys.value = r.primaryKeys
    rows.value = r.rows
    total.value = r.total
  } catch (e) {
    message.error(String(e))
  } finally {
    tableLoading.value = false
  }
}

function startEdit(row: number, col: string): void {
  if (sqlMode.value || !primaryKeys.value.length) {
    if (!primaryKeys.value.length) message.warning('该表没有主键，无法直接编辑，可用 SQL 修改')
    return
  }
  editing.value = { row, col }
  const v = rows.value[row][col]
  editValue.value = v === null || v === undefined ? '' : cellText(v)
}

async function commitEdit(): Promise<void> {
  if (!editing.value || !activeTable.value) {
    editing.value = null
    return
  }
  const { row, col } = editing.value
  const pk = primaryKeys.value.map((name) => ({ name, value: rows.value[row][name] }))
  try {
    await window.mook.db.updateCell(activeTable.value, col, editValue.value, pk)
    message.success('已更新')
    editing.value = null
    await loadTable(activeTable.value)
  } catch (e) {
    message.error('更新失败：' + String(e))
  }
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

const shownColumns = () => (sqlMode.value ? sqlColumns.value : columns.value)
const shownRows = () => (sqlMode.value ? sqlRows.value : rows.value)

onMounted(loadTables)
</script>

<template>
  <div class="page">
    <div class="head">
      <h2 class="title">数据库</h2>
      <NButton size="small" quaternary @click="router.push('/settings')">返回设置</NButton>
    </div>

    <div class="body">
      <!-- 左侧表列表 -->
      <aside class="sidebar">
        <div class="side-title">数据表（{{ tables.length }}）</div>
        <div class="table-list">
          <button
            v-for="t in tables"
            :key="t"
            type="button"
            class="table-item"
            :class="{ on: !sqlMode && activeTable === t }"
            @click="loadTable(t)"
          >
            {{ t }}
          </button>
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
            placeholder="输入 SQL，如：SELECT * FROM movies LIMIT 50；双击单元格可直接编辑（仅限有主键的表）"
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
            {{ activeTable }} · 共 {{ total }} 行，最多显示前 200 行
            <span v-if="!primaryKeys.length" class="warn">（无主键，不可双击编辑）</span>
          </template>
        </div>

        <NSpin :show="tableLoading">
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th class="idx">#</th>
                  <th v-for="c in shownColumns()" :key="c">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in shownRows()" :key="i">
                  <td class="idx">{{ i + 1 }}</td>
                  <td
                    v-for="c in shownColumns()"
                    :key="c"
                    class="cell"
                    :title="cellText(row[c])"
                    @dblclick="startEdit(i, c)"
                  >
                    <input
                      v-if="editing && editing.row === i && editing.col === c"
                      v-model="editValue"
                      class="cell-input"
                      autofocus
                      @keydown.enter.prevent="commitEdit"
                      @keydown.esc="editing = null"
                      @blur="commitEdit"
                    />
                    <span v-else :class="{ nullv: row[c] === null || row[c] === undefined }">
                      {{ cellText(row[c]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!shownRows().length" class="empty">暂无数据</div>
          </div>
        </NSpin>
      </section>
    </div>
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
  color: #1f2329;
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
  background: #fff;
  overflow: hidden;
}
.side-title {
  padding: 10px 12px;
  font-size: 12px;
  color: #9aa0aa;
  border-bottom: 1px solid #f0f1f4;
  flex-shrink: 0;
}
.table-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
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
  background: #1f2329;
  color: #fff;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
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
}
.warn {
  color: #d03050;
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
}
.grid th,
.grid td {
  padding: 6px 10px;
  border-bottom: 1px solid #f0f1f4;
  border-right: 1px solid #f5f6f8;
  text-align: left;
  max-width: 320px;
}
.grid th {
  position: sticky;
  top: 0;
  background: #f7f8fa;
  font-weight: 600;
  color: #5b616c;
  z-index: 1;
}
.idx {
  color: #b0b5bd;
  text-align: right;
  max-width: 48px !important;
}
.cell {
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell:hover {
  background: #fafbfc;
}
.cell-input {
  width: 100%;
  min-width: 120px;
  padding: 3px 6px;
  border: 1px solid var(--accent, #1f2329);
  border-radius: 5px;
  font-size: 12.5px;
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
</style>
