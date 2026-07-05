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
import ContextMenu from './components/ContextMenu.vue';
import { useWorkspaceStore } from './stores/workspace.js';
import { setLocale, t } from './utils/i18n.js';
import { getDesktopApi } from './services/desktop.js';

const desktopApi = getDesktopApi();

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
  logs,
  wordWrap,
  tabSize,
  lineNumbers,
  minimap,
  renderWhitespace,
  bracketPairColorization,
  cursorBlinking,
  smoothScrolling
} = storeToRefs(workspaceStore);
const activeSidebar = ref('explorer');
const isAgentCollapsed = ref(false);
const draftProjectName = ref('mirai-demo');
const inlineEdit = ref(null);
const undoToast = ref(null);
const quickCommand = ref('');
const terminalPanelRef = ref(null);
const extensionsPanelRef = ref(null);
const activeMenu = ref('');
const activeSubmenu = ref('');
const menuRootRef = ref(null);
const editorFocusLine = ref(0);
const editorPanelRef = ref(null);
const isTerminalCollapsed = ref(true);
const terminalHeight = ref(220);
const editorContextMenu = ref({ visible: false, x: 0, y: 0 });
const commandPaletteOpen = ref(false);
const commandPaletteQuery = ref('');
const commandPaletteInputRef = ref(null);
const editorCursorPos = ref({ line: 1, col: 1 });

const editorSectionStyle = computed(() => {
  const terminalRow = isTerminalCollapsed.value ? '34px' : `${terminalHeight.value}px`;
  return {
    'grid-template-rows': `35px minmax(220px, 1fr) ${terminalRow}`
  };
});

