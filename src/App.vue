<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import SidebarExplorer from './components/SidebarExplorer.vue';
import EditorTabs from './components/EditorTabs.vue';
import MonacoEditorPanel from './components/MonacoEditorPanel.vue';
import AgentPanel from './components/AgentPanel.vue';
import ToolPanel from './components/ToolPanel.vue';
import TerminalPanel from './components/TerminalPanel.vue';
import SearchPanel from './components/SearchPanel.vue';
import ExtensionsPanel from './components/ExtensionsPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { useWorkspaceStore } from './stores/workspace.js';
import { setLocale, t } from './utils/i18n.js';

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
  locale: currentLocale,
  autoSave,
  keybinds,
  searchState,
  searchResultsCount,
  filteredExtensions,
  extensionsState,
  isReady,
  bootError,
  logs
} = storeToRefs(workspaceStore);

const activeSidebar = ref('explorer');
const isAgentCollapsed = ref(false);
const draftProjectName = ref('mirai-demo');
const explorerAction = ref(null);
const explorerActionValue = ref('');
const explorerActionInput = ref(null);
const pendingDeleteNode = ref(null);
const quickCommand = ref('');
const terminalPanelRef = ref(null);
const activeMenu = ref('');
const menuRootRef = ref(null);
const editorFocusLine = ref(0);

const titleMenus = computed(() => [
  {
    id: 'file',
    label: t('file'),
    items: [
      { label: t('openProject'), action: handleOpenProject },
      { label: t('openRecentProject'), action: handleOpenRecentProject },
      { label: t('newProject'), action: handleCreateProject },
      { label: t('newFile'), action: () => requestCreateFile() },
      { label: t('newFolder'), action: () => requestCreateFolder() },
      { label: t('rename'), action: () => requestRenameNode(activeFile.value || fileTree.value) },
      { label: t('deleteActive'), action: () => requestDeleteNode(activeFile.value) },
      { label: t('saveFile'), action: handleSaveFile },
      { label: t('saveAll'), action: async () => {
        for (const file of openFiles.value) {
          if (file.dirty && file.kind === 'text') {
            activeFilePath.value = file.path;
            await workspaceStore.saveActiveFile();
          }
        }
      } },
      { label: t('newTerminal'), action: handleNewTerminal }
    ]
  },
  {
    id: 'edit',
    label: t('edit'),
    items: [
      { label: t('undo'), action: () => document.execCommand?.('undo') },
      { label: t('redo'), action: () => document.execCommand?.('redo') },
      { label: t('cut'), action: () => document.execCommand?.('cut') },
      { label: t('copy'), action: () => document.execCommand?.('copy') },
      { label: t('paste'), action: () => document.execCommand?.('paste') },
      { label: t('selectAll'), action: () => document.execCommand?.('selectAll') },
      { label: t('find'), action: focusEditor },
      { label: t('replace'), action: focusEditor },
      { label: t('quickCommand'), action: () => (quickCommand.value = '') },
      { label: t('themeSettings'), action: () => (activeSidebar.value = 'settings') },
      { label: t('extensions'), action: () => (activeSidebar.value = 'extensions') },
      { label: t('toggleAgentPanel'), action: () => (isAgentCollapsed.value = !isAgentCollapsed.value) }
    ]
  },
  {
    id: 'view',
    label: t('view'),
    items: [
      { label: t('explorer'), action: () => (activeSidebar.value = 'explorer') },
      { label: t('search'), action: () => (activeSidebar.value = 'search') },
      { label: t('extensions'), action: () => (activeSidebar.value = 'extensions') },
      { label: t('agent'), action: () => (activeSidebar.value = 'agent') },
      { label: t('settings'), action: () => (activeSidebar.value = 'settings') },
      { label: isAgentCollapsed.value ? t('showAgentPanel') : t('hideAgentPanel'), action: () => (isAgentCollapsed.value = !isAgentCollapsed.value) }
    ]
  },
  {
    id: 'go',
    label: t('go'),
    items: [
      { label: t('focusExplorer'), action: () => (activeSidebar.value = 'explorer') },
      { label: t('focusEditor'), action: focusEditor },
      { label: t('focusActiveFile'), action: focusEditor },
      { label: t('focusTerminal'), action: () => document.querySelector('.xterm-helper-textarea')?.focus?.() }
    ]
  },
  {
    id: 'terminal',
    label: t('terminal'),
    items: [
      { label: t('newTerminal'), action: handleNewTerminal },
      { label: t('focusExplorer'), action: () => (activeSidebar.value = 'explorer') },
      { label: t('toggleTerminal'), action: toggleTerminalPanel }
    ]
  },
  {
    id: 'window',
    label: t('window'),
    items: [
      { label: t('toggleSidebar'), action: toggleSidebar },
      { label: t('togglePanels'), action: togglePanels },
      { label: t('collapseAgentPanel'), action: () => (isAgentCollapsed.value = true) },
      { label: t('showAgentPanel'), action: () => (isAgentCollapsed.value = false) },
      { label: t('zoomIn'), action: () => workspaceStore.appendLog('info', 'Zoom in not wired yet.') },
      { label: t('zoomOut'), action: () => workspaceStore.appendLog('info', 'Zoom out not wired yet.') },
      { label: t('resetZoom'), action: () => workspaceStore.appendLog('info', 'Zoom reset not wired yet.') }
    ]
  },
  {
    id: 'help',
    label: t('help'),
    items: [
      { label: t('about'), action: () => workspaceStore.appendLog('info', 'Mirai Agent IDE shell is running.') },
      { label: t('revealWorkspace'), action: () => workspaceStore.revealWorkspace() }
    ]
  }
]);

