import fs from 'node:fs';
import path from 'node:path';
import { resolveFilePath, formatError } from './utils.js';

export const name = 'list_files';

export const definition = {
  type: 'function',
  function: {
    name: 'list_files',
    description: 'List files and directories in a given path. Returns names and types.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default: workspace root)', default: '' }
      }
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const dirPath = resolveFilePath(args.path || '', workspacePath);
  if (!dirPath) return formatError('Invalid path');
  const fullPath = path.join(workspacePath, dirPath);
  if (!fs.existsSync(fullPath)) return formatError(`Directory not found: ${args.path}`);
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return { success: true, result: JSON.stringify(items, null, 2) };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
