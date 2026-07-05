import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { DatabaseService } from './services/database-service.js';
import { WorkspaceTools } from './tools/workspace-tools.js';
import { TerminalTools } from './tools/terminal-tools.js';
import { ExtensionTools } from './tools/extension-tools.js';
import { AgentService } from './services/agent-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let databaseService = null;
let workspaceTools = null;
let terminalTools = null;
let extensionTools = null;
let agentService = null;

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
  extensionTools = new ExtensionTools(databaseService);
  agentService = new AgentService(databaseService);
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

  ipcMain.handle('workspace:write-binary-file', async (_, payload) => {
    return workspaceTools.writeBinaryFile(payload.workspacePath, payload.filePath, payload.dataUrl);
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

  ipcMain.handle('workspace:snapshot-path', async (_, payload) => {
    return workspaceTools.snapshotPath(payload.workspacePath, payload.targetPath);
  });

  ipcMain.handle('workspace:trash-path', async (_, payload) => {
    return workspaceTools.trashPath(payload.workspacePath, payload.targetPath);
  });

  ipcMain.handle('workspace:search', async (_, payload) => {
    return workspaceTools.searchWorkspace(payload.workspacePath, payload.query, payload.includeFiles, payload.excludeFiles);
  });

  ipcMain.handle('workspace:replace', async (_, payload) => {
    return workspaceTools.replaceWorkspace(payload.workspacePath, payload.query, payload.replaceText, payload.includeFiles, payload.excludeFiles);
  });

  ipcMain.handle('settings:save', async (_, payload) => {
    return databaseService.saveSetting(payload.key, payload.value);
  });

  ipcMain.handle('extensions:list-installed', async () => {
    return extensionTools.listInstalledExtensions();
  });

  ipcMain.handle('extensions:set-enabled', async (_, payload) => {
    return extensionTools.setExtensionEnabled(payload.extensionId, payload.enabled);
  });

  ipcMain.handle('shell:show-item-in-folder', async (_, targetPath) => {
    const { shell } = await import('electron');
    shell.showItemInFolder(targetPath);
    return { success: true };
  });

  ipcMain.handle('marketplace:search', async (_, payload) => {
    return searchMarketplace(payload?.query || '', payload?.pageSize || 50);
  });

  ipcMain.handle('marketplace:get-details', async (_, payload) => {
    return getMarketplaceExtensionDetails(payload?.extensionId || '');
  });

  ipcMain.handle('marketplace:install', async (_, payload) => {
    return installMarketplaceExtension(payload?.extensionId || '', payload?.version || '');
  });

  ipcMain.handle('marketplace:uninstall', async (_, payload) => {
    return uninstallMarketplaceExtension(payload?.extensionId || '');
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

  // ===== File watcher =====
  let fileWatcher = null;
  let watchDebounceTimer = null;

  ipcMain.handle('workspace:watch', async (_, payload) => {
    // Clean up existing watcher
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }

    const watchPath = payload?.workspacePath;
    if (!watchPath) return { ok: false };

    try {
      fileWatcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
        // Debounce rapid changes
        if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
        watchDebounceTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('workspace:file-changed', {
              eventType,
              filename,
              path: filename ? path.join(watchPath, filename) : watchPath
            });
          }
        }, 300);
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('workspace:unwatch', async () => {
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }
    return { ok: true };
  });

  // ===== Agent IPC handlers =====

  ipcMain.handle('agent:set-config', async (_, config) => {
    agentService.setConfig(config || {});
    return { ok: true };
  });

  ipcMain.handle('agent:get-config', async () => {
    return agentService.getConfig();
  });

  ipcMain.handle('agent:create-session', async (_, mode) => {
    return agentService.createSession(mode || 'agent');
  });

  ipcMain.handle('agent:get-messages', async (_, sessionId) => {
    return agentService.getMessages(sessionId);
  });

  ipcMain.handle('agent:clear-session', async (_, sessionId) => {
    agentService.clearSession(sessionId);
    return { ok: true };
  });

  ipcMain.handle('agent:abort', async () => {
    agentService.abort();
    return { ok: true };
  });

  // Agent send with streaming events via webContents.send
  ipcMain.handle('agent:send', async (_, payload) => {
    const { sessionId, content } = payload || {};
    if (!sessionId || !content) {
      return { ok: false, error: 'Missing sessionId or content' };
    }

    // Set workspace context if available
    const state = databaseService.getBootstrapState();
    if (state?.workspacePath) {
      agentService.setWorkspace(state.workspacePath, state.workspaceName);
    }

    await agentService.sendMessage(sessionId, content, (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:event', { sessionId, ...event });
      }
    });

    return { ok: true };
  });

  ipcMain.handle('agent:set-workspace', async (_, wsPath, wsName) => {
    agentService.setWorkspace(wsPath, wsName);
    return { ok: true };
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

function requestMarketplace(body) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      url: 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      headers: {
        Accept: 'application/json;api-version=7.2-preview.1',
        'Content-Type': 'application/json',
        'User-Agent': 'Mirai-Agent-IDE/1.0'
      }
    });

    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Marketplace response parse error: ${error.message}`));
        }
      });
      response.on('error', (error) => reject(error));
    });

    request.on('error', (error) => reject(error));
    request.write(JSON.stringify(body));
    request.end();
  });
}

function mapMarketplaceExtension(raw) {
  const publisher = raw.publisher || {};
  const latestVersion = (raw.versions || [])[0] || {};
  const stats = raw.statistics || [];
  const installStat = stats.find((s) => s.statisticName === 'install') || {};
  const averageRatingStat = stats.find((s) => s.statisticName === 'averagerating') || {};
  const ratingCountStat = stats.find((s) => s.statisticName === 'ratingcount') || {};
  const files = latestVersion.files || [];
  const iconFile = files.find((f) => f.assetType === 'Microsoft.VisualStudio.Services.Icons.Default');
  const readmeFile = files.find((f) => f.assetType === 'Microsoft.VisualStudio.Services.Content.Details');

  return {
    id: raw.extensionId || raw.extensionName,
    extensionId: raw.extensionId || `${publisher.publisherName}.${raw.extensionName}`,
    name: raw.displayName || raw.extensionName,
    extensionName: raw.extensionName,
    publisherName: publisher.publisherName || publisher.displayName || 'unknown',
    publisherDisplayName: publisher.displayName || publisher.publisherName || 'Unknown',
    shortDescription: raw.shortDescription || '',
    description: latestVersion.description || raw.shortDescription || '',
    version: latestVersion.version || '0.0.0',
    lastUpdated: latestVersion.lastUpdated || raw.lastUpdated,
    publishedDate: raw.publishedDate,
    releaseDate: raw.releaseDate,
    installs: installStat.value || 0,
    averageRating: averageRatingStat.value || 0,
    ratingCount: ratingCountStat.value || 0,
    categories: raw.categories || [],
    tags: raw.tags || [],
    iconUrl: iconFile?.source || '',
    readmeUrl: readmeFile?.source || '',
    repository: raw.repository || '',
    flags: raw.flags || ''
  };
}

async function searchMarketplace(query, pageSize = 50) {
  const criteria = [
    { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
    { filterType: 12, value: '4096' }
  ];

  if (query.trim()) {
    criteria.push({ filterType: 10, value: query });
  }

  const body = {
    filters: [
      {
        criteria,
        pageNumber: 1,
        pageSize,
        sortBy: 0,
        sortOrder: 0
      }
    ],
    assetTypes: [],
    flags: 950
  };

  const result = await requestMarketplace(body);
  const extensions = result?.results?.[0]?.extensions || [];
  return extensions.map(mapMarketplaceExtension);
}

async function getMarketplaceExtensionDetails(extensionId) {
  const [publisherName, extensionName] = extensionId.split('.');
  if (!publisherName || !extensionName) {
    throw new Error('Invalid extension id');
  }

  const body = {
    filters: [
      {
        criteria: [
          { filterType: 7, value: extensionId }
        ],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0
      }
    ],
    assetTypes: [],
    flags: 950
  };

  const result = await requestMarketplace(body);
  const extensions = result?.results?.[0]?.extensions || [];
  if (!extensions.length) {
    throw new Error('Extension not found');
  }

  return mapMarketplaceExtension(extensions[0]);
}

function getExtensionInstallDir() {
  const homeDir = os.homedir();
  const vscodeExtDir = path.join(homeDir, '.vscode', 'extensions');
  if (!fs.existsSync(vscodeExtDir)) {
    fs.mkdirSync(vscodeExtDir, { recursive: true });
  }
  return vscodeExtDir;
}

function downloadFile(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const request = net.request({
      method: 'GET',
      url
    });

    let receivedBytes = 0;
    let fileStream = null;

    request.on('response', (response) => {
      const statusCode = response.statusCode || 0;

      // Handle redirects manually (Electron net.request doesn't auto-follow cross-origin redirects)
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.destroy();
        const redirectUrl = response.headers.location;
        // Resolve relative redirects
        let finalUrl = redirectUrl;
        if (redirectUrl.startsWith('/')) {
          const parsed = new URL(url);
          finalUrl = `${parsed.origin}${redirectUrl}`;
        }
        downloadFile(finalUrl, destPath, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.destroy();
        reject(new Error(`Download failed: HTTP ${statusCode} for ${url}`));
        return;
      }

      fileStream = fs.createWriteStream(destPath);

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        fileStream.write(chunk);
      });

      response.on('end', () => {
        if (fileStream) {
          fileStream.end(() => {
            resolve({ success: true, size: receivedBytes });
          });
        }
      });

      response.on('error', (error) => {
        if (fileStream) {
          fileStream.close();
        }
        if (fs.existsSync(destPath)) {
          try { fs.unlinkSync(destPath); } catch {}
        }
        reject(error);
      });
    });

    request.on('error', (error) => {
      if (fileStream) {
        fileStream.close();
      }
      if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch {}
      }
      reject(error);
    });

    request.end();
  });
}

function extractVsix(vsixPath, targetDir) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    // Normalize paths to use forward slashes for PowerShell compatibility
    const normalizedVsix = vsixPath.replace(/\\/g, '/');
    const normalizedTarget = targetDir.replace(/\\/g, '/');

    let command;
    if (process.platform === 'win32') {
      // Use Expand-Archive with -Force, escape single quotes by doubling them
      const safeVsix = normalizedVsix.replace(/'/g, "''");
      const safeTarget = normalizedTarget.replace(/'/g, "''");
      command = `powershell -NoProfile -NonInteractive -Command "Expand-Archive -LiteralPath '${safeVsix}' -DestinationPath '${safeTarget}' -Force"`;
    } else {
      command = `unzip -o '${vsixPath}' -d '${targetDir}'`;
    }

    exec(command, { maxBuffer: 100 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Extraction failed: ${error.message}. stderr: ${stderr}`));
        return;
      }
      resolve({ success: true });
    });
  });
}

