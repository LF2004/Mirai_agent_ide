const inMemoryWorkspace = {
  recentProjects: [],
  settings: {
    lastMode: 'agent',
    lastModel: 'gpt-4.1',
    theme: 'cursor-dark'
  }
};

function createDirectoryNode(name, nodePath) {
  return {
    name,
    path: nodePath,
    type: 'directory',
    children: []
  };
}

function sortTree(node) {
  if (!node.children) {
    return node;
  }

  node.children.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') {
      return -1;
    }
    if (left.type !== 'directory' && right.type === 'directory') {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortTree);
  return node;
}

function buildTreeFromMemory(files, folders) {
  const root = {
    name: 'demo-workspace',
    path: '.',
    type: 'directory',
    children: []
  };

  const directories = new Map([['', root]]);

  function ensureDirectory(relativePath) {
    const cleanPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (directories.has(cleanPath)) {
      return directories.get(cleanPath);
    }

    const parts = cleanPath.split('/').filter(Boolean);
    let currentPath = '';
    let currentNode = root;

    for (const part of parts) {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      let nextNode = directories.get(nextPath);
      if (!nextNode) {
        nextNode = createDirectoryNode(part, nextPath);
        directories.set(nextPath, nextNode);
        currentNode.children.push(nextNode);
      }
      currentPath = nextPath;
      currentNode = nextNode;
    }

    return currentNode;
  }

  for (const folderPath of folders) {
    ensureDirectory(folderPath);
  }

  for (const filePath of files.keys()) {
    const cleanPath = filePath.replace(/\\/g, '/');
    const parts = cleanPath.split('/');
    const name = parts.pop();
    const parent = ensureDirectory(parts.join('/'));
    parent.children.push({
      name,
      path: cleanPath,
      type: 'file'
    });
  }

  return sortTree(root);
}

