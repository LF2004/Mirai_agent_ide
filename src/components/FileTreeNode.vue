<script setup>
import { computed, nextTick, ref, watch } from 'vue';
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
  },
  inlineEdit: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['select-node', 'node-menu', 'inline-confirm', 'inline-cancel']);
const collapsedByDefault = new Set(['node_modules', 'dist', 'build', 'release', 'coverage', '.git', '.next', '.nuxt', '.vscode', '.github', 'vendor', '.cache', '.turbo', '__pycache__']);
const expanded = ref(!collapsedByDefault.has(props.node.name));
const inputValue = ref('');
const inputRef = ref(null);

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

// Is this node currently being renamed?
const isRenaming = computed(() => {
  if (!props.inlineEdit || props.inlineEdit.type !== 'rename') {
    return false;
  }
  return props.node.path === props.inlineEdit.targetPath;
});

// Is this directory receiving a new child (create-file/create-folder)?
const isCreatingInside = computed(() => {
  if (!props.inlineEdit || !isDirectory.value) {
    return false;
  }
  if (props.inlineEdit.type !== 'create-file' && props.inlineEdit.type !== 'create-folder') {
    return false;
  }
  return props.node.path === props.inlineEdit.targetPath;
});

function startEditing() {
  if (isRenaming.value) {
    // Pre-fill with current name (just the file name, not the path)
    inputValue.value = props.node.name;
  } else if (isCreatingInside.value) {
    inputValue.value = props.inlineEdit.type === 'create-folder' ? 'new-folder' : 'newfile.js';
    // Auto-expand the folder to show the input
    expanded.value = true;
  }
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

watch([isRenaming, isCreatingInside], ([renaming, creating]) => {
  if (renaming || creating) {
    startEditing();
  }
}, { immediate: true });

function openNode() {
  if (isRenaming.value) {
    return;
  }

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

function handleConfirm() {
  emit('inline-confirm', inputValue.value);
  inputValue.value = '';
}

function handleCancel() {
  emit('inline-cancel');
  inputValue.value = '';
}

function onInputKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleConfirm();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    handleCancel();
  }
}
</script>

<template>
  <div class="tree-node">
    <!-- Rename mode: replace the label with an input -->
    <div v-if="isRenaming" class="tree-node__label tree-node__label--inline" :style="rowStyle">
      <span class="tree-node__twistie" :class="{ 'is-empty': !isDirectory }"></span>
      <span v-if="isDirectory" class="tree-node__icon tree-node__folder codicon" :class="expanded ? 'codicon-folder-opened' : 'codicon-folder'"></span>
      <span v-else class="tree-node__icon seti-icon" :style="setiIconStyle"></span>
      <input
        ref="inputRef"
        v-model="inputValue"
        class="tree-node__input"
        @keydown="onInputKeydown"
        @blur="handleConfirm"
      />
    </div>

    <!-- Normal label -->
    <button
      v-else
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
      <!-- Inline create input as first child -->
      <div v-if="isCreatingInside" class="tree-node tree-node--inline-create">
        <div class="tree-node__label tree-node__label--inline" :style="{ '--tree-depth': depth + 1 }">
          <span class="tree-node__twistie"></span>
          <span
            class="tree-node__icon codicon"
            :class="inlineEdit.type === 'create-folder' ? 'codicon-new-folder' : 'codicon-new-file'"
          ></span>
          <input
            ref="inputRef"
            v-model="inputValue"
            class="tree-node__input"
            @keydown="onInputKeydown"
            @blur="handleConfirm"
          />
        </div>
      </div>

      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :active-file-path="activeFilePath"
        :inline-edit="inlineEdit"
        :depth="depth + 1"
        @select-node="$emit('select-node', $event)"
        @node-menu="$emit('node-menu', $event)"
        @inline-confirm="$emit('inline-confirm', $event)"
        @inline-cancel="$emit('inline-cancel')"
      />
    </div>
  </div>
</template>
