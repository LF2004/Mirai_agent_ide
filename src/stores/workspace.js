import { defineStore } from 'pinia';
import { APP_MODES, DEFAULT_MODEL } from '../../type/models.js';
import { DEFAULT_THEME, IDE_SETTINGS_DEFAULTS } from '../../type/themes.js';
import { getDesktopApi } from '../services/desktop.js';

const desktopApi = getDesktopApi();

function fileNameFromPath(filePath) {
  return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
}

function isSameOrChildPath(candidate, parentPath) {
  return candidate === parentPath || candidate.startsWith(`${parentPath}/`) || candidate.startsWith(`${parentPath}\\`);
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
    }
  },
  actions: {
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
    async revealWorkspace() {
      if (!this.workspacePath || this.workspacePath.startsWith('mock://')) {
        return;
      }

      await desktopApi.showItemInFolder(this.workspacePath);
    }
  }
});
