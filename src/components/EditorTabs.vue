<script setup>
import { ref, computed } from 'vue';
import { resolveSetiIcon } from '../utils/seti-icons.js';
import { t } from '../utils/i18n.js';
import ContextMenu from './ContextMenu.vue';

const props = defineProps({
  openFiles: {
    type: Array,
    default: () => []
  },
  activeFilePath: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['select', 'close', 'close-others', 'close-all', 'close-saved', 'reveal-in-explorer', 'copy-path', 'copy-relative-path']);

const contextMenu = ref({ visible: false, x: 0, y: 0, filePath: '' });

function iconStyle(name) {
  const icon = resolveSetiIcon(name);
  return {
    '--seti-icon': icon.glyph,
    '--seti-color': icon.color
  };
}

function onContextMenu(event, file) {
  event.preventDefault();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    filePath: file.path
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
}

const contextMenuItems = computed(() => [
  { id: 'close', label: t('closeTab'), shortcut: 'Ctrl+W', action: () => emit('close', contextMenu.value.filePath) },
  { id: 'close-others', label: t('closeOthers'), action: () => emit('close-others', contextMenu.value.filePath) },
  { id: 'close-saved', label: t('closeSaved'), action: () => emit('close-saved') },
  { id: 'close-all', label: t('closeAll'), action: () => emit('close-all') },
  { separator: true },
  { id: 'copy-path', label: t('copyPath'), action: () => emit('copy-path', contextMenu.value.filePath) },
  { id: 'copy-relative', label: t('copyRelativePath'), action: () => emit('copy-relative-path', contextMenu.value.filePath) },
  { separator: true },
  { id: 'reveal', label: t('revealInExplorer'), action: () => emit('reveal-in-explorer', contextMenu.value.filePath) }
]);

function handleContextSelect(item) {
  item.action?.();
}
</script>

<template>
  <div class="editor-tabs">
    <div
      v-for="file in openFiles"
      :key="file.path"
      class="editor-tab"
      :class="{ 'is-active': file.path === activeFilePath }"
      @contextmenu="onContextMenu($event, file)"
    >
      <button class="editor-tab__label" @click="$emit('select', file.path)">
        <span class="editor-tab__icon seti-icon" :style="iconStyle(file.name)"></span>
        <span class="editor-tab__name">{{ file.name }}</span>
        <span v-if="file.dirty" class="editor-tab__dirty"></span>
      </button>
      <button class="editor-tab__close codicon codicon-close" @click="$emit('close', file.path)"></button>
    </div>
    <div v-if="openFiles.length === 0" class="editor-tab editor-tab--placeholder">{{ t('noOpenFiles') }}</div>

    <ContextMenu
      v-if="contextMenu.visible"
      :items="contextMenuItems"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @close="closeContextMenu"
      @select="handleContextSelect"
    />
  </div>
</template>
