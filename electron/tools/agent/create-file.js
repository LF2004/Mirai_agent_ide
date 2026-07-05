import fs from 'node:fs';
import path from 'node:path';
import { resolveFilePath, formatError } from './utils.js';

export const name = 'create_file';

export const definition = {
  type: 'function',
  function: {
    name: 'create_file',
    description: 'Create a new file with the given content. Fails if the file already exists.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for the new file' },
        content: { type: 'string', description: 'Content for the new file' }
      },
      required: ['path', 'content']
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const filePath = resolveFilePath(args.path, workspacePath);
  if (!filePath) return formatError('Invalid file path');
  const fullPath = path.join(workspacePath, filePath);
  if (fs.existsSync(fullPath)) return formatError(`File already exists: ${args.path}`);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, args.content || '', 'utf-8');
    return { success: true, result: `File created: ${args.path}` };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