const menuRefreshKey = computed(() => currentLocale.value);

const hasWorkspace = computed(() => Boolean(workspacePath.value));
const currentFileLabel = computed(() => activeFilePath.value || t('noFileOpened'));
const workspaceBreadcrumb = computed(() => {
  if (!workspacePath.value) {
  return t('notOpened');
  }

  return workspacePath.value.replace(/\\/g, '/').split('/').slice(-3).join(' / ');
});

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

function handleNewTerminal() {
  terminalPanelRef.value?.createTerminalSession?.();
}

async function handleOpenRecentProject() {
  const recentPath = recentProjects.value[0]?.path;
  if (!recentPath) {
    return;
  }

  await workspaceStore.openRecentProject(recentPath);
}

function focusEditor() {
  document.querySelector('.cm-editor')?.focus?.();
}

function focusTerminal() {
  document.querySelector('.xterm-helper-textarea')?.focus?.();
}

function toggleSidebar() {
  activeSidebar.value = activeSidebar.value === 'explorer' ? 'settings' : 'explorer';
}

function togglePanels() {
  activeSidebar.value = activeSidebar.value === 'agent' ? 'explorer' : 'agent';
}

function toggleTerminalPanel() {
  const terminalRoot = document.querySelector('.terminal-panel');
  if (terminalRoot) {
    terminalRoot.hidden = !terminalRoot.hidden;
  }
}

function normalizeShortcut(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('cmd', 'ctrl');
}

function eventMatchesShortcut(event, shortcut) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) {
    return false;
  }

  const parts = normalized.split('+').filter(Boolean);
  const key = parts.pop();
  const requiresCtrl = parts.includes('ctrl');
  const requiresShift = parts.includes('shift');
  const requiresAlt = parts.includes('alt');

  return Boolean(
    key &&
    (event.key.toLowerCase() === key || (key === '`' && event.code === 'Backquote')) &&
    event.ctrlKey === requiresCtrl &&
    event.shiftKey === requiresShift &&
    event.altKey === requiresAlt
  );
}

function toggleMenu(menuId) {
  activeMenu.value = activeMenu.value === menuId ? '' : menuId;
}

function closeMenu() {
  activeMenu.value = '';
}

async function runMenuAction(action) {
  closeMenu();
  await action?.();
}

function handleGlobalPointerDown(event) {
  if (!menuRootRef.value?.contains(event.target)) {
    closeMenu();
  }
}

async function changeLocale(value) {
  await workspaceStore.setLocale(value);
  setLocale(value);
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeMenu();
  }

  if (eventMatchesShortcut(event, keybinds.value.search)) {
    event.preventDefault();
    activeSidebar.value = 'search';
    closeMenu();
  }

  if (eventMatchesShortcut(event, keybinds.value.replace)) {
    event.preventDefault();
    activeSidebar.value = 'search';
    searchState.value.replaceExpanded = true;
    closeMenu();
  }

  if (eventMatchesShortcut(event, keybinds.value.saveFile)) {
    event.preventDefault();
    handleSaveFile();
  }

  if (eventMatchesShortcut(event, keybinds.value.openProject)) {
    event.preventDefault();
    handleOpenProject();
  }

  if (eventMatchesShortcut(event, keybinds.value.newFile)) {
    event.preventDefault();
    requestCreateFile();
  }

  if (eventMatchesShortcut(event, keybinds.value.terminal)) {
    event.preventDefault();
    handleNewTerminal();
  }
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
  if (!hasWorkspace.value) {
    return;
  }

  const parentPath = parentPathFor(node);
  openExplorerAction(
    {
      type: 'create-file',
      title: 'New File',
      label: t('filePath')
    },
    joinPath(parentPath, 'new-file.js')
  );
}