const titleMenus = computed(() => [
  {
    id: 'file',
    label: t('file'),
    items: [
      { label: t('newFile'), shortcut: keybinds.value.newFile, action: () => requestCreateFile() },
      { label: t('newFolder'), action: () => requestCreateFolder() },
      { label: t('newProject'), action: handleCreateProject },
      { separator: true },
      { label: t('openProject'), shortcut: keybinds.value.openProject, action: handleOpenProject },
      {
        label: t('openRecentProject'),
        submenu: recentProjects.value.length
          ? recentProjects.value.slice(0, 6).map((project) => ({
              label: project.name,
              detail: project.path,
              action: () => workspaceStore.openRecentProject(project.path)
            }))
          : [{ label: t('noRecentProjects'), disabled: true }]
      },
      { separator: true },
      { label: t('saveFile'), shortcut: keybinds.value.saveFile, action: handleSaveFile, disabled: !activeFilePath.value },
      { label: t('saveAll'), action: async () => {
        for (const file of openFiles.value) {
          if (file.dirty && file.kind === 'text') {
            activeFilePath.value = file.path;
            await workspaceStore.saveActiveFile();
          }
        }
      }, disabled: !openFiles.value.some((file) => file.dirty) },
      { separator: true },
      { label: t('newTerminal'), shortcut: keybinds.value.terminal, action: handleNewTerminal },
      { label: t('configureTerminal'), action: () => (activeSidebar.value = 'settings'), disabled: true }
    ]
  },
  {
    id: 'edit',
    label: t('edit'),
    items: [
      { label: t('undo'), shortcut: keybinds.value.undo, action: handleUndo },
      { label: t('redo'), shortcut: keybinds.value.redo, action: handleRedo },
      { separator: true },
      { label: t('cut'), action: () => document.execCommand?.('cut') },
      { label: t('copy'), action: () => document.execCommand?.('copy') },
      { label: t('paste'), action: () => document.execCommand?.('paste') },
      { label: t('selectAll'), action: () => document.execCommand?.('selectAll') },
      { separator: true },
      { label: t('find'), shortcut: 'Ctrl+F', action: focusEditor },
      { label: t('replace'), shortcut: keybinds.value.replace, action: focusEditor },
      { separator: true },
      { label: t('commandPalette'), shortcut: 'Ctrl+Shift+P', action: () => (quickCommand.value = '') },
      { label: t('preferences'), action: () => (activeSidebar.value = 'settings') }
    ]
  },
  {
    id: 'view',
    label: t('view'),
    items: [
      { label: t('explorer'), shortcut: 'Ctrl+Shift+E', action: () => (activeSidebar.value = 'explorer'), checked: activeSidebar.value === 'explorer' },
      { label: t('search'), shortcut: keybinds.value.search, action: () => (activeSidebar.value = 'search'), checked: activeSidebar.value === 'search' },
      { label: t('extensions'), shortcut: 'Ctrl+Shift+X', action: () => (activeSidebar.value = 'extensions'), checked: activeSidebar.value === 'extensions' },
      { label: t('agent'), action: () => (activeSidebar.value = 'agent'), checked: activeSidebar.value === 'agent' },
      { label: t('settings'), action: () => (activeSidebar.value = 'settings'), checked: activeSidebar.value === 'settings' },
      { separator: true },
      { label: t('toggleSidebar'), shortcut: 'Ctrl+B', action: toggleSidebar },
      { label: t('toggleTerminal'), shortcut: 'Ctrl+J', action: toggleTerminalPanel },
      { label: isAgentCollapsed.value ? t('showAgentPanel') : t('hideAgentPanel'), action: () => (isAgentCollapsed.value = !isAgentCollapsed.value) },
      { separator: true },
      { label: t('zoomIn'), shortcut: 'Ctrl+=', action: () => zoomWindow(0.1) },
      { label: t('zoomOut'), shortcut: 'Ctrl+-', action: () => zoomWindow(-0.1) },
      { label: t('resetZoom'), shortcut: 'Ctrl+0', action: () => zoomWindow(0) }
    ]
  },
  {
    id: 'go',
    label: t('go'),
    items: [
      { label: t('focusExplorer'), shortcut: 'Ctrl+Shift+E', action: () => (activeSidebar.value = 'explorer') },
      { label: t('focusEditor'), action: focusEditor },
      { label: t('focusActiveFile'), action: focusEditor },
      { label: t('focusTerminal'), action: focusTerminal }
    ]
  },
  {
    id: 'terminal',
    label: t('terminal'),
    items: [
      { label: t('newTerminal'), shortcut: keybinds.value.terminal, action: handleNewTerminal },
      { separator: true },
      { label: t('toggleTerminal'), action: toggleTerminalPanel },
      { label: t('clearTerminal'), action: () => terminalPanelRef.value?.clearTerminal?.() },
      { label: t('killTerminal'), action: () => terminalPanelRef.value?.killTerminal?.() }
    ]
  },
  {
    id: 'window',
    label: t('window'),
    items: [
      { label: t('toggleSidebar'), action: toggleSidebar },
      { label: t('togglePanels'), action: togglePanels },
      { separator: true },
      { label: t('collapseAgentPanel'), action: () => (isAgentCollapsed.value = true), disabled: isAgentCollapsed.value },
      { label: t('showAgentPanel'), action: () => (isAgentCollapsed.value = false), disabled: !isAgentCollapsed.value }
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

function extensionFromPath(filePath) {
  return (filePath.split(/[\\/]/).pop() || '').split('.').pop()?.toLowerCase() || '';
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
  editorPanelRef.value?.focus?.();
}

function isEditorFocused() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  const cmRoot = active.closest?.('.cm-editor');
  const editorPanel = active.closest?.('.editor-panel');
  return Boolean(cmRoot || editorPanel);
}

function isTerminalFocused() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  return Boolean(active.closest?.('.terminal-panel') || active.classList?.contains('xterm-helper-textarea'));
}

function isInputFocused() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  const tag = active.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || active.isContentEditable;
}

async function handleUndo() {
  // If editor is focused, let CodeMirror handle undo natively
  if (isEditorFocused()) {
    editorPanelRef.value?.undo?.();
    return;
  }
  // If terminal or other input is focused, don't intercept
  if (isTerminalFocused()) {
    return;
  }
  // Otherwise, undo the last file operation (delete, rename, create, etc.)
  await workspaceStore.undoLastAction();
  // Dismiss the undo toast if it's showing since we've performed the undo
  undoToast.value = null;
}

async function handleRedo() {
  if (isEditorFocused()) {
    editorPanelRef.value?.redo?.();
    return;
  }
  if (isTerminalFocused()) {
    return;
  }
  await workspaceStore.redoLastAction();
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
  isTerminalCollapsed.value = !isTerminalCollapsed.value;
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
  activeSubmenu.value = '';
}

function closeMenu() {
  activeMenu.value = '';
  activeSubmenu.value = '';
}

async function runMenuAction(action) {
  closeMenu();
  await action?.();
}

function hoverMenuItem(item) {
  if (item.submenu) {
    activeSubmenu.value = item.label;
  } else {
    activeSubmenu.value = '';
  }
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

  // Command palette: Ctrl+Shift+P
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    commandPaletteOpen.value = true;
    commandPaletteQuery.value = '';
    closeMenu();
  }

  // Quick open: Ctrl+P
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'p' && !isInputFocused()) {
    event.preventDefault();
    commandPaletteOpen.value = true;
    commandPaletteQuery.value = '';
    closeMenu();
  }

  if (eventMatchesShortcut(event, keybinds.value.undo)) {
    // When editor is focused, let CodeMirror handle undo natively (don't preventDefault)
    if (isEditorFocused()) {
      return;
    }
    // When terminal is focused, don't intercept either
    if (isTerminalFocused()) {
      return;
    }
    event.preventDefault();
    handleUndo();
  }

  if (eventMatchesShortcut(event, keybinds.value.redo)) {
    if (isEditorFocused()) {
      return;
    }
    if (isTerminalFocused()) {
      return;
    }
    event.preventDefault();
    handleRedo();
  }
}

