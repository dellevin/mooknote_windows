<script setup lang="ts">
defineProps<{ kind: 'movie' | 'book' | 'game'; description: string }>()

const ICON_PATHS: Record<'movie' | 'book' | 'game', string> = {
  movie:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  book:
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  game:
    '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/>'
}
</script>

<template>
  <div class="empty">
    <span class="empty-icon">
      <svg
        class="cat-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        v-html="ICON_PATHS[kind]"
      />
      <span class="x-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </span>
    </span>
    <div class="empty-text">{{ description }}</div>
  </div>
</template>

<style scoped>
.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.empty-icon {
  position: relative;
  display: inline-flex;
  width: 64px;
  height: 56px;
  color: #a8aeb9;
  align-items: center;
  justify-content: center;
}
.cat-icon {
  width: 44px;
  height: 44px;
}
/* 与页面白底同色的圆盖在图标右上角，咬出半圆形缺口，叉坐在缺口里 */
.x-badge {
  position: absolute;
  top: 0;
  right: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a8aeb9;
}
.x-badge svg {
  width: 14px;
  height: 14px;
}
.empty-text {
  font-size: 14px;
  color: #8a909c;
}
</style>
