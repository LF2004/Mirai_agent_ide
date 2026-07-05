const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirai', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  openProjectDialog: () => ipcRenderer.invoke('dialog:open-project'),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  openWorkspace: (workspacePath) => ipcRenderer.invoke('workspace:open', workspacePath),
  listFiles: (workspacePath) => ipcRenderer.invoke('workspace:list-files', workspacePath),
  readFile: (payload) => ipcRenderer.invoke('workspace:read-file', payload),
  writeFile: (payload) => ipcRenderer.invoke('workspace:write-file', payload),
  createFile: (payload) => ipcRenderer.invoke('workspace:create-file', payload),
  createFolder: (payload) => ipcRenderer.invoke('workspace:create-folder', payload),
  renamePath: (payload) => ipcRenderer.invoke('workspace:rename-path', payload),
  deletePath: (payload) => ipcRenderer.invoke('workspace:delete-path', payload),
  saveSetting: (payload) => ipcRenderer.invoke('settings:save', payload),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:show-item-in-folder', targetPath),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),
  createTerminal: (payload) => ipcRenderer.invoke('terminal:create', payload),
  writeTerminal: (payload) => ipcRenderer.invoke('terminal:write', payload),
  readTerminal: (payload) => ipcRenderer.invoke('terminal:read', payload),
  killTerminal: (payload) => ipcRenderer.invoke('terminal:kill', payload),
  focusTerminal: (payload) => ipcRenderer.invoke('terminal:focus', payload)
});
