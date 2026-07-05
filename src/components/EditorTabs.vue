<script setup>
import { resolveSetiIcon } from '../utils/seti-icons.js';
import { t } from '../utils/i18n.js';

defineProps({
  openFiles: {
    type: Array,
    default: () => []
  },
  activeFilePath: {
    type: String,
    default: ''
  }
});

defineEmits(['select', 'close']);

function iconStyle(name) {
  const icon = resolveSetiIcon(name);
  return {
    '--seti-icon': icon.glyph,
    '--seti-color': icon.color
  };
}
</script>

<template>
  <div class="editor-tabs">
    <div
      v-for="file in openFiles"
      :key="file.path"
      class="editor-tab"
      :class="{ 'is-active': file.path === activeFilePath }"
    >
      <button class="editor-tab__label" @click="$emit('select', file.path)">
        <span class="editor-tab__icon seti-icon" :style="iconStyle(file.name)"></span>
        <span class="editor-tab__name">{{ file.name }}</span>
        <span v-if="file.dirty" class="editor-tab__dirty"></span>
      </button>
      <button class="editor-tab__close codicon codicon-close" @click="$emit('close', file.path)"></button>
    </div>
    <div v-if="openFiles.length === 0" class="editor-tab editor-tab--placeholder">{{ t('noOpenFiles') }}</div>
  </div>
</template>
