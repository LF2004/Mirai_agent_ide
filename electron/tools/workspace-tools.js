import fs from 'node:fs';
import path from 'node:path';
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspacePath,
  getFileTree,
  isCollapsedDirectoryName,
  readWorkspaceFile,
  renameWorkspacePath,
  resolveInsideWorkspace,
  writeWorkspaceFile,
  assertSafeWorkspace
} from './file-tools.js';

export class WorkspaceTools {
  constructor(databaseService) {
    this.databaseService = databaseService;
  }

  openProject(workspacePath) {
    const normalizedPath = path.resolve(workspacePath);
    assertSafeWorkspace(normalizedPath);

    const tree = getFileTree(normalizedPath);
    const project = {
      name: path.basename(normalizedPath),
      path: normalizedPath,
      tree
    };

    this.databaseService.saveRecentProject(project);
    return project;
  }

  createProject({ baseDir, name }) {
    const safeName = (name || 'mirai-project').trim().replace(/[<>:"/\\|?*]+/g, '-');
    const projectPath = path.join(path.resolve(baseDir), safeName);
    assertSafeWorkspace(projectPath);

    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });

    const defaultFiles = [
      {
        relativePath: 'README.md',
        content: `# ${safeName}\n\nCreated with Mirai Agent IDE.\n`
      },
      {
        relativePath: '.gitignore',
        content: 'node_modules/\ndist/\n.env\n'
      },
      {
        relativePath: 'src/main.js',
        content: "console.log('Hello from Mirai Agent IDE');\n"
      }
    ];

    for (const file of defaultFiles) {
      const targetPath = path.join(projectPath, file.relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, file.content, 'utf8');
      }
    }

    return this.openProject(projectPath);
  }

  getFileTree(workspacePath) {
    return getFileTree(workspacePath);
  }

  readFile(workspacePath, filePath) {
    return readWorkspaceFile(workspacePath, filePath);
  }

  writeFile(workspacePath, filePath, content) {
    return writeWorkspaceFile(workspacePath, filePath, content);
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

  isCollapsedDirectoryName(name) {
    return isCollapsedDirectoryName(name);
  }

  resolveInsideWorkspace(workspacePath, targetPath) {
    return resolveInsideWorkspace(workspacePath, targetPath);
  }
}
