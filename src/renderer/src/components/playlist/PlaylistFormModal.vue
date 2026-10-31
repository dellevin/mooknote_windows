<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  NModal,
  NButton,
  NSpace,
  NInput,
  NForm,
  NFormItem,
  NSelect,
  useMessage
} from 'naive-ui'
import type { Playlist, PlaylistInput, PlaylistType } from '@shared/types'
import { PLAYLIST_TYPE_LABELS } from '@shared/types'

const props = defineProps<{ show: boolean; playlist: Playlist | null }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', playlist: Playlist): void
}>()

const message = useMessage()
const saving = ref(false)
const form = ref({ id: '', name: '', description: '', type: 'movie' as PlaylistType })

const typeOptions = Object.entries(PLAYLIST_TYPE_LABELS).map(([value, label]) => ({
  label,
  value: value as PlaylistType
}))

watch(
  () => props.show,
  async (s) => {
    if (!s) return
    if (props.playlist) {
      const p = props.playlist
      form.value = { id: p.id, name: p.name, description: p.description, type: p.type }
    } else {
      form.value = {
        id: await window.mook.playlist.newId(),
        name: '',
        description: '',
        type: 'movie'
      }
    }
  }
)

async function save(): Promise<void> {
  if (!form.value.name.trim()) {
    message.warning('请填写片单名称')
    return
  }
  const payload: PlaylistInput = {
    id: form.value.id,
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    type: form.value.type,
    coverPath: null
  }
  saving.value = true
  try {
    const saved = props.playlist
      ? await window.mook.playlist.update(payload)
      : await window.mook.playlist.create(payload)
    emit('saved', saved)
    emit('update:show', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)" :auto-focus="false">
    <div class="editor">
      <h3>{{ props.playlist ? '编辑片单' : '新建片单' }}</h3>
      <NForm label-placement="top" size="small">
        <NFormItem label="名称">
          <NInput v-model:value="form.name" placeholder="片单名称" />
        </NFormItem>
        <NFormItem label="类型">
          <NSelect
            v-model:value="form.type"
            :options="typeOptions"
            :disabled="!!props.playlist"
          />
        </NFormItem>
        <NFormItem label="描述">
          <NInput
            v-model:value="form.description"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 5 }"
          />
        </NFormItem>
      </NForm>
      <div class="editor-footer">
        <NSpace justify="end">
          <NButton @click="emit('update:show', false)">取消</NButton>
          <NButton type="primary" :loading="saving" @click="save">保存</NButton>
        </NSpace>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.editor {
  width: 480px;
  max-width: 92vw;
  background: var(--surface);
  border-radius: 14px;
  padding: 20px 24px;
}
.editor h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.editor-footer {
  margin-top: 8px;
}
</style>
