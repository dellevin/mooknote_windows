<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { mountBlockBehavior } from './vditor-blocks'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const host = ref<HTMLElement | null>(null)
let vd: Vditor | null = null
let disposeBlocks: (() => void) | null = null

// 正文不接受图片文件：粘贴/拖入一律拦截（仍支持手打 ![](url)）
function hasImageFile(data: DataTransfer | null): boolean {
  if (!data?.files?.length) return false
  return Array.from(data.files).some((f) => f.type.startsWith('image/'))
}
function onPaste(e: Event): void {
  if (hasImageFile((e as ClipboardEvent).clipboardData)) {
    e.stopPropagation()
    e.preventDefault()
  }
}
function onDrop(e: Event): void {
  if (hasImageFile((e as DragEvent).dataTransfer)) {
    e.stopPropagation()
    e.preventDefault()
  }
}

onMounted(() => {
  vd = new Vditor(host.value as HTMLElement, {
    mode: 'wysiwyg',
    theme: 'classic',
    height: '100%',
    value: props.modelValue,
    placeholder: '用 Markdown 记录，所见即所得…',
    cache: { enable: false },
    // Vditor 默认把正文限制在 800px 居中、两侧留大片白；放大到铺满，只保留最小边距
    preview: { maxWidth: 99999 },
    // 纯净编辑：不显示任何工具栏
    toolbar: [],
    input: (val: string) => emit('update:modelValue', val),
    after: () => {
      host.value?.addEventListener('paste', onPaste, true)
      host.value?.addEventListener('drop', onDrop, true)
      if (host.value) disposeBlocks = mountBlockBehavior(vd as Vditor, host.value)
    }
  })
})

onBeforeUnmount(() => {
  disposeBlocks?.()
  disposeBlocks = null
  host.value?.removeEventListener('paste', onPaste, true)
  host.value?.removeEventListener('drop', onDrop, true)
  vd?.destroy()
  vd = null
})
</script>

<template>
  <div ref="host" class="wysiwyg-host"></div>
</template>

<style scoped>
/* Vditor 会给宿主自身加 .vditor 类：去自带边框/灰底，与白色面板融为一体 */
.wysiwyg-host {
  flex: 1;
  min-height: 0;
  height: 100%;
  border: none !important;
  border-radius: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
}
.wysiwyg-host :deep(.vditor-content),
.wysiwyg-host :deep(.vditor-wysiwyg),
.wysiwyg-host :deep(.vditor-wysiwyg pre.vditor-reset) {
  border: none !important;
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.wysiwyg-host :deep(.vditor-reset) {
  font-size: 15px;
  line-height: 1.6;
  color: #2f3540;
}
/* Vditor 默认每个段落 <p> 带 16px 下边距，回车换行被撑出一整行空隙，压到 4px */
.wysiwyg-host :deep(.vditor-reset p) {
  margin-bottom: 4px;
}
/* Vditor 即便放大 maxWidth 仍强制至少 35px 横向内边距（JS 内联），
   清零使正文与标题、标签同左缘；纵向保留 10px。 */
.wysiwyg-host :deep(.vditor-wysiwyg pre.vditor-reset) {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/* 去掉块左缘的“块标记/块菜单”（悬停标题/代码块等时出现的 H1 等小标，
   点击会弹上移/下移/删除菜单）。content:none 连其负 margin 点击热区一起消除。
   不影响列表项目符号、待办框、引用竖条等其它 :before。 */
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h1):before,
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h2):before,
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h3):before,
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h4):before,
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h5):before,
.wysiwyg-host :deep(.vditor-wysiwyg > .vditor-reset > h6):before,
.wysiwyg-host :deep(.vditor-wysiwyg div.vditor-wysiwyg__block):before,
.wysiwyg-host :deep(.vditor-wysiwyg div[data-type='link-ref-defs-block']):before,
.wysiwyg-host :deep(.vditor-wysiwyg div[data-type='footnotes-block']):before,
.wysiwyg-host :deep(.vditor-wysiwyg .vditor-toc):before {
  content: none !important;
  display: none !important;
}

/* 彻底去掉光标进入段落/标题/列表项等顶层块时，浮在该行旁的“上移/下移/删除”
   块操作浮层（Vditor 把 [data-type=up/down/remove] 按钮插入 wysiwyg.popover）。
   部分块（标题/脚注块等）的浮层只有一个 remove 垃圾桶按钮，删除相邻行后
   浮层不会自动收起而残留在上一行上方，三种按钮都要兜住。
   链接/脚注引用等浮层内含 input，不含这些按钮，不受影响。 */
.wysiwyg-host :deep(.vditor-wysiwyg .vditor-panel:has([data-type='up'])),
.wysiwyg-host :deep(.vditor-wysiwyg .vditor-panel:has([data-type='down'])),
.wysiwyg-host :deep(.vditor-wysiwyg .vditor-panel:has([data-type='remove'])) {
  display: none !important;
}
</style>
