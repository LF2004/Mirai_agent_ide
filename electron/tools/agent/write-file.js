import { writeWorkspaceFile } from '../file-tools.js';
import { resolveFilePath, formatError } from './utils.js';

export const name = 'write_file';

export const definition = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates the file if it does not exist, overwrites if it does.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file' },
        content: { type: 'string', description: 'The full content to write to the file' }
      },
      required: ['path', 'content']
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const filePath = resolveFilePath(args.path, workspacePath);
  if (!filePath) return formatError('Invalid or unsafe file path');
  try {
    writeWorkspaceFile(workspacePath, filePath, args.content || '');
    return { success: true, result: `File written: ${args.path}` };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