function requestCreateFolder(node = null) {
  if (!hasWorkspace.value) {
    return;
  }

  const parentPath = parentPathFor(node);
  openExplorerAction(
    {
      type: 'create-folder',
      title: 'New Folder',
      label: t('folderPath')
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
      label: t('rename'),
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

async function handleSearchResultSelect(result) {
  if (!result?.path) {
    return;
  }

  editorFocusLine.value = 0;
  await workspaceStore.openFile(result.path);
  await nextTick();
  editorFocusLine.value = Number(result.lineNumber) || 0;
}

async function handleSearchRun(payload) {
  searchState.value.replaceExpanded = Boolean(payload?.replaceExpanded);
  await workspaceStore.runSearch(payload);
}

async function handleReplaceRun(payload) {
  searchState.value.query = payload?.query || searchState.value.query;
  searchState.value.replace = payload?.replace || searchState.value.replace;
  searchState.value.includeFiles = payload?.includeFiles || searchState.value.includeFiles;
  searchState.value.excludeFiles = payload?.excludeFiles || searchState.value.excludeFiles;
  searchState.value.replaceExpanded = true;
  await workspaceStore.replaceInSearchResults();
  await workspaceStore.runSearch({
    query: searchState.value.query,
    replace: searchState.value.replace,
    includeFiles: searchState.value.includeFiles,
    excludeFiles: searchState.value.excludeFiles,
    replaceExpanded: true
  });
}

async function handleRevealPath(targetPath) {
  if (!targetPath) {
    return;
  }

  await workspaceStore.revealWorkspace(targetPath);
}

async function handleQuickCommand() {
  const command = quickCommand.value.trim().toLowerCase();
  if (!command) {
    return;
  }

  if (command.includes('open')) {
    await handleOpenProject();
  } else if (command.includes('new project')) {
    await handleCreateProject();
  } else if (command.includes('save')) {
    await handleSaveFile();
  } else if (command.includes('terminal')) {
    handleNewTerminal();
  }

  quickCommand.value = '';
}

onMounted(async () => {
  await workspaceStore.bootstrap();
  document.addEventListener('pointerdown', handleGlobalPointerDown);
  document.addEventListener('keydown', handleMenuKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleGlobalPointerDown);
  document.removeEventListener('keydown', handleMenuKeydown);
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
          class="activitybar__item codicon codicon-extensions"
          :class="{ 'is-active': activeSidebar === 'extensions' }"
          title="Extensions"
          @click="activeSidebar = 'extensions'"
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

      <header class="titlebar" ref="menuRootRef" :key="menuRefreshKey">
        <div class="titlebar__left">
          <strong class="titlebar__logo">{{ appInfo.name }}</strong>
          <div class="titlebar__menus">
            <div v-for="menu in titleMenus" :key="menu.id" class="titlebar__menu">
              <button class="menu-button" :class="{ 'is-active': activeMenu === menu.id }" @click="toggleMenu(menu.id)">
                {{ menu.label }}
              </button>
              <div v-if="activeMenu === menu.id" class="titlebar-menu">
                <button
                  v-for="item in menu.items"
                  :key="item.label"
                  class="titlebar-menu__item"
                  @click="runMenuAction(item.action)"
                >
                  {{ item.label }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="titlebar__center">
          <span class="titlebar__workspace">{{ workspaceName || t('appName') }}</span>
          <span class="titlebar__breadcrumb">{{ workspaceBreadcrumb }}</span>
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

          <SearchPanel
            v-else-if="activeSidebar === 'search'"
            :workspace-path="workspacePath"
            :search-state="searchState"
            :results-count="searchResultsCount"
            @run-search="handleSearchRun"
            @run-replace="handleReplaceRun"
            @undo-last="workspaceStore.undoLastAction"
            @select-result="handleSearchResultSelect"
          />

          <ExtensionsPanel
            v-else-if="activeSidebar === 'extensions'"
            :extensions="filteredExtensions"
            :loading="extensionsState.loading"
            :query="extensionsState.query"
            @update:query="workspaceStore.setExtensionQuery"
            @refresh="workspaceStore.loadInstalledExtensions"
            @toggle-enabled="workspaceStore.setExtensionEnabled($event.id, !$event.enabled)"
            @reveal-extension="handleRevealPath"
          />

          <SettingsPanel
            v-else-if="activeSidebar === 'settings'"
            :current-locale="currentLocale"
            :active-theme="activeTheme"
            :editor-font-size="editorFontSize"
            :editor-font-family="editorFontFamily"
            :terminal-font-size="terminalFontSize"
            :explorer-compact-folders="explorerCompactFolders"
            :terminal-shell-integration="terminalShellIntegration"
            :auto-save="autoSave"
            :keybinds="keybinds"
            @set-theme="workspaceStore.setTheme"
            @set-locale="changeLocale"
            @set-editor-font-family="workspaceStore.setEditorFontFamily"
            @set-editor-font-size="workspaceStore.setEditorFontSize"
            @set-auto-save="workspaceStore.setAutoSave"
            @set-compact-folders="workspaceStore.setExplorerCompactFolders"
            @set-shell-integration="workspaceStore.setTerminalShellIntegration"
            @set-terminal-font-size="workspaceStore.setTerminalFontSize"
            @set-keybind="workspaceStore.setKeybind"
          />

          <div v-else class="sidebar-placeholder">
            <p class="pane__label">{{ activeSidebar === 'extensions' ? t('extensions') : t('agent') }}</p>
            <h3>{{ activeSidebar === 'extensions' ? t('extensions') : t('agent') }}</h3>
            <p class="pane__hint">
              {{
                activeSidebar === 'extensions'
                  ? t('extensionsHint')
                  : t('agentViewHint')
              }}
            </p>
          </div>
        </aside>

        <main class="editor-layout" :class="{ 'is-agent-collapsed': isAgentCollapsed }">
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
              :focus-line="editorFocusLine"
              @change="handleEditorChange"
              @save="handleSaveFile"
            />
            <TerminalPanel ref="terminalPanelRef" :workspace-path="workspacePath" :font-size="terminalFontSize" />
          </section>

          <section class="agent-section" :class="{ 'is-collapsed': isAgentCollapsed }">
            <AgentPanel
              :mode="activeMode"
              :model="selectedModel"
              :current-file="currentFileLabel"
              :collapsed="isAgentCollapsed"
              @toggle-collapse="isAgentCollapsed = !isAgentCollapsed"
              @mode-change="handleModeChange"
              @model-change="handleModelChange"
            />
            <ToolPanel v-if="!isAgentCollapsed" :workspace-path="workspacePath" :has-workspace="hasWorkspace" />
          </section>
        </main>
      </div>

      <footer class="statusbar">
        <span>{{ workspacePath || t('noWorkspaceSelected') }}</span>
        <span>{{ t('mode') }}: {{ activeMode }}</span>
        <span>{{ t('model') }}: {{ selectedModel }}</span>
        <span>{{ t('currentFileHint') }}: {{ currentFileLabel }}</span>
        <span v-if="bootError" class="statusbar__error">{{ t('bridgeError') }}: {{ bootError }}</span>
      </footer>

      <div v-if="explorerAction" class="ide-modal-backdrop" @click.self="closeExplorerAction">
        <form class="ide-modal" @submit.prevent="submitExplorerAction">
          <h3>{{ explorerAction.title }}</h3>
          <label>
            <span>{{ explorerAction.label }}</span>
            <input ref="explorerActionInput" v-model="explorerActionValue" class="ide-modal__input" />
          </label>
          <div class="ide-modal__actions">
            <button type="button" class="ghost-button" @click="closeExplorerAction">{{ t('cancel') }}</button>
            <button type="submit" class="primary-button">{{ t('apply') }}</button>
          </div>
        </form>
      </div>

      <div v-if="pendingDeleteNode" class="ide-modal-backdrop" @click.self="pendingDeleteNode = null">
        <div class="ide-modal">
          <h3>{{ t('delete') }}</h3>
          <p>{{ t('deletePrompt').replace('{path}', pendingDeleteNode.path) }}</p>
          <div class="ide-modal__actions">
            <button type="button" class="ghost-button" @click="pendingDeleteNode = null">{{ t('cancel') }}</button>
            <button type="button" class="danger-button" @click="confirmDeleteNode">{{ t('delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
