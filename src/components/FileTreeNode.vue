<script setup>
import { computed, ref } from 'vue';
import { resolveSetiIcon } from '../utils/seti-icons.js';

const props = defineProps({
  node: {
    type: Object,
    required: true
  },
  activeFilePath: {
    type: String,
    default: ''
  },
  depth: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['select-node', 'node-menu']);
const collapsedByDefault = new Set(['node_modules', 'dist', 'build', 'release', 'coverage', '.git', '.next', '.nuxt', '.vscode', '.github', 'vendor', '.cache', '.turbo', '__pycache__']);
const expanded = ref(!collapsedByDefault.has(props.node.name));

const isDirectory = computed(() => props.node.type === 'directory');
const isActive = computed(() => props.activeFilePath === props.node.path);
const rowStyle = computed(() => ({
  '--tree-depth': props.depth
}));

const setiIcon = computed(() => resolveSetiIcon(props.node.name));
const setiIconStyle = computed(() => ({
  '--seti-icon': setiIcon.value.glyph,
  '--seti-color': setiIcon.value.color
}));

function openNode() {
  if (isDirectory.value) {
    expanded.value = !expanded.value;
    return;
  }

  emit('select-node', props.node);
}

function openMenu(event) {
  event.preventDefault();
  emit('node-menu', {
    node: props.node,
    x: event.clientX,
    y: event.clientY
  });
}
</script>

<template>
  <div class="tree-node">
    <button
      type="button"
      class="tree-node__label"
      :class="{ 'is-active': isActive }"
      :style="rowStyle"
      @click="openNode"
      @contextmenu="openMenu"
    >
      <span
        class="tree-node__twistie"
        :class="{ 'is-empty': !isDirectory }"
      >
        <span
          v-if="isDirectory"
          class="codicon"
          :class="expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        ></span>
      </span>
      <span
        v-if="isDirectory"
        class="tree-node__icon tree-node__folder codicon"
        :class="expanded ? 'codicon-folder-opened' : 'codicon-folder'"
      ></span>
      <span v-else class="tree-node__icon seti-icon" :style="setiIconStyle"></span>
      <span class="tree-node__name">{{ node.name }}</span>
    </button>

    <div v-if="isDirectory && expanded" class="tree-node__children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :active-file-path="activeFilePath"
        :depth="depth + 1"
        @select-node="$emit('select-node', $event)"
        @node-menu="$emit('node-menu', $event)"
      />
    </div>
  </div>
</template>
