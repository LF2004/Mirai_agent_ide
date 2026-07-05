import fs from 'node:fs';
import path from 'node:path';
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspacePath,
  getFileTree,
  isCollapsedDirectoryName,
  readWorkspaceFile,
  renameWorkspacePath,
  resolveInsideWorkspace,
  writeWorkspaceFile,
  assertSafeWorkspace
} from './file-tools.js';

const SEARCHABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.json', '.jsonc', '.md', '.mdx', '.html', '.htm',
  '.css', '.scss', '.less', '.yml', '.yaml', '.txt', '.xml', '.cjs', '.mjs'
]);

export class WorkspaceTools {
  constructor(databaseService) {
    this.databaseService = databaseService;
  }

  openProject(workspacePath) {
    const normalizedPath = path.resolve(workspacePath);
    assertSafeWorkspace(normalizedPath);

    const tree = getFileTree(normalizedPath);
    const project = {
      name: path.basename(normalizedPath),
      path: normalizedPath,
      tree
    };

    this.databaseService.saveRecentProject(project);
    return project;
  }

  createProject({ baseDir, name }) {
    const safeName = (name || 'mirai-project').trim().replace(/[<>:"/\\|?*]+/g, '-');
    const projectPath = path.join(path.resolve(baseDir), safeName);
    assertSafeWorkspace(projectPath);

    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });

    const defaultFiles = [
      {
        relativePath: 'README.md',
        content: `# ${safeName}\n\nCreated with Mirai Agent IDE.\n`
      },
      {
        relativePath: '.gitignore',
        content: 'node_modules/\ndist/\n.env\n'
      },
      {
        relativePath: 'src/main.js',
        content: "console.log('Hello from Mirai Agent IDE');\n"
      }
    ];

    for (const file of defaultFiles) {
      const targetPath = path.join(projectPath, file.relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, file.content, 'utf8');
      }
    }

    return this.openProject(projectPath);
  }

  getFileTree(workspacePath) {
    return getFileTree(workspacePath);
  }

  readFile(workspacePath, filePath) {
    return readWorkspaceFile(workspacePath, filePath);
  }

  writeFile(workspacePath, filePath, content) {
    return writeWorkspaceFile(workspacePath, filePath, content);
  }

  createFile(workspacePath, relativePath) {
    return createWorkspaceFile(workspacePath, relativePath);
  }

  createFolder(workspacePath, relativePath) {
    return createWorkspaceFolder(workspacePath, relativePath);
  }

  renamePath(workspacePath, oldPath, newPath) {
    return renameWorkspacePath(workspacePath, oldPath, newPath);
  }

  deletePath(workspacePath, targetPath) {
    return deleteWorkspacePath(workspacePath, targetPath);
  }

  searchWorkspace(workspacePath, query, includeFiles = '*', excludeFiles = '') {
    const rootPath = path.resolve(workspacePath);
    assertSafeWorkspace(rootPath);

    const searchText = String(query || '').trim().toLowerCase();
    if (!searchText) {
      return [];
    }

    const fileFilters = String(includeFiles || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const excludeFilters = String(excludeFiles || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    const results = [];

    function matchesFilter(filePath) {
      if (!fileFilters.length || fileFilters.includes('*')) {
        return true;
      }

      const lowerPath = filePath.toLowerCase();
      const ext = path.extname(lowerPath);
      return fileFilters.some((filter) => {
        const cleanFilter = filter.replace(/^\*\./, '.').replace(/^\*/, '');
        if (cleanFilter.startsWith('.')) {
          return ext === cleanFilter;
        }
        return lowerPath.endsWith(cleanFilter);
      });
    }

    function matchesExclude(filePath) {
      if (!excludeFilters.length) {
        return false;
      }

      const lowerPath = filePath.toLowerCase();
      return excludeFilters.some((filter) => {
        const cleanFilter = filter.replace(/^\*\./, '.').replace(/^\*/, '');
        if (!cleanFilter) {
          return false;
        }
        if (cleanFilter.startsWith('.')) {
          return lowerPath.split('/').includes(cleanFilter.slice(1)) || lowerPath.endsWith(cleanFilter);
        }
        return lowerPath.includes(cleanFilter);
      });
    }

    function walk(currentPath, relativePath = '') {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        if (matchesExclude(relativePath.replace(/\\/g, '/'))) {
          return;
        }

        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.git')) {
            continue;
          }
          walk(path.join(currentPath, entry.name), path.join(relativePath, entry.name));
        }
        return;
      }

      if (matchesExclude(relativePath.replace(/\\/g, '/'))) {
        return;
      }

      const ext = path.extname(currentPath).toLowerCase();
      if (!SEARCHABLE_EXTENSIONS.has(ext) && !matchesFilter(relativePath.replace(/\\/g, '/'))) {
        return;
      }

      if (!matchesFilter(relativePath.replace(/\\/g, '/'))) {
        return;
      }

      const content = fs.readFileSync(currentPath, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        const lowerLine = line.toLowerCase();
        if (!lowerLine.includes(searchText)) {
          return;
        }

        results.push({
          path: relativePath.replace(/\\/g, '/'),
          lineNumber: index + 1,
          preview: line.trim()
        });
      });
    }

    walk(rootPath);
    return results;
  }

  replaceWorkspace(workspacePath, query, replaceText, includeFiles = '*', excludeFiles = '') {
    const results = this.searchWorkspace(workspacePath, query, includeFiles, excludeFiles);
    if (!results.length) {
      return [];
    }

    const rootPath = path.resolve(workspacePath);
    assertSafeWorkspace(rootPath);

    const targetPaths = new Set(results.map((item) => item.path));
    const updated = [];

    for (const filePath of targetPaths) {
      const absolutePath = resolveInsideWorkspace(rootPath, filePath);
      const current = fs.readFileSync(absolutePath, 'utf8');
      const next = current.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceText ?? '');
      if (next !== current) {
        fs.writeFileSync(absolutePath, next, 'utf8');
        updated.push({ path: filePath });
      }
    }

    return updated;
  }

  isCollapsedDirectoryName(name) {
    return isCollapsedDirectoryName(name);
  }

  resolveInsideWorkspace(workspacePath, targetPath) {
    return resolveInsideWorkspace(workspacePath, targetPath);
  }
}
