import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspacePath,
  getFileTree,
  readWorkspaceFile,
  renameWorkspacePath,
  assertSafeWorkspace
} from '../tools/file-tools.js';

export class WorkspaceService {
  constructor(databaseService) {
    this.databaseService = databaseService;
  }

  openProject(workspacePath) {
    const normalizedPath = workspacePath;
    assertSafeWorkspace(normalizedPath);

    const tree = getFileTree(normalizedPath);
    const project = {
      name: normalizedPath.split(/[\\/]/).pop(),
      path: normalizedPath,
      tree
    };

    this.databaseService.saveRecentProject(project);
    return project;
  }

  createProject({ baseDir, name }) {
    throw new Error('WorkspaceService.createProject moved to WorkspaceTools.');
  }

  getFileTree(workspacePath) {
    return getFileTree(workspacePath);
  }

  readFile(workspacePath, filePath) {
    return readWorkspaceFile(workspacePath, filePath);
  }

  writeFile(workspacePath, filePath, content) {
    return createWorkspaceFile(workspacePath, filePath, content);
  }

  createFile(workspacePath, relativePath) {
    return createWorkspaceFile(workspacePath, relativePath);
  }

  createFolder(workspacePath, relativePath) {
    return createWorkspaceFolder(workspacePath, relativePath);
  }

  renamePath(workspacePath, oldPath, newPath) {
    return renameWorkspacePath(workspacePath, oldPath, newPath);
  }

  deletePath(workspacePath, targetPath) {
    return deleteWorkspacePath(workspacePath, targetPath);
  }
}
