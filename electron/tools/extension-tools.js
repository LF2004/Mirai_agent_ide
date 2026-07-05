import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function directoryExists(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function getExtensionRoots() {
  const homeDir = os.homedir();
  return [
    path.join(homeDir, '.vscode', 'extensions'),
    path.join(homeDir, '.cursor', 'extensions'),
    path.join(homeDir, '.windsurf', 'extensions')
  ].filter(directoryExists);
}

function normalizeExtensionId(manifest, fallbackName) {
  const publisher = String(manifest?.publisher || '').trim();
  const name = String(manifest?.name || fallbackName || '').trim();

  if (publisher && name) {
    return `${publisher}.${name}`;
  }

  return name || fallbackName || 'unknown.extension';
}

export class ExtensionTools {
  constructor(databaseService) {
    this.databaseService = databaseService;
  }

  listInstalledExtensions() {
    const enabledMap = this.databaseService.getSetting('extensions.enabled', {});
    const extensions = [];

    for (const rootPath of getExtensionRoots()) {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const extensionPath = path.join(rootPath, entry.name);
        const manifestPath = path.join(extensionPath, 'package.json');
        if (!fs.existsSync(manifestPath)) {
          continue;
        }

        const manifest = safeReadJson(manifestPath);
        if (!manifest) {
          continue;
        }

        const extensionId = normalizeExtensionId(manifest, entry.name);
        const categories = Array.isArray(manifest.categories) ? manifest.categories : [];
        const contributes = manifest.contributes || {};
        const themeCount = Array.isArray(contributes.themes) ? contributes.themes.length : 0;
        const grammarCount = Array.isArray(contributes.grammars) ? contributes.grammars.length : 0;
        const languageCount = Array.isArray(contributes.languages) ? contributes.languages.length : 0;
        const commandCount = Array.isArray(contributes.commands) ? contributes.commands.length : 0;

        extensions.push({
          id: extensionId,
          name: manifest.displayName || manifest.name || entry.name,
          description: manifest.description || '',
          version: manifest.version || '0.0.0',
          publisher: manifest.publisher || '',
          categories,
          rootPath,
          path: extensionPath,
          enabled: enabledMap[extensionId] !== false,
          icon: manifest.icon ? path.join(extensionPath, manifest.icon) : '',
          engine: manifest.engines?.vscode || '',
          contributes: {
            themes: themeCount,
            grammars: grammarCount,
            languages: languageCount,
            commands: commandCount
          }
        });
      }
    }

    return extensions.sort((left, right) => left.name.localeCompare(right.name));
  }

  setExtensionEnabled(extensionId, enabled) {
    const current = this.databaseService.getSetting('extensions.enabled', {});
    const next = {
      ...current,
      [extensionId]: Boolean(enabled)
    };

    this.databaseService.saveSetting('extensions.enabled', next);

    return {
      success: true,
      id: extensionId,
      enabled: next[extensionId]
    };
  }
}