function zoomWindow(delta) {
  if (!window.mirai) {
    return;
  }
  // Zoom level is managed by Electron webContents
  const current = document.body.style.zoom ? parseFloat(document.body.style.zoom) : 1;
  const next = delta === 0 ? 1 : Math.min(2, Math.max(0.5, current + delta));
  document.body.style.zoom = String(next);
}

function normalizeInlineName(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function requestCreateFile(node = null) {
  if (!hasWorkspace.value) {
    return;
  }
  const parentPath = parentPathFor(node);
  inlineEdit.value = {
    type: 'create-file',
    targetPath: parentPath,
    isRoot: !node || node.path === '.' || node.type === 'directory' && node.path === parentPath
  };
}

function requestCreateFolder(node = null) {
  if (!hasWorkspace.value) {
    return;
  }
  const parentPath = parentPathFor(node);
  inlineEdit.value = {
    type: 'create-folder',
    targetPath: parentPath,
    isRoot: !node || node.path === '.' || node.type === 'directory' && node.path === parentPath
  };
}

function requestRenameNode(node) {
  if (!node) {
    return;
  }
  inlineEdit.value = {
    type: 'rename',
    targetPath: normalizePath(node.path),
    node
  };
}

async function requestDeleteNode(node) {
  if (!node) {
    return;
  }

  const nodePath = node.path;
  const nodeName = node.name || nodePath;

  await workspaceStore.deletePath(nodePath);

  // Show undo toast
  undoToast.value = {
    id: Date.now(),
    message: t('deletedItem').replace('{path}', nodeName),
    path: nodePath
  };

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (undoToast.value && undoToast.value.path === nodePath) {
      undoToast.value = null;
    }
  }, 10000);
}

async function handleUndoDelete() {
  const toast = undoToast.value;
  undoToast.value = null;

  const restored = await workspaceStore.undoLastAction();

  if (restored && toast?.path) {
    await workspaceStore.openFile(toast.path).catch(() => {});
  }
}

function dismissUndoToast() {
  undoToast.value = null;
}

async function confirmInlineEdit(value) {
  const edit = inlineEdit.value;
  inlineEdit.value = null;

  if (!edit) {
    return;
  }

  const cleanValue = normalizeInlineName(value);
  if (!cleanValue) {
    return;
  }

  if (edit.type === 'create-file') {
    const fullPath = edit.targetPath ? joinPath(edit.targetPath, cleanValue) : cleanValue;
    await workspaceStore.createFile(fullPath);
  }

  if (edit.type === 'create-folder') {
    const fullPath = edit.targetPath ? joinPath(edit.targetPath, cleanValue) : cleanValue;
    await workspaceStore.createFolder(fullPath);
  }

  if (edit.type === 'rename' && edit.node) {
    const parentPath = parentPathFor(edit.node);
    const newPath = parentPath ? joinPath(parentPath, cleanValue) : cleanValue;
    await workspaceStore.renamePath(edit.node.path, newPath);
  }
}

