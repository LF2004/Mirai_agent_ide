import fs from 'node:fs';
import path from 'node:path';

const BLOCKED_SEGMENTS = ['windows', 'program files', 'program files (x86)', 'system32'];
const DEFAULT_COLLAPSED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.vscode',
  'vendor',
  '__pycache__'
]);
const FILE_TREE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});
const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif'
};

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isImageExtension(extension) {
  return Boolean(IMAGE_MIME_TYPES[extension]);
}

export function isCollapsedDirectoryName(name) {
  return DEFAULT_COLLAPSED_DIRS.has(normalizePath(name).toLowerCase());
}

export function assertSafeWorkspace(workspacePath) {
  const lowerPath = workspacePath.toLowerCase();
  const hasBlockedSegment = BLOCKED_SEGMENTS.some((segment) => lowerPath.includes(segment));

  if (hasBlockedSegment) {
    throw new Error('This folder is blocked from being used as a workspace.');
  }
}

export function resolveInsideWorkspace(workspacePath, targetPath) {
  const rootPath = path.resolve(workspacePath);
  assertSafeWorkspace(rootPath);

  const absolutePath = path.resolve(rootPath, targetPath);
  const relative = path.relative(rootPath, absolutePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The requested path is outside the active workspace.');
  }

  return absolutePath;
}

export function getFileTree(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  assertSafeWorkspace(resolvedRoot);
  return walkDirectory(resolvedRoot, resolvedRoot);
}

export function readWorkspaceFile(workspacePath, filePath) {
  const absolutePath = resolveInsideWorkspace(workspacePath, filePath);
  const stat = fs.statSync(absolutePath);

  if (!stat.isFile()) {
    throw new Error('Only files can be opened in the editor.');
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();
  const imageMime = IMAGE_MIME_TYPES[extension];

  if (imageMime) {
    const base64 = fs.readFileSync(absolutePath).toString('base64');
    return {
      path: filePath,
      kind: 'image',
      mime: imageMime,
      size: stat.size,
      content: '',
      dataUrl: `data:${imageMime};base64,${base64}`
    };
  }

  return {
    path: filePath,
    kind: 'text',
    mime: 'text/plain',
    size: stat.size,
    content: fs.readFileSync(absolutePath, 'utf8')
  };
}

export function writeWorkspaceFile(workspacePath, filePath, content) {
  const absolutePath = resolveInsideWorkspace(workspacePath, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content ?? '', 'utf8');

  return {
    success: true,
    path: filePath,
    savedAt: new Date().toISOString()
  };
}

export function createWorkspaceFile(workspacePath, relativePath) {
  const absolutePath = resolveInsideWorkspace(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  if (!fs.existsSync(absolutePath)) {
    fs.writeFileSync(absolutePath, '', 'utf8');
  }

  return {
    success: true,
    path: relativePath
  };
}

export function createWorkspaceFolder(workspacePath, relativePath) {
  const absolutePath = resolveInsideWorkspace(workspacePath, relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });

  return {
    success: true,
    path: relativePath
  };
}

export function renameWorkspacePath(workspacePath, oldPath, newPath) {
  const oldAbsolutePath = resolveInsideWorkspace(workspacePath, oldPath);
  const newAbsolutePath = resolveInsideWorkspace(workspacePath, newPath);

  if (!fs.existsSync(oldAbsolutePath)) {
    throw new Error('The source path does not exist.');
  }

  if (fs.existsSync(newAbsolutePath)) {
    throw new Error('A file or folder already exists at the target path.');
  }

  fs.mkdirSync(path.dirname(newAbsolutePath), { recursive: true });
  fs.renameSync(oldAbsolutePath, newAbsolutePath);

  return {
    success: true,
    oldPath,
    newPath
  };
}

export function deleteWorkspacePath(workspacePath, targetPath) {
  if (!targetPath || targetPath === '.') {
    throw new Error('Deleting the workspace root is not allowed.');
  }

  const absolutePath = resolveInsideWorkspace(workspacePath, targetPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      success: true,
      path: targetPath
    };
  }

  fs.rmSync(absolutePath, { recursive: true, force: true });

  return {
    success: true,
    path: targetPath
  };
}

/**
 * Snapshot all files under a path before deletion, so we can restore them on undo.
 * Returns an array of { path, content, isDirectory, isBinary?, dataUrl? } entries
 * in depth-first order (parents before children), which is the order needed for recreation.
 * Binary files (images, etc.) are stored as base64 data URLs so they can be fully restored.
 */
export function snapshotWorkspacePath(workspacePath, targetPath) {
  if (!targetPath || targetPath === '.') {
    return [];
  }

  const absolutePath = resolveInsideWorkspace(workspacePath, targetPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const entries = [];
  const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));

  function walk(currentPath, relativePath) {
    const stats = fs.statSync(currentPath);
    if (stats.isDirectory()) {
      entries.push({ path: relativePath, content: '', isDirectory: true });
      const children = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const child of children) {
        if (child.name.startsWith('.git')) {
          continue;
        }
        walk(path.join(currentPath, child.name), `${relativePath}/${child.name}`);
      }
    } else {
      const ext = path.extname(currentPath).slice(1).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        // Store binary files as base64 data URL so they can be fully restored
        try {
          const buffer = fs.readFileSync(currentPath);
          const mime = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
          const base64 = buffer.toString('base64');
          entries.push({
            path: relativePath,
            content: '',
            isDirectory: false,
            isBinary: true,
            dataUrl: `data:${mime};base64,${base64}`
          });
        } catch {
          entries.push({ path: relativePath, content: '', isDirectory: false, isBinary: true, dataUrl: '' });
        }
      } else {
        let content = '';
        try {
          content = fs.readFileSync(currentPath, 'utf8');
        } catch {
          content = '';
        }
        entries.push({ path: relativePath, content, isDirectory: false });
      }
    }
  }

  walk(absolutePath, normalizePath(targetPath));
  return entries;
}

function walkDirectory(rootPath, currentPath) {
  const stats = fs.statSync(currentPath);
  const node = {
    name: path.basename(currentPath),
    path: (path.relative(rootPath, currentPath) || '.').replace(/\\/g, '/'),
    type: stats.isDirectory() ? 'directory' : 'file'
  };

  if (!stats.isDirectory()) {
    return node;
  }

  node.children = fs
    .readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.git'))
    .map((entry) => walkDirectory(rootPath, path.join(currentPath, entry.name)))
    .sort((left, right) => {
      if (left.type === 'directory' && right.type !== 'directory') {
        return -1;
      }

      if (left.type !== 'directory' && right.type === 'directory') {
        return 1;
      }

      return FILE_TREE_COLLATOR.compare(left.name, right.name);
    });

  return node;
}

export function isImageFilePath(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return isImageExtension(extension);
}
