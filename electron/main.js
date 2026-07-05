import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { DatabaseService } from './services/database-service.js';
import { WorkspaceTools } from './tools/workspace-tools.js';
import { TerminalTools } from './tools/terminal-tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let databaseService = null;
let workspaceTools = null;
let terminalTools = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#1e1e1e',
    title: 'Mirai Agent IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

async function bootstrapServices() {
  databaseService = new DatabaseService(app.getPath('userData'));
  await databaseService.initialize();
  workspaceTools = new WorkspaceTools(databaseService);
  terminalTools = new TerminalTools();
}

function registerIpcHandlers() {
  ipcMain.handle('app:bootstrap', async () => {
    const state = databaseService.getBootstrapState();

    return {
      ...state,
      appInfo: {
        name: app.getName(),
        version: app.getVersion()
      }
    };
  });

  ipcMain.handle('dialog:open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Project',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return workspaceTools.openProject(result.filePaths[0]);
  });

  ipcMain.handle('project:create', async (_, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose New Project Location',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return workspaceTools.createProject({
      baseDir: result.filePaths[0],
      name: payload?.name || 'mirai-project'
    });
  });

  ipcMain.handle('workspace:open', async (_, workspacePath) => {
    return workspaceTools.openProject(workspacePath);
  });

  ipcMain.handle('workspace:list-files', async (_, workspacePath) => {
    return workspaceTools.getFileTree(workspacePath);
  });

  ipcMain.handle('workspace:read-file', async (_, payload) => {
    return workspaceTools.readFile(payload.workspacePath, payload.filePath);
  });

  ipcMain.handle('workspace:write-file', async (_, payload) => {
    return workspaceTools.writeFile(payload.workspacePath, payload.filePath, payload.content);
  });

  ipcMain.handle('workspace:create-file', async (_, payload) => {
    return workspaceTools.createFile(payload.workspacePath, payload.relativePath);
  });

  ipcMain.handle('workspace:create-folder', async (_, payload) => {
    return workspaceTools.createFolder(payload.workspacePath, payload.relativePath);
  });

  ipcMain.handle('workspace:rename-path', async (_, payload) => {
    return workspaceTools.renamePath(payload.workspacePath, payload.oldPath, payload.newPath);
  });

  ipcMain.handle('workspace:delete-path', async (_, payload) => {
    return workspaceTools.deletePath(payload.workspacePath, payload.targetPath);
  });

  ipcMain.handle('settings:save', async (_, payload) => {
    return databaseService.saveSetting(payload.key, payload.value);
  });

  ipcMain.handle('shell:show-item-in-folder', async (_, targetPath) => {
    const { shell } = await import('electron');
    shell.showItemInFolder(targetPath);
    return { success: true };
  });

  ipcMain.handle('terminal:list', async () => {
    return terminalTools.listTerminals();
  });

  ipcMain.handle('terminal:create', async (_, payload) => {
    return terminalTools.createTerminal(payload || {});
  });

  ipcMain.handle('terminal:write', async (_, payload) => {
    return terminalTools.write(payload.terminalId, payload.value);
  });

  ipcMain.handle('terminal:read', async (_, payload) => {
    return terminalTools.read(payload.terminalId);
  });

  ipcMain.handle('terminal:kill', async (_, payload) => {
    return terminalTools.kill(payload.terminalId);
  });

  ipcMain.handle('terminal:focus', async (_, payload) => {
    return terminalTools.focusTerminal(payload.terminalId);
  });
}

app.whenReady().then(async () => {
  await bootstrapServices();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
