<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import FileTreeNode from './FileTreeNode.vue';
import { t } from '../utils/i18n.js';

const props = defineProps({
  workspaceName: {
    type: String,
    default: ''
  },
  workspacePath: {
    type: String,
    default: ''
  },
  recentProjects: {
    type: Array,
    default: () => []
  },
  tree: {
    type: Object,
    default: null
  },
  activeFilePath: {
    type: String,
    default: ''
  },
  inlineEdit: {
    type: Object,
    default: null
  }
});

const emit = defineEmits([
  'open-project',
  'create-file',
  'create-folder',
  'refresh-tree',
  'select-node',
  'open-recent',
  'rename-node',
  'delete-node',
  'inline-confirm',
  'inline-cancel',
  'find-in-folder'
]);

const explorerExpanded = ref(true);
const recentExpanded = ref(true);
const contextMenu = ref(null);
const rootInlineInputRef = ref(null);
const rootInlineValue = ref('');
const fileFilter = ref('');
const hasWorkspace = computed(() => Boolean(props.workspacePath));

function filterTreeNodes(nodes, query) {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const result = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      const filteredChildren = filterTreeNodes(node.children || [], query);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        result.push({ ...node, children: filteredChildren });
      }
    } else {
      if (node.name.toLowerCase().includes(q)) {
        result.push(node);
      }
    }
  }
  return result;
}

const filteredTreeChildren = computed(() => {
  if (!props.tree?.children) return [];
  if (!fileFilter.value.trim()) return props.tree.children;
  return filterTreeNodes(props.tree.children, fileFilter.value.trim());
});

// Root-level inline edit: when creating at workspace root (targetPath is empty)
const isRootInlineEdit = computed(() => {
  if (!props.inlineEdit) {
    return false;
  }
  return (props.inlineEdit.type === 'create-file' || props.inlineEdit.type === 'create-folder')
    && (!props.inlineEdit.targetPath || props.inlineEdit.targetPath === '.');
});

function toggleSection(section) {
  if (section === 'explorer') {
    explorerExpanded.value = !explorerExpanded.value;
    return;
  }

  recentExpanded.value = !recentExpanded.value;
}

function openContextMenu(payload) {
  contextMenu.value = payload;
  window.addEventListener('click', closeContextMenu, { once: true });
}

function closeContextMenu() {
  contextMenu.value = null;
}

function runContextAction(action) {
  if (!contextMenu.value) {
    return;
  }

  const node = contextMenu.value.node;
  closeContextMenu();

  if (action === 'new-file') {
    emit('create-file', node);
  }

  if (action === 'new-folder') {
    emit('create-folder', node);
  }

  if (action === 'open') {
    emit('select-node', node);
  }

  if (action === 'copy-path') {
    const fullPath = props.workspacePath + '/' + node.path;
    navigator.clipboard?.writeText?.(fullPath);
  }

  if (action === 'copy-relative-path') {
    navigator.clipboard?.writeText?.(node.path);
  }

  if (action === 'reveal') {
    const fullPath = props.workspacePath + '/' + node.path;
    emit('select-node', { type: 'reveal', path: fullPath });
  }

  if (action === 'find-in-folder') {
    emit('find-in-folder', node.path);
  }

  if (action === 'rename') {
    emit('rename-node', node);
  }

  if (action === 'delete') {
    emit('delete-node', node);
  }
}

function handleRootInlineConfirm() {
  emit('inline-confirm', rootInlineValue.value);
  rootInlineValue.value = '';
}

function handleRootInlineCancel() {
  emit('inline-cancel');
  rootInlineValue.value = '';
}

