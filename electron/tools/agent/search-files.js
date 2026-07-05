import path from 'node:path';
import { resolveFilePath, formatError, grepRecursive } from './utils.js';

export const name = 'search_files';

export const definition = {
  type: 'function',
  function: {
    name: 'search_files',
    description: 'Search for text patterns in files using regex. Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern to search for' },
        path: { type: 'string', description: 'Directory to search in (default: workspace root)', default: '' },
        glob: { type: 'string', description: 'File glob pattern to filter (e.g. "*.js")', default: '' }
      },
      required: ['pattern']
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const searchDir = resolveFilePath(args.path || '', workspacePath);
  if (!searchDir) return formatError('Invalid search path');
  try {
    const results = await grepRecursive(
      path.join(workspacePath, searchDir),
      args.pattern,
      args.glob || ''
    );
    return { success: true, result: results || 'No matches found' };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
