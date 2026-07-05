import setiTheme from '../assets/vscode-seti/vs-seti-icon-theme.json';

const { iconDefinitions, fileExtensions = {}, fileNames = {} } = setiTheme;
const EXTRA_FILE_NAME_MAP = {
  'package.json': '_npm',
  'package-lock.json': '_npm',
  'npm-shrinkwrap.json': '_npm',
  'pnpm-lock.yaml': '_yarn',
  'yarn.lock': '_yarn',
  'bun.lockb': '_yarn',
  'bun.lock': '_yarn',
  'dockerfile': '_docker',
  '.dockerignore': '_docker',
  '.gitignore': '_git',
  '.gitattributes': '_git',
  '.gitmodules': '_git',
  '.env': '_config',
  '.env.local': '_config',
  '.env.development': '_config',
  '.env.production': '_config',
  '.eslintignore': '_config',
  '.eslintrc': '_config',
  '.eslintrc.js': '_config',
  '.eslintrc.cjs': '_config',
  '.prettierrc': '_config',
  '.prettierrc.js': '_config',
  '.prettierrc.cjs': '_config',
  'tsconfig.json': '_tsconfig',
  'tsconfig.app.json': '_tsconfig',
  'tsconfig.node.json': '_tsconfig',
  'jsconfig.json': '_config',
  'vite.config.js': '_vite',
  'vite.config.ts': '_vite',
  'vite.config.mjs': '_vite',
  'vite.config.cjs': '_vite',
  'vite.config.mts': '_vite',
  'vite.config.cts': '_vite',
  'webpack.config.js': '_webpack',
  'webpack.config.cjs': '_webpack',
  'babel.config.js': '_babel',
  'babel.config.cjs': '_babel',
  'babel.config.json': '_babel',
  'readme.md': '_info',
  'readme': '_info',
  'license': '_license',
  'license.md': '_license',
  'changelog.md': '_changes',
  'docker-compose.yml': '_docker',
  'docker-compose.yaml': '_docker',
  '.vscode': '_vscode',
  '.github': '_github'
};

function normalizeName(name) {
  return String(name || '').toLowerCase();
}

function candidateExtensions(fileName) {
  const cleanName = normalizeName(fileName).replace(/^\.+/, '');
  const parts = cleanName.split('.');
  const candidates = [];

  for (let index = 0; index < parts.length - 1; index += 1) {
    candidates.push(parts.slice(index).join('.'));
  }

  candidates.push(parts.at(-1) || cleanName);
  return [...new Set(candidates.filter(Boolean))];
}

export function resolveSetiIcon(fileName) {
  const lowerName = normalizeName(fileName);
  const fileNameKey =
    fileNames[lowerName] ||
    fileNames[lowerName.replace(/^\./, '')] ||
    EXTRA_FILE_NAME_MAP[lowerName] ||
    EXTRA_FILE_NAME_MAP[lowerName.replace(/^\./, '')];

  let iconKey = fileNameKey;
  if (!iconKey) {
    for (const extension of candidateExtensions(lowerName)) {
      if (fileExtensions[extension]) {
        iconKey = fileExtensions[extension];
        break;
      }
    }
  }

  const definition = iconDefinitions[iconKey] || iconDefinitions._default;

  return {
    glyph: `"${definition.fontCharacter}"`,
    color: definition.fontColor || '#d4d7d6'
  };
}