// Watch for root inline edit becoming active to focus the input
watch(isRootInlineEdit, (active) => {
  if (active) {
    const defaultName = props.inlineEdit.type === 'create-file' ? 'newfile.js' : 'new-folder';
    rootInlineValue.value = defaultName;
    nextTick(() => {
      rootInlineInputRef.value?.focus();
      rootInlineInputRef.value?.select();
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu);
});
</script>

<template>
  <div class="pane">
    <div class="pane__header pane__header--explorer">
      <span>{{ t('explorer').toUpperCase() }}</span>
      <div class="pane__header-actions">
        <button class="icon-button codicon codicon-folder-opened" :title="t('openProject')" @click="$emit('open-project')"></button>
        <button class="icon-button codicon codicon-new-file" :title="t('newFile')" :disabled="!hasWorkspace" @click="$emit('create-file')"></button>
        <button class="icon-button codicon codicon-new-folder" :title="t('newFolder')" :disabled="!hasWorkspace" @click="$emit('create-folder')"></button>
        <button class="icon-button codicon codicon-refresh" :title="t('refresh')" :disabled="!hasWorkspace" @click="$emit('refresh-tree')"></button>
      </div>
    </div>

    <div class="pane__section">
      <p class="pane__label">{{ t('currentProject').toUpperCase() }}</p>
      <p class="pane__value">{{ workspaceName || t('noProjectOpened') }}</p>
      <p class="pane__hint">{{ workspacePath || t('openOrCreateProject') }}</p>
    </div>

    <div class="pane__section pane__section--tree">
      <button class="section-toggle" @click="toggleSection('explorer')">
        <span class="codicon" :class="explorerExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></span>
        <span>{{ t('files').toUpperCase() }}</span>
      </button>

      <div v-if="explorerExpanded" class="file-tree">
        <div v-if="hasWorkspace" class="file-tree__filter">
          <input
            v-model="fileFilter"
            class="file-tree__filter-input"
            :placeholder="t('searchFiles') + '...'"
          />
          <span v-if="fileFilter" class="codicon codicon-close file-tree__filter-clear" @click="fileFilter = ''"></span>
        </div>
        <template v-if="tree?.children?.length || isRootInlineEdit">
          <div v-if="isRootInlineEdit" class="tree-node tree-node--inline-root">
            <div class="tree-node__label tree-node__label--inline">
              <span class="tree-node__twistie"></span>
              <span
                class="tree-node__icon codicon"
                :class="inlineEdit.type === 'create-folder' ? 'codicon-new-folder' : 'codicon-new-file'"
              ></span>
              <input
                ref="rootInlineInputRef"
                v-model="rootInlineValue"
                class="tree-node__input"
                @keydown.enter.prevent="handleRootInlineConfirm"
                @keydown.escape.prevent="handleRootInlineCancel"
                @blur="handleRootInlineConfirm"
              />
            </div>
          </div>
          <FileTreeNode
            v-for="child in filteredTreeChildren"
            :key="child.path"
            :node="child"
            :active-file-path="activeFilePath"
            :inline-edit="inlineEdit"
            :depth="0"
            @select-node="$emit('select-node', $event)"
            @node-menu="openContextMenu"
            @inline-confirm="$emit('inline-confirm', $event)"
            @inline-cancel="$emit('inline-cancel')"
          />
        </template>
        <div v-else class="empty-tree">
          <span class="codicon codicon-folder"></span>
          <p>{{ t('workspaceTreeHint') }}</p>
        </div>
      </div>
    </div>

    <div class="pane__section pane__section--recent">
      <button class="section-toggle" @click="toggleSection('recent')">
        <span class="codicon" :class="recentExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></span>
        <span>{{ t('recent').toUpperCase() }}</span>
      </button>

      <div v-if="recentExpanded" class="recent-list">
        <button
          v-for="project in recentProjects"
          :key="project.path"
          class="recent-item"
          @click="$emit('open-recent', project.path)"
        >
          <span class="recent-item__name">{{ project.name }}</span>
          <small>{{ project.path }}</small>
        </button>
        <p v-if="recentProjects.length === 0" class="pane__hint">{{ t('noRecentProjects') }}</p>
      </div>
    </div>

    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button v-if="contextMenu.node.type === 'directory'" @click="runContextAction('new-file')">
        <span class="codicon codicon-new-file"></span>
        {{ t('newFile') }}
      </button>
      <button v-if="contextMenu.node.type === 'directory'" @click="runContextAction('new-folder')">
        <span class="codicon codicon-new-folder"></span>
        {{ t('newFolder') }}
      </button>
      <button v-if="contextMenu.node.type === 'file'" @click="runContextAction('open')">
        <span class="codicon codicon-go-to-file"></span>
        {{ t('openToSide') }}
      </button>
      <div class="context-menu__separator"></div>
      <button v-if="contextMenu.node.type === 'directory'" @click="runContextAction('find-in-folder')">
        <span class="codicon codicon-search"></span>
        {{ t('findInFolder') || 'Find in Folder' }}
      </button>
      <button @click="runContextAction('copy-path')">
        <span class="codicon codicon-clippy"></span>
        {{ t('copyPath') }}
      </button>
      <button @click="runContextAction('copy-relative-path')">
        <span class="codicon codicon-copy"></span>
        {{ t('copyRelativePath') }}
      </button>
      <div class="context-menu__separator"></div>
      <button @click="runContextAction('reveal')">
        <span class="codicon codicon-folder"></span>
        {{ t('revealInExplorer') }}
      </button>
      <button @click="runContextAction('rename')">
        <span class="codicon codicon-edit"></span>
        {{ t('rename') }}
      </button>
      <button class="is-danger" @click="runContextAction('delete')">
        <span class="codicon codicon-trash"></span>
        {{ t('delete') }}
      </button>
    </div>
  </div>
</template>
