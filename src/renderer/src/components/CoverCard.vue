<script setup lang="ts">
import { computed } from 'vue'
import { toImgUrl, yearOf } from '@/utils/image'

const props = withDefaults(
  defineProps<{
    title: string
    coverPath: string | null
    rating: number | null
    statusLabel: string
    date?: string | null
    ratio?: string // CSS aspect-ratio
    initial?: string
    selectMode?: boolean
    selected?: boolean
  }>(),
  { ratio: '3 / 4', date: null, initial: '', selectMode: false, selected: false }
)
const emit = defineEmits<{ (e: 'open'): void; (e: 'toggle'): void }>()

const coverUrl = computed(() => toImgUrl(props.coverPath))
const year = computed(() => yearOf(props.date))

function onClick(): void {
  if (props.selectMode) emit('toggle')
  else emit('open')
}
</script>

<template>
  <div class="card" :class="{ picking: selectMode, on: selected }" @click="onClick">
    <span v-if="selectMode" class="pick-box" :class="{ on: selected }">
      <svg v-if="selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </span>
    <div class="cover" :style="{ aspectRatio: ratio }">
      <img v-if="coverUrl" :src="coverUrl" loading="lazy" />
      <div v-else class="placeholder">
        <span>{{ initial || title.slice(0, 1) }}</span>
      </div>
      <span class="status-tag">{{ statusLabel }}</span>
      <span v-if="rating != null" class="rating">★ {{ rating.toFixed(1) }}</span>
    </div>
    <div class="meta">
      <div class="title" :title="title">{{ title }}</div>
      <div class="sub">{{ year }}</div>
    </div>
  </div>
</template>

<style scoped>
.card {
  cursor: pointer;
  user-select: none;
  position: relative;
}
.card.picking .cover {
  transform: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.card.on .cover {
  outline: 3px solid var(--accent-ink);
  outline-offset: -1px;
}
.pick-box {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.pick-box svg {
  width: 13px;
  height: 13px;
}
.pick-box.on {
  background: var(--accent);
  border-color: var(--text-strong);
  color: var(--on-accent);
}
.cover {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  background: #e9ebf0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.card:hover .cover {
  transform: translateY(-3px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #dfe4f2, #eef0f5);
}
.placeholder span {
  font-size: 40px;
  color: #9aa3b5;
  font-weight: 600;
}
.status-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
}
.rating {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.62);
  color: #ffcf3f;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
}
.meta {
  padding: 8px 4px 2px;
}
.title {
  font-size: 13px;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11px;
  color: #9aa0ac;
  margin-top: 2px;
}
</style>