async function installMarketplaceExtension(extensionId, version = '') {
  // Get extension details to find download URL
  let details;
  try {
    details = await getMarketplaceExtensionDetails(extensionId);
  } catch (error) {
    return {
      success: false,
      extensionId,
      error: `Failed to get extension details: ${error?.message || error}`,
      message: `Failed to install ${extensionId}: ${error?.message || error}`
    };
  }

  // Construct the VSIX download URL
  // The marketplace uses the publisher name (lowercase) in the URL
  const publisher = details.publisherName;
  const name = details.extensionName;
  const ver = version || details.version;
  const vsixUrl = `https://${publisher.toLowerCase()}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${name}/${ver}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;

  // Download the VSIX file
  const tempDir = path.join(os.tmpdir(), 'mirai-installer');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const vsixPath = path.join(tempDir, `${extensionId.replace(/[^a-zA-Z0-9.-]/g, '_')}-${ver}.vsix`);

  try {
    await downloadFile(vsixUrl, vsixPath);

    // Verify the downloaded file is a valid ZIP (VSIX files are ZIP archives)
    const stats = fs.statSync(vsixPath);
    if (stats.size < 1000) {
      throw new Error('Downloaded file is too small, likely an error response');
    }

    // Check if it starts with ZIP magic bytes (PK)
    const fd = fs.openSync(vsixPath, 'r');
    const headerBuf = Buffer.alloc(4);
    fs.readSync(fd, headerBuf, 0, 4, 0);
    fs.closeSync(fd);
    if (headerBuf[0] !== 0x50 || headerBuf[1] !== 0x4b) {
      // Not a ZIP file - read the content to see what went wrong
      const errorContent = fs.readFileSync(vsixPath, 'utf8').slice(0, 500);
      throw new Error(`Downloaded file is not a valid VSIX (ZIP) package. Response: ${errorContent}`);
    }

    // Extract to extensions directory
    const extDir = getExtensionInstallDir();
    const installDirName = `${publisher}.${name}-${ver}`;
    const installPath = path.join(extDir, installDirName);

    // Remove existing installation if any
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    fs.mkdirSync(installPath, { recursive: true });
    await extractVsix(vsixPath, installPath);

    // Move extension/ contents up if VSIX has an extension/ subfolder
    const extensionSubDir = path.join(installPath, 'extension');
    if (fs.existsSync(extensionSubDir) && fs.statSync(extensionSubDir).isDirectory()) {
      const items = fs.readdirSync(extensionSubDir);
      for (const item of items) {
        const src = path.join(extensionSubDir, item);
        const dst = path.join(installPath, item);
        if (fs.existsSync(dst)) {
          fs.rmSync(dst, { recursive: true, force: true });
        }
        fs.renameSync(src, dst);
      }
      fs.rmSync(extensionSubDir, { recursive: true, force: true });
    }

    // Clean up VSIX file
    try { fs.unlinkSync(vsixPath); } catch {}

    return {
      success: true,
      extensionId,
      version: ver,
      installPath,
      message: `Extension ${extensionId} v${ver} installed successfully.`
    };
  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(vsixPath)) {
      try { fs.unlinkSync(vsixPath); } catch {}
    }
    return {
      success: false,
      extensionId,
      error: error?.message || String(error),
      message: `Failed to install ${extensionId}: ${error?.message || error}`
    };
  }
}

async function uninstallMarketplaceExtension(extensionId) {
  const extDir = getExtensionInstallDir();
  const parts = extensionId.split('.');
  // Extension IDs can have multiple dots (e.g., ms-python.python)
  // The directory format is publisher.extension-version
  // So we need to match the prefix flexibly

  let removed = false;
  let removedPaths = [];
  try {
    const entries = fs.readdirSync(extDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Match by extensionId prefix (case-insensitive)
      // Directory format: publisher.extensionName-version
      const entryLower = entry.name.toLowerCase();
      const idLower = extensionId.toLowerCase();
      if (entryLower.startsWith(idLower + '-') || entryLower === idLower) {
        const fullPath = path.join(extDir, entry.name);
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed = true;
        removedPaths.push(fullPath);
      }
    }
  } catch (error) {
    return {
      success: false,
      extensionId,
      error: error?.message || String(error),
      message: `Failed to uninstall: ${error?.message || error}`
    };
  }

  return {
    success: removed,
    extensionId,
    removedPaths,
    message: removed
      ? `Extension ${extensionId} uninstalled.`
      : `Extension ${extensionId} was not found in extensions directory.`
  };
}
