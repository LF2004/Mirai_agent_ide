<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import SidebarExplorer from './components/SidebarExplorer.vue';
import EditorTabs from './components/EditorTabs.vue';
import MonacoEditorPanel from './components/MonacoEditorPanel.vue';
import AgentPanel from './components/AgentPanel.vue';
import ToolPanel from './components/ToolPanel.vue';
import TerminalPanel from './components/TerminalPanel.vue';
import { useWorkspaceStore } from './stores/workspace.js';
import { IDE_THEMES } from '../type/themes.js';

const workspaceStore = useWorkspaceStore();
const {
  appInfo,
  recentProjects,
  workspacePath,
  workspaceName,
  fileTree,
  openFiles,
  activeFile,
  activeFilePath,
  activeFileContent,
  activeMode,
  selectedModel,
  activeTheme,
  editorFontSize,
  editorFontFamily,
  terminalFontSize,
  explorerCompactFolders,
  terminalShellIntegration,
  autoSave,
  isReady,
  bootError,
  logs
} = storeToRefs(workspaceStore);

const activeSidebar = ref('explorer');
const draftProjectName = ref('mirai-demo');
const explorerAction = ref(null);
const explorerActionValue = ref('');
const explorerActionInput = ref(null);
const pendingDeleteNode = ref(null);

const hasWorkspace = computed(() => Boolean(workspacePath.value));
const currentFileLabel = computed(() => activeFilePath.value || 'No file opened');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function parentPathFor(node) {
  if (!node || node.type === 'directory') {
    return node?.path === '.' ? '' : normalizePath(node?.path || '');
  }

  const pathParts = normalizePath(node.path).split('/');
  pathParts.pop();
  return pathParts.join('/');
}

function joinPath(basePath, name) {
  const cleanName = normalizePath(name);
  const cleanBase = normalizePath(basePath);
  return cleanBase ? `${cleanBase}/${cleanName}` : cleanName;
}

async function handleOpenProject() {
  await workspaceStore.openProjectFromDialog();
}

async function handleCreateProject() {
  await workspaceStore.createProject(draftProjectName.value);
}

async function handleTreeSelect(node) {
  if (node.type !== 'file') {
    return;
  }

  await workspaceStore.openFile(node.path);
}

async function handleSaveFile() {
  await workspaceStore.saveActiveFile();
}

function openExplorerAction(action, defaultValue) {
  explorerAction.value = action;
  explorerActionValue.value = defaultValue;
  nextTick(() => {
    explorerActionInput.value?.focus();
    explorerActionInput.value?.select();
  });
}

function requestCreateFile(node = null) {
  const parentPath = parentPathFor(node);
  openExplorerAction(
    {
      type: 'create-file',
      title: 'New File',
      label: 'File path'
    },
    joinPath(parentPath, 'new-file.js')
  );
}

function requestCreateFolder(node = null) {
  const parentPath = parentPathFor(node);
  openExplorerAction(
    {
      type: 'create-folder',
      title: 'New Folder',
      label: 'Folder path'
    },
    joinPath(parentPath, 'new-folder')
  );
}

function requestRenameNode(node) {
  if (!node) {
    return;
  }

  openExplorerAction(
    {
      type: 'rename',
      title: 'Rename',
      label: 'New path',
      node
    },
    normalizePath(node.path)
  );
}

function requestDeleteNode(node) {
  if (!node) {
    return;
  }

  pendingDeleteNode.value = node;
}

function closeExplorerAction() {
  explorerAction.value = null;
  explorerActionValue.value = '';
}

async function submitExplorerAction() {
  const action = explorerAction.value;
  const targetPath = normalizePath(explorerActionValue.value);

  if (!action || !targetPath) {
    return;
  }

  if (action.type === 'create-file') {
    await workspaceStore.createFile(targetPath);
  }

  if (action.type === 'create-folder') {
    await workspaceStore.createFolder(targetPath);
  }

  if (action.type === 'rename') {
    await workspaceStore.renamePath(action.node.path, targetPath);
  }

  closeExplorerAction();
}

async function confirmDeleteNode() {
  if (!pendingDeleteNode.value) {
    return;
  }

  await workspaceStore.deletePath(pendingDeleteNode.value.path);
  pendingDeleteNode.value = null;
}

function handleModeChange(mode) {
  workspaceStore.setMode(mode);
}

