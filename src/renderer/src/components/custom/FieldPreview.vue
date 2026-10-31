<script setup lang="ts">
import type { CustomFieldDef } from '@shared/types'
import ModuleIcon from './ModuleIcon.vue'

defineProps<{ field: CustomFieldDef }>()
</script>

<template>
  <div class="fp">
    <div v-if="field.type !== 'poster'" class="fp-label">
      <ModuleIcon :icon="field.icon || null" :size="13" class="fp-ic" />
      <span>{{ field.label || '未命名字段' }}</span>
      <span v-if="field.required" class="fp-req">*</span>
      <span v-if="field.isTitle" class="fp-badge">标题</span>
    </div>

    <!-- 封面图 -->
    <div v-if="field.type === 'poster'" class="fp-poster">
      <ModuleIcon :icon="null" :size="26" class="fp-poster-ic" />
      <span>{{ field.label || '封面' }}</span>
    </div>

    <!-- 单行文本 -->
    <div v-else-if="field.type === 'text'" class="fp-input">{{ field.label || '单行文本' }}</div>

    <!-- 长文本 -->
    <div v-else-if="field.type === 'longText'" class="fp-textarea">
      <span class="ln" /><span class="ln w80" /><span class="ln w60" />
    </div>

    <!-- 多文本标签 -->
    <div v-else-if="field.type === 'multiText'" class="fp-tags">
      <span class="fp-tag">标签一</span>
      <span class="fp-tag">标签二</span>
      <span class="fp-tag add">＋</span>
    </div>

    <!-- 状态 -->
    <div v-else-if="field.type === 'status'" class="fp-chips">
      <span
        v-for="(o, i) in (field.options.length ? field.options : ['选项一', '选项二'])"
        :key="o + i"
        class="fp-chip"
        :class="{ on: i === 0 && !field.options.length }"
        >{{ o }}</span
      >
    </div>

    <!-- 评分 -->
    <div v-else-if="field.type === 'rating'" class="fp-stars">
      <span v-for="n in 5" :key="n" class="star" :class="{ on: n <= 4 }">★</span>
    </div>

    <!-- 次数 -->
    <div v-else-if="field.type === 'count'" class="fp-stepper">
      <span class="step">−</span>
      <span class="step-val">0</span>
      <span class="step">＋</span>
    </div>

    <!-- 日期 -->
    <div v-else-if="field.type === 'date'" class="fp-input fp-with-ic">选择日期</div>

    <!-- 时长 -->
    <div v-else-if="field.type === 'duration'" class="fp-input fp-with-ic">时长（分钟）</div>

    <!-- 进度 -->
    <div v-else-if="field.type === 'progress'" class="fp-progress">
      <div class="pg-box">当前</div>
      <span class="pg-sep">/</span>
      <div class="pg-box">总量</div>
    </div>

    <!-- 日期区间 -->
    <div v-else-if="field.type === 'dateRange'" class="fp-progress">
      <div class="pg-box">开始</div>
      <span class="pg-sep">~</span>
      <div class="pg-box">结束</div>
    </div>

    <!-- 多图 -->
    <div v-else-if="field.type === 'multiImage'" class="fp-imgs">
      <div v-for="n in 3" :key="n" class="fp-img" />
      <div class="fp-img add">＋</div>
    </div>
  </div>
</template>

<style scoped>
.fp {
  width: 100%;
}
.fp-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}
.fp-ic {
  color: #8a909c;
}
.fp-req {
  color: #e04f5f;
}
.fp-badge {
  font-size: 10px;
  font-weight: 500;
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 2px;
}
.fp-input {
  height: 34px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 13px;
  color: #b6bac3;
  background: #f7f8fa;
  border: 1px solid #eef0f4;
  border-radius: 9px;
}
.fp-with-ic::after {
  content: '📅';
  margin-left: auto;
  font-size: 13px;
  opacity: 0.5;
}
.fp-textarea {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 12px;
  background: #f7f8fa;
  border: 1px solid #eef0f4;
  border-radius: 9px;
}
.ln {
  height: 7px;
  border-radius: 4px;
  background: #e3e6ec;
}
.w80 {
  width: 80%;
}
.w60 {
  width: 60%;
}
.fp-tags,
.fp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fp-tag,
.fp-chip {
  font-size: 12px;
  color: #4b5563;
  background: #f4f5f8;
  border: 1px solid #eceef2;
  border-radius: 7px;
  padding: 3px 10px;
}
.fp-tag.add {
  color: #9aa0ac;
}
.fp-chip.on {
  color: var(--accent-ink);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--accent-ink) 30%, var(--surface));
}
.fp-stars {
  display: flex;
  gap: 3px;
  font-size: 19px;
}
.star {
  color: #dde0e7;
}
.star.on {
  color: #f7b500;
}
.fp-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.step,
.step-val {
  width: 34px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: #f7f8fa;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  color: #6b7280;
}
.step-val {
  width: 48px;
  color: #374151;
}
.fp-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pg-box {
  flex: 1;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12.5px;
  color: #b6bac3;
  background: #f7f8fa;
  border: 1px solid #eef0f4;
  border-radius: 9px;
}
.pg-sep {
  color: #b6bac3;
}
.fp-poster {
  height: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12.5px;
  color: #a8adba;
  background: #f7f8fa;
  border: 1px dashed #d6d9e0;
  border-radius: 10px;
}
.fp-poster-ic {
  color: #c2c7d2;
}
.fp-imgs {
  display: flex;
  gap: 8px;
}
.fp-img {
  width: 60px;
  height: 60px;
  border-radius: 9px;
  background: #f0f1f5;
  border: 1px solid #e8eaef;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b6bac3;
  font-size: 18px;
}
.fp-img.add {
  background: #fafbfc;
  border-style: dashed;
}
</style>
