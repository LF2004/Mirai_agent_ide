import * as readFile from './read-file.js';
import * as writeFile from './write-file.js';
import * as listFiles from './list-files.js';
import * as searchFiles from './search-files.js';
import * as runCommand from './run-command.js';
import * as createFile from './create-file.js';
import * as deleteFile from './delete-file.js';
import * as getWorkspaceInfo from './get-workspace-info.js';

const tools = [
  readFile,
  writeFile,
  listFiles,
  searchFiles,
  runCommand,
  createFile,
  deleteFile,
  getWorkspaceInfo
];

export function getToolDefinitions() {
  return tools.map(t => t.definition);
}

export async function executeTool(toolName, args, context) {
  const tool = tools.find(t => t.name === toolName || t.definition?.function?.name === toolName);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
  return tool.execute(args, context);
}

export { readFile, writeFile, listFiles, searchFiles, runCommand, createFile, deleteFile, getWorkspaceInfo };
