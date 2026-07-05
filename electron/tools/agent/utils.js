import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const TOOL_TIMEOUT_MS = 30000;

/**
 * Normalize a user-provided path so it is relative to the workspace.
 * Absolute paths are allowed only if they resolve inside the workspace.
 */
export function resolveFilePath(inputPath, workspacePath) {
  if (!inputPath) return '';
  const p = String(inputPath).replace(/\\/g, '/');
  if (path.isAbsolute(p)) {
    try {
      const resolved = path.resolve(p);
      // workspacePath is required for absolute path validation
      if (!workspacePath) return '';
      const rootPath = path.resolve(workspacePath);
      const relative = path.relative(rootPath, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
      return path.relative(workspacePath, resolved).replace(/\\/g, '/');
    } catch {
      return '';
    }
  }
  return p.replace(/^\.\//, '');
}

export function formatError(message) {
  return { success: false, error: message };
}

export function matchGlob(filename, pattern) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i').test(filename);
}

export function isTextFile(filename) {
  const textExts = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.json', '.jsonc', '.md', '.mdx',
    '.html', '.htm', '.css', '.scss', '.less', '.yml', '.yaml', '.txt', '.xml',
    '.cjs', '.mjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.cfg', '.conf', '.env'];
  const ext = path.extname(filename).toLowerCase();
  return textExts.includes(ext) || !ext;
}

export async function grepRecursive(dirPath, pattern, glob) {
  const regex = new RegExp(pattern, 'i');
  const results = [];
  const maxResults = 100;
  let count = 0;

  function search(dir) {
    if (count >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= maxResults) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        search(fullPath);
      } else if (entry.isFile()) {
        if (glob && !matchGlob(entry.name, glob)) continue;
        if (!isTextFile(entry.name)) continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const relPath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
              count++;
              if (count >= maxResults) break;
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
  }

  search(dirPath);
  if (results.length === 0) return '';
  return results.join('\n') + (count >= maxResults ? '\n... (truncated at 100 results)' : '');
}

export function runShellCommand(command, cwd) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ code: 124, output: 'Command timed out after 30s' });
    }, TOOL_TIMEOUT_MS);

    exec(command, { cwd, maxBuffer: 1024 * 1024 * 5, timeout: TOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
      clearTimeout(timer);
      const output = [stdout, stderr].filter(Boolean).join('\n') || '(no output)';
      resolve({
        code: error ? (error.code || 1) : 0,
        output
      });
    });
  });
}
