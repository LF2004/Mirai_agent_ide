<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
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
  'delete-node'
]);

const explorerExpanded = ref(true);
const recentExpanded = ref(true);
const contextMenu = ref(null);
const hasWorkspace = computed(() => Boolean(props.workspacePath));

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

  if (action === 'rename') {
    emit('rename-node', node);
  }

  if (action === 'delete') {
    emit('delete-node', node);
  }
}

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
        <template v-if="tree?.children?.length">
          <FileTreeNode
            v-for="child in tree.children"
            :key="child.path"
            :node="child"
            :active-file-path="activeFilePath"
            :depth="0"
            @select-node="$emit('select-node', $event)"
            @node-menu="openContextMenu"
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
