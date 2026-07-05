import { defineStore } from 'pinia';
import { APP_MODES, DEFAULT_MODEL } from '../../type/models.js';
import { DEFAULT_THEME, IDE_SETTINGS_DEFAULTS } from '../../type/themes.js';
import { getDesktopApi } from '../services/desktop.js';
import { LOCALES, setLocale } from '../utils/i18n.js';

const desktopApi = getDesktopApi();

function fileNameFromPath(filePath) {
  return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
}

function isSameOrChildPath(candidate, parentPath) {
  return candidate === parentPath || candidate.startsWith(`${parentPath}/`) || candidate.startsWith(`${parentPath}\\`);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    isReady: false,
    bootError: '',
    appInfo: {
      name: 'Mirai Agent IDE',
      version: '0.0.0'
    },
    settings: {},
    recentProjects: [],
    workspaceName: '',
    workspacePath: '',
    fileTree: null,
    openFiles: [],
    activeFilePath: '',
    activeMode: APP_MODES.AGENT,
    selectedModel: DEFAULT_MODEL,
    activeTheme: DEFAULT_THEME,
    editorFontSize: IDE_SETTINGS_DEFAULTS.editorFontSize,
    editorFontFamily: IDE_SETTINGS_DEFAULTS.editorFontFamily,
    terminalFontSize: IDE_SETTINGS_DEFAULTS.terminalFontSize,
    explorerCompactFolders: IDE_SETTINGS_DEFAULTS.explorerCompactFolders,
    terminalShellIntegration: IDE_SETTINGS_DEFAULTS.terminalShellIntegration,
    autoSave: IDE_SETTINGS_DEFAULTS.autoSave,
    locale: IDE_SETTINGS_DEFAULTS.locale,
    searchState: {
      query: '',
      replace: '',
      includeFiles: '*.js,*.vue,*.ts,*.json',
      excludeFiles: 'node_modules,dist,.git',
      replaceExpanded: false,
      results: []
    },
    extensionsState: {
      installed: [],
      query: '',
      loading: false
    },
    keybinds: {
      openProject: 'Ctrl+O',
      newFile: 'Ctrl+N',
      saveFile: 'Ctrl+S',
      search: 'Ctrl+Shift+F',
      replace: 'Ctrl+Shift+H',
      terminal: 'Ctrl+`',
      undo: 'Ctrl+Z',
      redo: 'Ctrl+Y'
    },
    historyStack: [],
    logs: [
      {
        id: 'boot-log',
        level: 'info',
        message: 'Renderer started. Waiting for desktop bridge.'
      }
    ]
  }),
  getters: {
    activeFile(state) {
      return state.openFiles.find((file) => file.path === state.activeFilePath) || null;
    },
    activeFileContent() {
      return this.activeFile?.content || '';
    },
    searchResultsCount(state) {
      return state.searchState.results.length;
    },
    filteredExtensions(state) {
      const query = String(state.extensionsState.query || '').trim().toLowerCase();
      if (!query) {
        return state.extensionsState.installed;
      }

      return state.extensionsState.installed.filter((extension) =>
        [
          extension.name,
          extension.id,
          extension.description,
          extension.publisher,
          ...(extension.categories || [])
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      );
    }
  },
  actions: {
    pushHistory(entry) {
      this.historyStack.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...entry
      });
      this.historyStack = this.historyStack.slice(0, 80);
    },
    recordFileHistory(type, payload) {
      this.pushHistory({
        type,
        payload: cloneValue(payload)
      });
    },
    async undoLastAction() {
      const entry = this.historyStack.shift();
      if (!entry) {
        return;
      }

      if (entry.type === 'create-file' || entry.type === 'create-folder') {
        await desktopApi.deletePath?.({
          workspacePath: this.workspacePath,
          targetPath: entry.payload.path
        });
      }

      if (entry.type === 'delete-path') {
        if (entry.payload.kind === 'file') {
          await desktopApi.createFile?.({
            workspacePath: this.workspacePath,
            relativePath: entry.payload.path
          });
          await desktopApi.writeFile?.({
            workspacePath: this.workspacePath,
            filePath: entry.payload.path,
            content: entry.payload.content || ''
          });
        }

        if (entry.payload.kind === 'folder') {
          await desktopApi.createFolder?.({
            workspacePath: this.workspacePath,
            relativePath: entry.payload.path
          });
        }

        if (Array.isArray(entry.payload.children)) {
          for (const child of entry.payload.children) {
            if (child.kind === 'file') {
              await desktopApi.createFile?.({
                workspacePath: this.workspacePath,
                relativePath: child.path
              });
              await desktopApi.writeFile?.({
                workspacePath: this.workspacePath,
                filePath: child.path,
                content: child.content || ''
              });
            } else {
              await desktopApi.createFolder?.({
                workspacePath: this.workspacePath,
                relativePath: child.path
              });
            }
          }
        }
      }

      if (entry.type === 'rename-path') {
        await desktopApi.renamePath?.({
          workspacePath: this.workspacePath,
          oldPath: entry.payload.newPath,
          newPath: entry.payload.oldPath
        });
      }

      if (entry.type === 'write-file') {
        await desktopApi.writeFile?.({
          workspacePath: this.workspacePath,
          filePath: entry.payload.path,
          content: entry.payload.beforeContent || ''
        });
      }

      await this.refreshFileTree();
    },
    appendLog(level, message) {
      this.logs.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        level,
        message
      });
    },
    async bootstrap() {
      try {
        const payload = await desktopApi.bootstrap();
        this.appInfo = payload.appInfo;
        this.settings = payload.settings;
        this.recentProjects = payload.recentProjects;
        this.activeMode = payload.settings.lastMode || APP_MODES.AGENT;
        this.selectedModel = payload.settings.lastModel || DEFAULT_MODEL;
        this.activeTheme = payload.settings.theme || DEFAULT_THEME;
        this.editorFontSize = payload.settings.editorFontSize || IDE_SETTINGS_DEFAULTS.editorFontSize;
        this.editorFontFamily = payload.settings.editorFontFamily || IDE_SETTINGS_DEFAULTS.editorFontFamily;
        this.terminalFontSize = payload.settings.terminalFontSize || IDE_SETTINGS_DEFAULTS.terminalFontSize;
        this.explorerCompactFolders = payload.settings.explorerCompactFolders ?? IDE_SETTINGS_DEFAULTS.explorerCompactFolders;
        this.terminalShellIntegration = payload.settings.terminalShellIntegration ?? IDE_SETTINGS_DEFAULTS.terminalShellIntegration;
        this.autoSave = payload.settings.autoSave || IDE_SETTINGS_DEFAULTS.autoSave;
        this.locale = payload.settings.locale || IDE_SETTINGS_DEFAULTS.locale;
        this.keybinds = {
          ...this.keybinds,
          openProject: payload.settings['keybind.openProject'] || this.keybinds.openProject,
          newFile: payload.settings['keybind.newFile'] || this.keybinds.newFile,
          saveFile: payload.settings['keybind.saveFile'] || this.keybinds.saveFile,
          search: payload.settings['keybind.search'] || this.keybinds.search,
          replace: payload.settings['keybind.replace'] || this.keybinds.replace,
          terminal: payload.settings['keybind.terminal'] || this.keybinds.terminal,
          undo: payload.settings['keybind.undo'] || this.keybinds.undo,
          redo: payload.settings['keybind.redo'] || this.keybinds.redo
        };
        setLocale(this.locale);
        await this.loadInstalledExtensions();
        this.appendLog('success', 'Desktop bridge connected.');
      } catch (error) {
        this.bootError = error?.message || String(error);
        this.appendLog('error', `Bootstrap failed: ${this.bootError}`);
      } finally {
        this.isReady = true;
      }
    },
    async openProjectFromDialog() {
      const result = await desktopApi.openProjectDialog();
      if (!result || result.canceled) {
        return;
      }
      await this.applyWorkspace(result);
    },
    async createProject(name) {
      const result = await desktopApi.createProject({ name });
      if (!result || result.canceled) {
        return;
      }
      await this.applyWorkspace(result);
    },
    async openRecentProject(workspacePath) {
      const result = await desktopApi.openWorkspace(workspacePath);
      await this.applyWorkspace(result);
    },
    async applyWorkspace(result) {
      this.workspaceName = result.name;
      this.workspacePath = result.path;
      this.fileTree = result.tree;
      this.bootError = '';
      this.appendLog('info', `Workspace opened: ${result.path}`);
      this.recentProjects = [
        {
          name: result.name,
          path: result.path
        },
        ...this.recentProjects.filter((project) => project.path !== result.path)
      ].slice(0, 8);
      this.openFiles = [];
      this.activeFilePath = '';

      this.appendLog('info', 'Select a file from Explorer to open it in the editor.');
    },
    findFirstFile(node) {
      if (!node) {
        return null;
      }

      if (node.type === 'file') {
        return node;
      }

      for (const child of node.children || []) {
        const match = this.findFirstFile(child);
        if (match) {
          return match;
        }
      }

      return null;
    },
    async refreshFileTree() {
      if (!this.workspacePath) {
        return;
      }
      this.fileTree = await desktopApi.listFiles(this.workspacePath);
    },
    async openFile(filePath) {
      if (!this.workspacePath) {
        return;
      }

      const existing = this.openFiles.find((file) => file.path === filePath);
      if (existing) {
        this.activeFilePath = filePath;
        return;
      }

      const result = await desktopApi.readFile({
        workspacePath: this.workspacePath,
        filePath
      });

      this.openFiles.push({
        name: fileNameFromPath(result.path),
        path: result.path,
        kind: result.kind || 'text',
        mime: result.mime || 'text/plain',
        size: result.size || 0,
        content: result.content || '',
        dataUrl: result.dataUrl || '',
        dirty: false
      });
      this.activeFilePath = result.path;
      this.appendLog('info', `Opened file: ${result.path}`);
    },
    setActiveFile(filePath) {
      this.activeFilePath = filePath;
    },
    setActiveFileContent(content) {
      const target = this.openFiles.find((file) => file.path === this.activeFilePath);
      if (!target) {
        return;
      }

      if (!target.dirty) {
        this.recordFileHistory('write-file', {
          path: target.path,
          beforeContent: target.content
        });
      }

      target.content = content;
      target.dirty = true;
    },
    closeFile(filePath) {
      const index = this.openFiles.findIndex((file) => file.path === filePath);
      if (index === -1) {
        return;
      }

      this.openFiles.splice(index, 1);

      if (this.activeFilePath === filePath) {
        this.activeFilePath = this.openFiles[index - 1]?.path || this.openFiles[index]?.path || '';
      }
    },
    async saveActiveFile() {
      if (!this.workspacePath || !this.activeFile || this.activeFile.kind !== 'text') {
        return;
      }

      await desktopApi.writeFile({
        workspacePath: this.workspacePath,
        filePath: this.activeFile.path,
        content: this.activeFile.content
      });

      this.activeFile.dirty = false;
      await this.refreshFileTree();
      this.appendLog('success', `Saved file: ${this.activeFile.path}`);
    },
    async createFile(relativePath) {
      if (!this.workspacePath || !relativePath) {
        return;
      }

      await desktopApi.createFile({
        workspacePath: this.workspacePath,
        relativePath
      });

      this.recordFileHistory('create-file', { path: relativePath });
      await this.refreshFileTree();
      await this.openFile(relativePath);
      this.appendLog('success', `Created file: ${relativePath}`);
    },
    async createFolder(relativePath) {
      if (!this.workspacePath || !relativePath) {
        return;
      }

      await desktopApi.createFolder({
        workspacePath: this.workspacePath,
        relativePath
      });

      this.recordFileHistory('create-folder', { path: relativePath });
      await this.refreshFileTree();
      this.appendLog('success', `Created folder: ${relativePath}`);
    },
    async renamePath(oldPath, newPath) {
      if (!this.workspacePath || !oldPath || !newPath || oldPath === newPath) {
        return;
      }

      await desktopApi.renamePath({
        workspacePath: this.workspacePath,
        oldPath,
        newPath
      });

      this.recordFileHistory('rename-path', {
        oldPath,
        newPath
      });

      for (const file of this.openFiles) {
        if (isSameOrChildPath(file.path, oldPath)) {
          file.path = file.path.replace(oldPath, newPath);
          file.name = fileNameFromPath(file.path);
        }
      }

      if (isSameOrChildPath(this.activeFilePath, oldPath)) {
        this.activeFilePath = this.activeFilePath.replace(oldPath, newPath);
      }

      await this.refreshFileTree();
      this.appendLog('success', `Renamed: ${oldPath} -> ${newPath}`);
    },
    async deletePath(targetPath) {
      if (!this.workspacePath || !targetPath) {
        return;
      }

      await desktopApi.deletePath({
        workspacePath: this.workspacePath,
        targetPath
      });

      const deletedSnapshots = this.openFiles
        .filter((file) => isSameOrChildPath(file.path, targetPath))
        .map((file) => ({
          kind: file.kind,
          path: file.path,
          content: file.content
        }));

      this.recordFileHistory('delete-path', {
        path: targetPath,
        kind: deletedSnapshots.length ? 'folder' : 'file',
        children: deletedSnapshots.length ? deletedSnapshots : null,
        content: deletedSnapshots[0]?.content || ''
      });

      this.openFiles = this.openFiles.filter((file) => !isSameOrChildPath(file.path, targetPath));
      if (isSameOrChildPath(this.activeFilePath, targetPath)) {
        this.activeFilePath = this.openFiles[0]?.path || '';
      }

      await this.refreshFileTree();
      this.appendLog('success', `Deleted: ${targetPath}`);
    },
    setMode(mode) {
      this.activeMode = mode;
      desktopApi.saveSetting?.({
        key: 'lastMode',
        value: mode
      });
      this.appendLog('info', `Mode changed: ${mode}`);
    },
    setModel(model) {
      this.selectedModel = model;
      desktopApi.saveSetting?.({
        key: 'lastModel',
        value: model
      });
      this.appendLog('info', `Model changed: ${model}`);
    },
    async setTheme(themeId) {
      this.activeTheme = themeId;
      this.settings = {
        ...this.settings,
        theme: themeId
      };

      await desktopApi.saveSetting?.({
        key: 'theme',
        value: themeId
      });

      this.appendLog('info', `Theme changed: ${themeId}`);
    },
    async setEditorFontSize(size) {
      this.editorFontSize = Number(size) || IDE_SETTINGS_DEFAULTS.editorFontSize;
      await desktopApi.saveSetting?.({
        key: 'editorFontSize',
        value: this.editorFontSize
      });
    },
    async setEditorFontFamily(fontFamily) {
      this.editorFontFamily = String(fontFamily || IDE_SETTINGS_DEFAULTS.editorFontFamily);
      await desktopApi.saveSetting?.({
        key: 'editorFontFamily',
        value: this.editorFontFamily
      });
    },
    async setTerminalFontSize(size) {
      this.terminalFontSize = Number(size) || IDE_SETTINGS_DEFAULTS.terminalFontSize;
      await desktopApi.saveSetting?.({
        key: 'terminalFontSize',
        value: this.terminalFontSize
      });
    },
    async setExplorerCompactFolders(value) {
      this.explorerCompactFolders = Boolean(value);
      await desktopApi.saveSetting?.({
        key: 'explorerCompactFolders',
        value: this.explorerCompactFolders
      });
    },
    async setTerminalShellIntegration(value) {
      this.terminalShellIntegration = Boolean(value);
      await desktopApi.saveSetting?.({
        key: 'terminalShellIntegration',
        value: this.terminalShellIntegration
      });
    },
    async setAutoSave(mode) {
      this.autoSave = mode;
      await desktopApi.saveSetting?.({
        key: 'autoSave',
        value: mode
      });
    },
    async setLocale(value) {
      this.locale = value === LOCALES.EN ? LOCALES.EN : LOCALES.ZH;
      setLocale(this.locale);
      await desktopApi.saveSetting?.({
        key: 'locale',
        value: this.locale
      });
    },
    setExtensionQuery(value) {
      this.extensionsState.query = String(value || '');
    },
    async loadInstalledExtensions() {
      this.extensionsState.loading = true;
      try {
        const extensions = await desktopApi.listInstalledExtensions?.();
        this.extensionsState.installed = Array.isArray(extensions) ? extensions : [];
      } catch (error) {
        this.appendLog('error', `Extensions load failed: ${error?.message || error}`);
        this.extensionsState.installed = [];
      } finally {
        this.extensionsState.loading = false;
      }
    },
    async setExtensionEnabled(extensionId, enabled) {
      if (!extensionId) {
        return;
      }

      await desktopApi.setExtensionEnabled?.({
        extensionId,
        enabled
      });

      this.extensionsState.installed = this.extensionsState.installed.map((extension) =>
        extension.id === extensionId ? { ...extension, enabled: Boolean(enabled) } : extension
      );
    },
    async setKeybind(action, value) {
      if (!action) {
        return;
      }

      this.keybinds = {
        ...this.keybinds,
        [action]: String(value || '').trim()
      };

      await desktopApi.saveSetting?.({
        key: `keybind.${action}`,
        value: this.keybinds[action]
      });
    },
    async runSearch(query, replaceText = '') {
      const nextQuery = typeof query === 'object' && query !== null ? query.query : query;
      const nextReplace = typeof query === 'object' && query !== null ? query.replace : replaceText;
      const nextInclude = typeof query === 'object' && query !== null ? query.includeFiles : this.searchState.includeFiles;
      const nextExclude = typeof query === 'object' && query !== null ? query.excludeFiles : this.searchState.excludeFiles;
      const q = String(nextQuery || '').trim();
      this.searchState.query = q;
      this.searchState.replace = String(nextReplace || '');
      this.searchState.includeFiles = String(nextInclude || '');
      this.searchState.excludeFiles = String(nextExclude || '');
      this.searchState.results = [];

      if (!q || !this.workspacePath) {
        return [];
      }

      const matches = await desktopApi.searchWorkspace?.({
        workspacePath: this.workspacePath,
        query: q,
        replaceText: this.searchState.replace,
        includeFiles: this.searchState.includeFiles,
        excludeFiles: this.searchState.excludeFiles
      });

      this.searchState.results = Array.isArray(matches) ? matches : [];
      return this.searchState.results;
    },
    async replaceInSearchResults() {
      if (!this.searchState.query || !this.workspacePath) {
        return [];
      }

      const changes = await desktopApi.replaceWorkspace?.({
        workspacePath: this.workspacePath,
        query: this.searchState.query,
        replaceText: this.searchState.replace,
        includeFiles: this.searchState.includeFiles,
        excludeFiles: this.searchState.excludeFiles
      });

      await this.refreshFileTree();
      this.appendLog('success', `Replace completed for: ${this.searchState.query}`);
      return Array.isArray(changes) ? changes : [];
    },
    async revealWorkspace(targetPath = '') {
      const resolvedTarget = targetPath || this.workspacePath;
      if (!resolvedTarget || resolvedTarget.startsWith('mock://')) {
        return;
      }

      await desktopApi.showItemInFolder(resolvedTarget);
    }
  }
});
