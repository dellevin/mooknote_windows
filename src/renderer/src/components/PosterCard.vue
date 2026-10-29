<script setup lang="ts">
import { computed } from 'vue'
import type { Movie } from '@shared/types'
import { MOVIE_STATUS_LABELS } from '@shared/types'
import { toImgUrl, yearOf } from '@/utils/image'

const props = withDefaults(
  defineProps<{ movie: Movie; selectMode?: boolean; selected?: boolean }>(),
  { selectMode: false, selected: false }
)
const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'toggle', id: string): void
}>()

const posterUrl = computed(() => toImgUrl(props.movie.posterPath))
const year = computed(() => yearOf(props.movie.releaseDate))

function onClick(): void {
  if (props.selectMode) emit('toggle', props.movie.id)
  else emit('open', props.movie.id)
}
</script>

<template>
  <div
    class="card"
    :class="{ picking: selectMode, on: selected }"
    @click="onClick"
  >
    <span v-if="selectMode" class="pick-box" :class="{ on: selected }">
      <svg v-if="selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </span>
    <div class="poster">
      <img v-if="posterUrl" :src="posterUrl" loading="lazy" />
      <div v-else class="placeholder">
        <span>{{ movie.title.slice(0, 1) }}</span>
      </div>
      <span class="status-tag">{{ MOVIE_STATUS_LABELS[movie.status] }}</span>
      <span v-if="movie.rating != null" class="rating">★ {{ movie.rating.toFixed(1) }}</span>
    </div>
    <div class="meta">
      <div class="title" :title="movie.title">{{ movie.title }}</div>
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
.card.picking .poster {
  transform: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.card.picking {
  cursor: pointer;
}
.card.on .poster {
  outline: 3px solid #1f2329;
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
  background: #1f2329;
  border-color: #1f2329;
}
.poster {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: #e9ebf0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.card:hover .poster {
  transform: translateY(-3px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}
.poster img {
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
  color: #1f2329;
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
