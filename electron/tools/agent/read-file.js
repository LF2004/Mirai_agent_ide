import { readWorkspaceFile } from '../file-tools.js';
import { resolveFilePath, formatError } from './utils.js';

export const name = 'read_file';

export const definition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the content of a file in the workspace. Returns the file content as text.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the file' }
      },
      required: ['path']
    }
  }
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  const filePath = resolveFilePath(args.path, workspacePath);
  if (!filePath) return formatError('Invalid or unsafe file path');
  try {
    const fileInfo = readWorkspaceFile(workspacePath, filePath);
    if (fileInfo === null) return formatError(`File not found: ${args.path}`);
    return { success: true, result: fileInfo.content ?? fileInfo };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
