export const THEME_IDS = {
  CURSOR_DARK: 'cursor-dark',
  VSCODE_DARK_PLUS: 'vscode-dark-plus',
  MIDNIGHT_GRAPHITE: 'midnight-graphite'
};

export const IDE_THEMES = [
  {
    id: THEME_IDS.CURSOR_DARK,
    name: 'Cursor Dark'
  },
  {
    id: THEME_IDS.VSCODE_DARK_PLUS,
    name: 'VS Code Dark+'
  },
  {
    id: THEME_IDS.MIDNIGHT_GRAPHITE,
    name: 'Midnight Graphite'
  }
];

export const DEFAULT_THEME = THEME_IDS.CURSOR_DARK;

export const IDE_SETTINGS_DEFAULTS = {
  theme: DEFAULT_THEME,
  editorFontSize: 13,
  editorFontFamily: 'Cascadia Code',
  terminalFontSize: 13,
  explorerCompactFolders: true,
  terminalShellIntegration: true,
  autoSave: 'off',
  locale: 'zh',
  wordWrap: false,
  tabSize: 2,
  lineNumbers: true,
  minimap: false,
  renderWhitespace: 'none',
  bracketPairColorization: true,
  cursorBlinking: 'blink',
  smoothScrolling: false
};