function handleModelChange(model) {
  workspaceStore.setModel(model);
}

function handleEditorChange(value) {
  workspaceStore.setActiveFileContent(value);
}

function handleCloseFile(filePath) {
  workspaceStore.closeFile(filePath);
}

onMounted(async () => {
  await workspaceStore.bootstrap();
});
</script>

<template>
  <div v-if="isReady" class="shell" :data-theme="activeTheme">
    <div class="workbench">
      <nav class="activitybar">
        <button
          class="activitybar__item codicon codicon-files"
          :class="{ 'is-active': activeSidebar === 'explorer' }"
          title="Explorer"
          @click="activeSidebar = 'explorer'"
        ></button>
        <button
          class="activitybar__item codicon codicon-search"
          :class="{ 'is-active': activeSidebar === 'search' }"
          title="Search"
          @click="activeSidebar = 'search'"
        ></button>
        <button
          class="activitybar__item codicon codicon-hubot"
          :class="{ 'is-active': activeSidebar === 'agent' }"
          title="Agent"
          @click="activeSidebar = 'agent'"
        ></button>
        <button
          class="activitybar__item activitybar__item--bottom codicon codicon-settings-gear"
          :class="{ 'is-active': activeSidebar === 'settings' }"
          title="Settings"
          @click="activeSidebar = 'settings'"
        ></button>
      </nav>

      <header class="titlebar">
        <div class="titlebar__left">
          <strong class="titlebar__logo">{{ appInfo.name }}</strong>
          <button class="menu-button">File</button>
          <button class="menu-button">Edit</button>
          <button class="menu-button">Selection</button>
          <button class="menu-button">View</button>
          <button class="menu-button">Go</button>
          <button class="menu-button">Run</button>
          <button class="menu-button">Terminal</button>
          <button class="menu-button">Help</button>
        </div>
        <div class="titlebar__center">{{ workspaceName || 'Mirai Agent IDE' }}</div>
        <div class="titlebar__actions">
          <button class="ghost-button" @click="handleOpenProject">Open Project</button>
          <button class="primary-button" @click="handleCreateProject">New Project</button>
          <button class="ghost-button" @click="workspaceStore.revealWorkspace()">Reveal</button>
          <input v-model="draftProjectName" class="titlebar__input" placeholder="Project name" />
        </div>
      </header>

      <div class="workspace-shell">
        <aside class="sidebar">
          <SidebarExplorer
            v-if="activeSidebar === 'explorer'"
            :workspace-name="workspaceName"
            :workspace-path="workspacePath"
            :recent-projects="recentProjects"
            :tree="fileTree"
            :active-file-path="activeFilePath"
            @open-project="handleOpenProject"
            @create-file="requestCreateFile"
            @create-folder="requestCreateFolder"
            @refresh-tree="workspaceStore.refreshFileTree"
            @select-node="handleTreeSelect"
            @open-recent="workspaceStore.openRecentProject"
            @rename-node="requestRenameNode"
            @delete-node="requestDeleteNode"
          />

          <div v-else-if="activeSidebar === 'settings'" class="settings-pane">
            <div class="pane__header">SETTINGS</div>
            <section class="settings-section">
              <p class="pane__label">Appearance</p>
              <h3>Theme</h3>
              <p class="pane__hint">UI and editor syntax colors switch together.</p>
              <div class="theme-list">
                <button
                  v-for="theme in IDE_THEMES"
                  :key="theme.id"
                  class="theme-option"
                  :class="{ 'is-active': theme.id === activeTheme }"
                  @click="workspaceStore.setTheme(theme.id)"
                >
                  <span class="theme-option__swatch" :data-theme-preview="theme.id"></span>
                  <span>{{ theme.name }}</span>
                  <span v-if="theme.id === activeTheme" class="codicon codicon-check"></span>
                </button>
              </div>
            </section>

            <section class="settings-section">
              <p class="pane__label">Editor</p>
              <h3>Typography</h3>
              <div class="settings-field">
                <label>Font family</label>
                <input
                  :value="editorFontFamily"
                  class="settings-input"
                  @change="workspaceStore.setEditorFontFamily($event.target.value)"
                />
              </div>
              <div class="settings-field">
                <label>Font size</label>
                <input
                  type="range"
                  min="11"
                  max="20"
                  :value="editorFontSize"
                  @input="workspaceStore.setEditorFontSize($event.target.value)"
                />
                <span>{{ editorFontSize }} px</span>
              </div>
              <div class="settings-field">
                <label>Auto save</label>
                <select :value="autoSave" class="settings-input" @change="workspaceStore.setAutoSave($event.target.value)">
                  <option value="off">Off</option>
                  <option value="afterDelay">After delay</option>
                  <option value="onFocusChange">On focus change</option>
                </select>
              </div>
            </section>

            <section class="settings-section">
              <p class="pane__label">Explorer / Terminal</p>
              <h3>Workspace</h3>
              <div class="settings-field settings-field--stack">
                <label>
                  <input
                    type="checkbox"
                    :checked="explorerCompactFolders"
                    @change="workspaceStore.setExplorerCompactFolders($event.target.checked)"
                  />
                  Compact folders
                </label>
                <label>
                  <input
                    type="checkbox"
                    :checked="terminalShellIntegration"
                    @change="workspaceStore.setTerminalShellIntegration($event.target.checked)"
                  />
                  Terminal shell integration
                </label>
              </div>
              <div class="settings-field">
                <label>Terminal font size</label>
                <input
                  type="range"
                  min="11"
                  max="18"
                  :value="terminalFontSize"
                  @input="workspaceStore.setTerminalFontSize($event.target.value)"
                />
                <span>{{ terminalFontSize }} px</span>
              </div>
            </section>
          </div>

          <div v-else class="sidebar-placeholder">
            <p class="pane__label">{{ activeSidebar === 'search' ? 'SEARCH' : 'AGENT' }}</p>
            <h3>{{ activeSidebar === 'search' ? 'Project Search' : 'Agent View' }}</h3>
            <p class="pane__hint">
              {{
                activeSidebar === 'search'
                  ? 'Project-wide search, filename search, and symbol search will live here.'
                  : 'Conversation history, task trees, and agent configuration will live here.'
              }}
            </p>
          </div>
        </aside>

        <main class="editor-layout">
          <section class="editor-section">
            <EditorTabs
              :open-files="openFiles"
              :active-file-path="activeFilePath"
              @select="workspaceStore.setActiveFile"
              @close="handleCloseFile"
            />
            <MonacoEditorPanel
              :file-path="activeFilePath"
              :file="activeFile"
              :content="activeFileContent"
              :font-size="editorFontSize"
              :font-family="editorFontFamily"
              @change="handleEditorChange"
              @save="handleSaveFile"
            />
            <TerminalPanel :workspace-path="workspacePath" />
          </section>

          <section class="agent-section">
            <AgentPanel
              :mode="activeMode"
              :model="selectedModel"
              :current-file="currentFileLabel"
              @mode-change="handleModeChange"
              @model-change="handleModelChange"
            />
            <ToolPanel :workspace-path="workspacePath" :has-workspace="hasWorkspace" />
          </section>
        </main>
      </div>

      <footer class="statusbar">
        <span>{{ workspacePath || 'No workspace selected' }}</span>
        <span>Mode: {{ activeMode }}</span>
        <span>Model: {{ selectedModel }}</span>
        <span>File: {{ currentFileLabel }}</span>
        <span v-if="bootError" class="statusbar__error">Bridge error: {{ bootError }}</span>
      </footer>

      <div v-if="explorerAction" class="ide-modal-backdrop" @click.self="closeExplorerAction">
        <form class="ide-modal" @submit.prevent="submitExplorerAction">
          <h3>{{ explorerAction.title }}</h3>
          <label>
            <span>{{ explorerAction.label }}</span>
            <input ref="explorerActionInput" v-model="explorerActionValue" class="ide-modal__input" />
          </label>
          <div class="ide-modal__actions">
            <button type="button" class="ghost-button" @click="closeExplorerAction">Cancel</button>
            <button type="submit" class="primary-button">Apply</button>
          </div>
        </form>
      </div>

      <div v-if="pendingDeleteNode" class="ide-modal-backdrop" @click.self="pendingDeleteNode = null">
        <div class="ide-modal">
          <h3>Delete</h3>
          <p>Delete "{{ pendingDeleteNode.path }}"? This cannot be undone.</p>
          <div class="ide-modal__actions">
            <button type="button" class="ghost-button" @click="pendingDeleteNode = null">Cancel</button>
            <button type="button" class="danger-button" @click="confirmDeleteNode">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
