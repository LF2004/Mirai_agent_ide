import fs from 'node:fs';
import path from 'node:path';
import { formatError } from './utils.js';

export const name = 'get_workspace_info';

export const definition = {
  type: 'function',
  function: {
    name: 'get_workspace_info',
    description: 'Get information about the current workspace: root path, name, and top-level file tree.',
    parameters: { type: 'object', properties: {} }
  }
};

export async function execute(_args, context) {
  const workspacePath = context?.workspacePath || '';
  if (!workspacePath) return formatError('No workspace open');
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    const topFiles = entries
      .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
      .join('\n');
    return {
      success: true,
      result: `Workspace: ${path.basename(workspacePath)}\nPath: ${workspacePath}\n\nTop-level:\n${topFiles || '(empty)'}`
    };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
