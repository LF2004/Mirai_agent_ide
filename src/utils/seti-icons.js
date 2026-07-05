import setiTheme from '../assets/vscode-seti/vs-seti-icon-theme.json';

const { iconDefinitions, fileExtensions = {}, fileNames = {} } = setiTheme;
const EXTRA_FILE_EXTENSION_MAP = {
  html: '_html_3',
  htm: '_html_3',
  xhtml: '_html_3',
  css: '_css',
  scss: '_css',
  sass: '_css',
  less: '_css',
  js: '_javascript',
  jsx: '_javascript',
  mjs: '_javascript',
  cjs: '_javascript',
  ts: '_typescript',
  tsx: '_typescript',
  vue: '_vue',
  json: '_json',
  jsonc: '_json',
  md: '_markdown',
  mdx: '_markdown',
  py: '_python',
  sql: '_sql',
  svg: '_svg',
  xml: '_xml',
  yml: '_yaml',
  yaml: '_yaml',
  png: '_image',
  jpg: '_image',
  jpeg: '_image',
  gif: '_image',
  webp: '_image',
  bmp: '_image',
  ico: '_image',
  avif: '_image'
};
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
  'index.html': '_html_3',
  'index.htm': '_html_3',
  'index.css': '_css',
  'index.scss': '_css',
  'index.less': '_css',
  'index.js': '_javascript',
  'index.mjs': '_javascript',
  'index.cjs': '_javascript',
  'index.ts': '_typescript',
  'index.tsx': '_typescript',
  'index.jsx': '_javascript_1',
  'app.vue': '_vue',
  'main.js': '_javascript',
  'main.ts': '_typescript',
  'main.css': '_css',
  'main.scss': '_css',
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
  const normalizedLowerName = lowerName.replace(/^\./, '');
  const fileNameKey =
    fileNames[lowerName] ||
    fileNames[normalizedLowerName] ||
    EXTRA_FILE_NAME_MAP[lowerName] ||
    EXTRA_FILE_NAME_MAP[normalizedLowerName];

  let iconKey = fileNameKey;
  if (!iconKey) {
    for (const extension of candidateExtensions(lowerName)) {
      const compactExtension = extension.replace(/\./g, '');
      if (fileExtensions[extension]) {
        iconKey = fileExtensions[extension];
        break;
      }

      if (EXTRA_FILE_EXTENSION_MAP[extension]) {
        iconKey = EXTRA_FILE_EXTENSION_MAP[extension];
        break;
      }

      if (EXTRA_FILE_EXTENSION_MAP[compactExtension]) {
        iconKey = EXTRA_FILE_EXTENSION_MAP[compactExtension];
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