function buildMockApi() {
  const files = new Map([
    ['README.md', '# Mirai Agent IDE\n\nMock workspace running in browser fallback mode.\n'],
    ['src/main.js', "console.log('Mirai Agent IDE mock workspace');\n"],
    [
      'src/App.vue',
      `<template>\n  <div class="app">Mirai Agent IDE mock workspace</div>\n</template>\n`
    ],
    [
      'assets/logo.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" rx="24" fill="#1f2430"/><circle cx="85" cy="80" r="42" fill="#4d8dff"/><path d="M120 45h52l-26 70z" fill="#8dc149"/></svg>'
    ]
  ]);
  const folders = new Set(['src', 'assets']);
  const workspacePath = 'mock://workspace';

  return {
    async bootstrap() {
      return {
        recentProjects: inMemoryWorkspace.recentProjects,
        settings: inMemoryWorkspace.settings,
        appInfo: {
          name: 'Mirai Agent IDE',
          version: 'browser-preview'
        }
      };
    },
    async openProjectDialog() {
      return {
        name: 'demo-workspace',
        path: workspacePath,
        tree: buildTreeFromMemory(files, folders)
      };
    },
    async createProject(payload) {
      return {
        name: payload?.name || 'demo-workspace',
        path: workspacePath,
        tree: buildTreeFromMemory(files, folders)
      };
    },
    async openWorkspace() {
      return {
        name: 'demo-workspace',
        path: workspacePath,
        tree: buildTreeFromMemory(files, folders)
      };
    },
    async listFiles() {
      return buildTreeFromMemory(files, folders);
    },
    async readFile(payload) {
      const extension = payload.filePath.split('.').pop()?.toLowerCase();
      if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(extension)) {
        const content = files.get(payload.filePath) || '';
        const mime = extension === 'svg' ? 'image/svg+xml' : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
        return {
          path: payload.filePath,
          kind: 'image',
          mime,
          size: content.length,
          content: '',
          dataUrl: `data:${mime};base64,${btoa(content)}`
        };
      }
      return {
        path: payload.filePath,
        kind: 'text',
        mime: 'text/plain',
        size: files.get(payload.filePath)?.length || 0,
        content: files.get(payload.filePath) || ''
      };
    },
    async writeFile(payload) {
      files.set(payload.filePath, payload.content || '');
      return {
        success: true,
        path: payload.filePath,
        savedAt: new Date().toISOString()
      };
    },
    async createFile(payload) {
      files.set(payload.relativePath, '');
      const parts = payload.relativePath.split('/');
      parts.pop();
      if (parts.length) {
        folders.add(parts.join('/'));
      }
      return {
        success: true,
        path: payload.relativePath
      };
    },
    async createFolder(payload) {
      folders.add(payload.relativePath);
      return {
        success: true,
        path: payload.relativePath
      };
    },
    async renamePath(payload) {
      if (files.has(payload.oldPath)) {
        files.set(payload.newPath, files.get(payload.oldPath));
        files.delete(payload.oldPath);
      }
      if (folders.has(payload.oldPath)) {
        folders.delete(payload.oldPath);
        folders.add(payload.newPath);
        for (const key of Array.from(files.keys())) {
          if (key.startsWith(`${payload.oldPath}/`)) {
            const nextKey = key.replace(payload.oldPath, payload.newPath);
            files.set(nextKey, files.get(key));
            files.delete(key);
          }
        }
      }
      return {
        success: true,
        oldPath: payload.oldPath,
        newPath: payload.newPath
      };
    },
    async deletePath(payload) {
      folders.delete(payload.targetPath);
      for (const key of Array.from(files.keys())) {
        if (key === payload.targetPath || key.startsWith(`${payload.targetPath}/`)) {
          files.delete(key);
        }
      }
      for (const key of Array.from(folders)) {
        if (key.startsWith(`${payload.targetPath}/`)) {
          folders.delete(key);
        }
      }
      return {
        success: true,
        path: payload.targetPath
      };
    },
    async searchWorkspace(payload) {
      const query = String(payload?.query || '').trim().toLowerCase();
      if (!query) {
        return [];
      }

      const includeFiles = String(payload?.includeFiles || '*').toLowerCase();
      const excludeFiles = String(payload?.excludeFiles || '').toLowerCase();
      const results = [];

      for (const [filePath, content] of files.entries()) {
        const lowerPath = filePath.toLowerCase();
        if (excludeFiles && excludeFiles.split(',').some((item) => item.trim() && lowerPath.includes(item.trim().replace(/^\*\./, '.').replace(/^\*/, '')))) {
          continue;
        }
        if (includeFiles !== '*' && includeFiles && !lowerPath.endsWith(includeFiles.replace('*', ''))) {
          continue;
        }

        String(content || '')
          .split(/\r?\n/)
          .forEach((line, index) => {
            if (line.toLowerCase().includes(query)) {
              results.push({
                path: filePath,
                lineNumber: index + 1,
                preview: line.trim()
              });
            }
          });
      }

      return results;
    },
    async replaceWorkspace(payload) {
      const results = await this.searchWorkspace(payload);
      const query = String(payload?.query || '');
      const replaceText = String(payload?.replaceText || '');

      if (!query) {
        return [];
      }

      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const updated = [];

      for (const result of results) {
        const current = files.get(result.path) || '';
        const next = current.replace(pattern, replaceText);
        if (next !== current) {
          files.set(result.path, next);
          updated.push({ path: result.path });
        }
      }

      return updated;
    },
    async saveSetting(payload) {
      inMemoryWorkspace.settings[payload.key] = payload.value;
      return {
        success: true,
        key: payload.key,
        value: payload.value
      };
    },
    async listInstalledExtensions() {
      return [
        {
          id: 'mock.theme-dark',
          name: 'Mock Dark Theme',
          description: 'Mock VS Code extension for preview mode.',
          version: '0.0.1',
          publisher: 'mirai',
          categories: ['Themes'],
          rootPath: 'mock://extensions',
          path: 'mock://extensions/mock-theme-dark',
          enabled: true,
          icon: '',
          engine: '^1.90.0',
          contributes: {
            themes: 1,
            grammars: 0,
            languages: 0,
            commands: 0
          }
        }
      ];
    },
    async setExtensionEnabled(payload) {
      return {
        success: true,
        id: payload.extensionId,
        enabled: Boolean(payload.enabled)
      };
    },
    async listTerminals() {
      return [];
    },
    async createTerminal(payload) {
      return {
        id: 'mock-terminal-1',
        name: payload?.name || 'Terminal 1',
        cwd: payload?.cwd || workspacePath,
        createdAt: new Date().toISOString(),
        exited: false,
        buffer: ''
      };
    },
    async writeTerminal() {
      return { success: true };
    },
    async readTerminal() {
      return {
        id: 'mock-terminal-1',
        name: 'Terminal 1',
        cwd: workspacePath,
        createdAt: new Date().toISOString(),
        exited: false,
        buffer: ''
      };
    },
    async killTerminal() {
      return { success: true };
    },
    async showItemInFolder() {
      return { success: true };
    }
  };
}

export function getDesktopApi() {
  if (window.mirai) {
    return window.mirai;
  }

  return buildMockApi();
}
