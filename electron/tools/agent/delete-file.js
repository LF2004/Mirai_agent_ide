import fs from 'node:fs';
import path from 'node:path';
import { resolveFilePath, formatError } from './utils.js';

export const name = 'delete_file';

export const definition = {
  type: 'function',
  function: {
    name: 'delete_file',
    description: 'Delete a file from the workspace. Use with caution.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to delete' }
      },
      required: ['path']
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const filePath = resolveFilePath(args.path, workspacePath);
  if (!filePath) return formatError('Invalid file path');
  const fullPath = path.join(workspacePath, filePath);
  if (!fs.existsSync(fullPath)) return formatError(`File not found: ${args.path}`);
  try {
    fs.unlinkSync(fullPath);
    return { success: true, result: `File deleted: ${args.path}` };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