function cancelInlineEdit() {
  inlineEdit.value = null;
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

async function handleGetExtensionDetails(extensionId) {
  try {
    const detail = await desktopApi.getMarketplaceExtensionDetails?.({ extensionId });
    extensionsPanelRef.value?.updateDetailData?.(detail);
  } catch (error) {
    workspaceStore.appendLog('error', `Extension detail fetch failed: ${error?.message || error}`);
    extensionsPanelRef.value?.updateDetailData?.(null);
  }
}

// ===== Editor context menu =====

function openEditorContextMenu(event) {
  event.preventDefault();
  editorContextMenu.value = { visible: true, x: event.clientX, y: event.clientY };
}

function closeEditorContextMenu() {
  editorContextMenu.value.visible = false;
}

const editorContextMenuItems = computed(() => [
  { id: 'cut', label: t('cut'), shortcut: 'Ctrl+X', action: () => document.execCommand?.('cut') },
  { id: 'copy', label: t('copy'), shortcut: 'Ctrl+C', action: () => document.execCommand?.('copy') },
  { id: 'paste', label: t('paste'), shortcut: 'Ctrl+V', action: () => document.execCommand?.('paste') },
  { separator: true },
  { id: 'selectAll', label: t('selectAll'), shortcut: 'Ctrl+A', action: () => document.execCommand?.('selectAll') },
  { id: 'find', label: t('find'), shortcut: 'Ctrl+F', action: focusEditor },
  { id: 'replace', label: t('replace'), shortcut: 'Ctrl+H', action: () => { activeSidebar.value = 'search'; } },
  { separator: true },
  { id: 'save', label: t('saveFile'), shortcut: 'Ctrl+S', action: handleSaveFile, disabled: !activeFilePath.value },
  { id: 'format', label: t('formatDocument') || 'Format Document', action: () => editorPanelRef.value?.format?.(), disabled: !activeFilePath.value },
  { separator: true },
  { id: 'commandPalette', label: t('commandPalette'), shortcut: 'Ctrl+Shift+P', action: () => { commandPaletteOpen.value = true; commandPaletteQuery.value = ''; } },
  { id: 'goToDefinition', label: t('goToDefinition') || 'Go to Definition', action: () => editorPanelRef.value?.goToDefinition?.() }
]);

function handleEditorContextSelect(item) {
  item.action?.();
}

// ===== Tab context menu actions =====

function handleCloseOthers(filePath) {
  workspaceStore.closeOthers(filePath);
}

function handleCloseAll() {
  workspaceStore.closeAllFiles();
}

function handleCloseSaved() {
  workspaceStore.closeSavedFiles();
}

async function handleCopyPath(filePath) {
  try {
    await navigator.clipboard.writeText(filePath);
    workspaceStore.appendLog('info', `Copied path: ${filePath}`);
  } catch {
    // noop
  }
}

async function handleCopyRelativePath(filePath) {
  const relative = workspacePath.value
    ? filePath.replace(workspacePath.value.replace(/\//g, '\\'), '').replace(/^[\\\/]+/, '')
    : filePath;
  try {
    await navigator.clipboard.writeText(relative);
    workspaceStore.appendLog('info', `Copied relative path: ${relative}`);
  } catch {
    // noop
  }
}

function handleRevealInExplorer(filePath) {
  activeSidebar.value = 'explorer';
  workspaceStore.revealWorkspace(filePath);
}

// ===== Command palette =====

const commandPaletteItems = computed(() => {
  const commands = [
    { id: 'file.new', label: t('newFile'), shortcut: 'Ctrl+N', icon: 'codicon codicon-new-file', action: requestCreateFile },
    { id: 'file.newFolder', label: t('newFolder'), icon: 'codicon codicon-new-folder', action: requestCreateFolder },
    { id: 'file.open', label: t('openProject'), shortcut: 'Ctrl+O', icon: 'codicon codicon-folder-opened', action: handleOpenProject },
    { id: 'file.save', label: t('saveFile'), shortcut: 'Ctrl+S', icon: 'codicon codicon-save', action: handleSaveFile, disabled: !activeFilePath.value },
    { id: 'file.saveAll', label: t('saveAll'), icon: 'codicon codicon-save-all', action: async () => {
      for (const file of openFiles.value) {
        if (file.dirty && file.kind === 'text') {
          workspaceStore.setActiveFile(file.path);
          await workspaceStore.saveActiveFile();
        }
      }
    }, disabled: !openFiles.value.some((f) => f.dirty) },
    { separator: true },
    { id: 'view.explorer', label: t('explorer'), shortcut: 'Ctrl+Shift+E', icon: 'codicon codicon-files', action: () => activeSidebar.value = 'explorer' },
    { id: 'view.search', label: t('search'), shortcut: 'Ctrl+Shift+F', icon: 'codicon codicon-search', action: () => activeSidebar.value = 'search' },
    { id: 'view.extensions', label: t('extensions'), shortcut: 'Ctrl+Shift+X', icon: 'codicon codicon-extensions', action: () => activeSidebar.value = 'extensions' },
    { id: 'view.settings', label: t('settings'), icon: 'codicon codicon-settings-gear', action: () => activeSidebar.value = 'settings' },
    { id: 'view.toggleTerminal', label: t('toggleTerminal'), shortcut: 'Ctrl+J', icon: 'codicon codicon-terminal', action: toggleTerminalPanel },
    { id: 'view.toggleSidebar', label: t('toggleSidebar'), shortcut: 'Ctrl+B', icon: 'codicon codicon-panel-left', action: toggleSidebar },
    { separator: true },
    { id: 'terminal.new', label: t('newTerminal'), shortcut: 'Ctrl+`', icon: 'codicon codicon-terminal', action: handleNewTerminal },
    { id: 'edit.undo', label: t('undo'), shortcut: 'Ctrl+Z', icon: 'codicon codicon-discard', action: handleUndo },
    { id: 'edit.redo', label: t('redo'), shortcut: 'Ctrl+Y', icon: 'codicon codicon-redo', action: handleRedo },
    { separator: true },
    { id: 'preferences', label: t('preferences'), icon: 'codicon codicon-settings', action: () => activeSidebar.value = 'settings' }
  ];

  const q = commandPaletteQuery.value.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) => !cmd.separator && cmd.label.toLowerCase().includes(q));
});

function handleCommandSelect(item) {
  commandPaletteOpen.value = false;
  commandPaletteQuery.value = '';
  item.action?.();
}

function handleCommandPaletteKeydown(event) {
  if (event.key === 'Escape') {
    commandPaletteOpen.value = false;
    commandPaletteQuery.value = '';
  }
  if (event.key === 'Enter') {
    const first = commandPaletteItems.value.find((i) => !i.separator && !i.disabled);
    if (first) {
      handleCommandSelect(first);
    }
  }
}

// ===== Editor cursor position tracking =====

function handleEditorCursorChange(pos) {
  editorCursorPos.value = pos;
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
                <template v-for="(item, index) in menu.items" :key="item.label || `sep-${index}`">
                  <div v-if="item.separator" class="titlebar-menu__separator"></div>
                  <div
                    v-else
                    class="titlebar-menu__item-wrapper"
                    @mouseenter="hoverMenuItem(item)"
                  >
                    <button
                      class="titlebar-menu__item"
                      :class="{
                        'is-disabled': item.disabled,
                        'is-checked': item.checked,
                        'has-submenu': item.submenu
                      }"
                      :disabled="item.disabled"
                      @click="!item.disabled && !item.submenu && runMenuAction(item.action)"
                    >
                      <span class="titlebar-menu__check">
                        <span v-if="item.checked" class="codicon codicon-check"></span>
                      </span>
                      <span class="titlebar-menu__label">{{ item.label }}</span>
                      <span v-if="item.detail" class="titlebar-menu__detail">{{ item.detail }}</span>
                      <span class="titlebar-menu__shortcut">{{ item.shortcut || '' }}</span>
                      <span v-if="item.submenu" class="titlebar-menu__submenu-arrow codicon codicon-chevron-right"></span>
                    </button>
                    <div
                      v-if="item.submenu && activeSubmenu === item.label"
                      class="titlebar-menu titlebar-menu--submenu"
                    >
                      <template v-for="(subItem, subIndex) in item.submenu" :key="subItem.label || `sub-sep-${subIndex}`">
                        <div v-if="subItem.separator" class="titlebar-menu__separator"></div>
                        <button
                          v-else
                          class="titlebar-menu__item"
                          :class="{ 'is-disabled': subItem.disabled }"
                          :disabled="subItem.disabled"
                          @click="!subItem.disabled && runMenuAction(subItem.action)"
                        >
                          <span class="titlebar-menu__check"></span>
                          <span class="titlebar-menu__label">{{ subItem.label }}</span>
                          <span v-if="subItem.detail" class="titlebar-menu__detail">{{ subItem.detail }}</span>
                          <span class="titlebar-menu__shortcut">{{ subItem.shortcut || '' }}</span>
                        </button>
                      </template>
                    </div>
                  </div>
                </template>
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
            :inline-edit="inlineEdit"
            @open-project="handleOpenProject"
            @create-file="requestCreateFile"
            @create-folder="requestCreateFolder"
            @refresh-tree="workspaceStore.refreshFileTree"
            @select-node="handleTreeSelect"
            @open-recent="workspaceStore.openRecentProject"
            @rename-node="requestRenameNode"
            @delete-node="requestDeleteNode"
            @inline-confirm="confirmInlineEdit"
            @inline-cancel="cancelInlineEdit"
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
            ref="extensionsPanelRef"
            :extensions="filteredExtensions"
            :loading="extensionsState.loading"
            :query="extensionsState.query"
            :marketplace-results="extensionsState.marketplaceResults"
            :marketplace-loading="extensionsState.marketplaceLoading"
            :marketplace-query="extensionsState.marketplaceQuery"
            :active-tab="extensionsState.activeTab"
            :installing-ids="extensionsState.installingIds"
            @update:query="workspaceStore.setExtensionQuery"
            @update:marketplace-query="workspaceStore.setMarketplaceQuery"
            @update:active-tab="workspaceStore.setExtensionTab"
            @refresh="workspaceStore.loadInstalledExtensions"
            @toggle-enabled="workspaceStore.setExtensionEnabled($event.id, !$event.enabled)"
            @reveal-extension="handleRevealPath"
            @search-marketplace="workspaceStore.searchMarketplace"
            @install-extension="workspaceStore.installExtension"
            @uninstall-extension="workspaceStore.uninstallExtension"
            @get-extension-details="handleGetExtensionDetails"
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
            :word-wrap="wordWrap"
            :tab-size="tabSize"
            :line-numbers="lineNumbers"
            :minimap="minimap"
            :render-whitespace="renderWhitespace"
            :bracket-pair-colorization="bracketPairColorization"
            :cursor-blinking="cursorBlinking"
            :smooth-scrolling="smoothScrolling"
            @set-theme="workspaceStore.setTheme"
            @set-locale="changeLocale"
            @set-editor-font-family="workspaceStore.setEditorFontFamily"
            @set-editor-font-size="workspaceStore.setEditorFontSize"
            @set-auto-save="workspaceStore.setAutoSave"
            @set-compact-folders="workspaceStore.setExplorerCompactFolders"
            @set-shell-integration="workspaceStore.setTerminalShellIntegration"
            @set-terminal-font-size="workspaceStore.setTerminalFontSize"
            @set-keybind="workspaceStore.setKeybind"
            @set-word-wrap="workspaceStore.setWordWrap"
            @set-tab-size="workspaceStore.setTabSize"
            @set-line-numbers="workspaceStore.setLineNumbers"
            @set-minimap="workspaceStore.setMinimap"
            @set-render-whitespace="workspaceStore.setRenderWhitespace"
            @set-bracket-pair-colorization="workspaceStore.setBracketPairColorization"
            @set-cursor-blinking="workspaceStore.setCursorBlinking"
            @set-smooth-scrolling="workspaceStore.setSmoothScrolling"
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
          <section class="editor-section" :style="editorSectionStyle" @contextmenu="openEditorContextMenu">
            <EditorTabs
              :open-files="openFiles"
              :active-file-path="activeFilePath"
              @select="workspaceStore.setActiveFile"
              @close="handleCloseFile"
              @close-others="handleCloseOthers"
              @close-all="handleCloseAll"
              @close-saved="handleCloseSaved"
              @copy-path="handleCopyPath"
              @copy-relative-path="handleCopyRelativePath"
              @reveal-in-explorer="handleRevealInExplorer"
            />
            <MonacoEditorPanel
              ref="editorPanelRef"
              :file-path="activeFilePath"
              :file="activeFile"
              :content="activeFileContent"
              :font-size="editorFontSize"
              :font-family="editorFontFamily"
              :focus-line="editorFocusLine"
              :word-wrap="wordWrap"
              :tab-size="tabSize"
              :line-numbers="lineNumbers"
              :render-whitespace="renderWhitespace"
              :bracket-pair-colorization="bracketPairColorization"
              :cursor-blinking="cursorBlinking"
              :smooth-scrolling="smoothScrolling"
              @change="handleEditorChange"
              @save="handleSaveFile"
              @cursor-change="handleEditorCursorChange"
            />
            <TerminalPanel
              ref="terminalPanelRef"
              :workspace-path="workspacePath"
              :font-size="terminalFontSize"
              :collapsed="isTerminalCollapsed"
              :height="terminalHeight"
              @toggle-collapse="isTerminalCollapsed = !isTerminalCollapsed"
              @update:height="terminalHeight = $event"
            />
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
        <span class="statusbar__item" :class="{ 'statusbar__item--active': workspacePath }">
          <span class="codicon codicon-folder"></span>
          {{ workspacePath || t('noWorkspaceSelected') }}
        </span>
        <span class="statusbar__separator"></span>
        <span class="statusbar__item">
          <span class="codicon codicon-remote"></span>
          {{ t('mode') }}: {{ activeMode }}
        </span>
        <span class="statusbar__item">{{ t('model') }}: {{ selectedModel }}</span>
        <span v-if="activeFilePath" class="statusbar__item">
          <span class="codicon codicon-go-to-file"></span>
          {{ currentFileLabel }}
        </span>
        <span v-if="bootError" class="statusbar__error">{{ t('bridgeError') }}: {{ bootError }}</span>
        <div class="statusbar__right">
          <span v-if="activeFilePath" class="statusbar__item statusbar__pos">
            Ln {{ editorCursorPos.line }}, Col {{ editorCursorPos.col }}
          </span>
          <span v-if="activeFilePath" class="statusbar__item">{{ extensionFromPath(activeFilePath).toUpperCase() || 'TXT' }}</span>
          <span class="statusbar__item">UTF-8</span>
          <span class="statusbar__item">LF</span>
          <span class="statusbar__item statusbar__item--clickable" @click="() => activeSidebar = 'settings'">
            <span class="codicon codicon-settings-gear"></span>
          </span>
        </div>
      </footer>

      <Transition name="undo-toast">
        <div v-if="undoToast" class="undo-toast">
          <span class="undo-toast__message">{{ undoToast.message }}</span>
          <div class="undo-toast__actions">
            <button class="undo-toast__button" @click="handleUndoDelete">{{ t('undoDelete') }}</button>
            <button class="undo-toast__close codicon codicon-close" @click="dismissUndoToast"></button>
          </div>
        </div>
      </Transition>

      <!-- Editor context menu -->
      <ContextMenu
        v-if="editorContextMenu.visible"
        :items="editorContextMenuItems"
        :x="editorContextMenu.x"
        :y="editorContextMenu.y"
        @close="closeEditorContextMenu"
        @select="handleEditorContextSelect"
      />

      <!-- Command palette -->
      <Transition name="cmd-palette">
        <div v-if="commandPaletteOpen" class="command-palette-overlay" @click="commandPaletteOpen = false">
          <div class="command-palette" @click.stop>
            <div class="command-palette__input-row">
              <span class="codicon codicon-search"></span>
              <input
                ref="commandPaletteInputRef"
                v-model="commandPaletteQuery"
                class="command-palette__input"
                :placeholder="t('commandPalette') + '...'"
                @keydown="handleCommandPaletteKeydown"
                autofocus
              />
              <button class="command-palette__close codicon codicon-close" @click="commandPaletteOpen = false"></button>
            </div>
            <div class="command-palette__list">
              <template v-for="(item, index) in commandPaletteItems" :key="item.id || `sep-${index}`">
                <div v-if="item.separator" class="command-palette__separator"></div>
                <button
                  v-else
                  class="command-palette__item"
                  :class="{ 'is-disabled': item.disabled }"
                  :disabled="item.disabled"
                  @click="handleCommandSelect(item)"
                >
                  <span v-if="item.icon" class="command-palette__icon" :class="item.icon"></span>
                  <span class="command-palette__label">{{ item.label }}</span>
                  <span v-if="item.shortcut" class="command-palette__shortcut">{{ item.shortcut }}</span>
                </button>
              </template>
              <div v-if="!commandPaletteItems.some(i => !i.separator)" class="command-palette__empty">
                {{ t('noResults') || 'No matching commands' }}
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
