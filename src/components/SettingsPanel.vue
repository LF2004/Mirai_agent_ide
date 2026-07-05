<script setup>
import { IDE_THEMES } from '../../type/themes.js';
import { t, useLocaleOptions } from '../utils/i18n.js';

defineProps({
  currentLocale: {
    type: String,
    default: 'zh'
  },
  activeTheme: {
    type: String,
    default: ''
  },
  editorFontSize: {
    type: Number,
    default: 13
  },
  editorFontFamily: {
    type: String,
    default: ''
  },
  terminalFontSize: {
    type: Number,
    default: 13
  },
  explorerCompactFolders: {
    type: Boolean,
    default: true
  },
  terminalShellIntegration: {
    type: Boolean,
    default: true
  },
  autoSave: {
    type: String,
    default: 'off'
  },
  keybinds: {
    type: Object,
    required: true
  },
  wordWrap: {
    type: Boolean,
    default: false
  },
  tabSize: {
    type: Number,
    default: 2
  },
  lineNumbers: {
    type: Boolean,
    default: true
  },
  minimap: {
    type: Boolean,
    default: false
  },
  renderWhitespace: {
    type: String,
    default: 'none'
  },
  bracketPairColorization: {
    type: Boolean,
    default: true
  },
  cursorBlinking: {
    type: String,
    default: 'blink'
  },
  smoothScrolling: {
    type: Boolean,
    default: false
  }
});

defineEmits([
  'set-theme',
  'set-locale',
  'set-editor-font-family',
  'set-editor-font-size',
  'set-auto-save',
  'set-compact-folders',
  'set-shell-integration',
  'set-terminal-font-size',
  'set-keybind',
  'set-word-wrap',
  'set-tab-size',
  'set-line-numbers',
  'set-minimap',
  'set-render-whitespace',
  'set-bracket-pair-colorization',
  'set-cursor-blinking',
  'set-smooth-scrolling'
]);

const localeOptions = useLocaleOptions();
const keybindRows = [
  ['openProject', 'openProject'],
  ['newFile', 'newFile'],
  ['saveFile', 'saveFile'],
  ['search', 'search'],
  ['replace', 'replace'],
  ['terminal', 'terminal'],
  ['undo', 'undo'],
  ['redo', 'redo']
];

const whitespaceOptions = [
  { value: 'none', labelKey: 'renderWhitespaceNone' },
  { value: 'boundary', labelKey: 'renderWhitespaceBoundary' },
  { value: 'all', labelKey: 'renderWhitespaceAll' }
];

const cursorBlinkingOptions = [
  { value: 'blink', labelKey: 'blink' },
  { value: 'smooth', labelKey: 'smooth' },
  { value: 'phase', labelKey: 'phase' },
  { value: 'expand', labelKey: 'expand' },
  { value: 'solid', labelKey: 'solid' }
];
</script>

<template>
  <div class="settings-pane">
    <div class="pane__header">
      <span>{{ t('settingsTitle') }}</span>
    </div>

    <section class="settings-section">
      <p class="pane__label">{{ t('appearance') }}</p>
      <h3>{{ t('theme') }}</h3>
      <p class="pane__hint">{{ t('uiAndEditorTheme') }}</p>
      <div class="theme-list">
        <button
          v-for="theme in IDE_THEMES"
          :key="theme.id"
          class="theme-option"
          :class="{ 'is-active': theme.id === activeTheme }"
          @click="$emit('set-theme', theme.id)"
        >
          <span class="theme-option__swatch" :data-theme-preview="theme.id"></span>
          <span>{{ theme.name }}</span>
          <span v-if="theme.id === activeTheme" class="codicon codicon-check"></span>
        </button>
      </div>
      <div class="settings-field">
        <label>{{ t('uiLanguage') }}</label>
        <select :value="currentLocale" class="settings-input" @change="$emit('set-locale', $event.target.value)">
          <option v-for="option in localeOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
        </select>
      </div>
    </section>

    <section class="settings-section">
      <p class="pane__label">{{ t('editor') }}</p>
      <h3>{{ t('typography') }}</h3>
      <div class="settings-field">
        <label>{{ t('fontFamily') }}</label>
        <input :value="editorFontFamily" class="settings-input" @change="$emit('set-editor-font-family', $event.target.value)" />
      </div>
      <div class="settings-field">
        <label>{{ t('fontSize') }}</label>
        <input type="range" min="11" max="20" :value="editorFontSize" @input="$emit('set-editor-font-size', $event.target.value)" />
        <span>{{ editorFontSize }} px</span>
      </div>
    </section>

    <section class="settings-section">
      <p class="pane__label">{{ t('editor') }}</p>
      <h3>{{ t('editor') }}</h3>

      <div class="settings-field settings-field--inline">
        <label>{{ t('wordWrap') }}</label>
        <input type="checkbox" :checked="wordWrap" @change="$emit('set-word-wrap', $event.target.checked)" />
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('tabSize') }}</label>
        <select :value="tabSize" class="settings-select" @change="$emit('set-tab-size', $event.target.value)">
          <option :value="2">2</option>
          <option :value="4">4</option>
          <option :value="8">8</option>
        </select>
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('lineNumbers') }}</label>
        <input type="checkbox" :checked="lineNumbers" @change="$emit('set-line-numbers', $event.target.checked)" />
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('minimap') }}</label>
        <input type="checkbox" :checked="minimap" @change="$emit('set-minimap', $event.target.checked)" />
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('renderWhitespace') }}</label>
        <select :value="renderWhitespace" class="settings-select" @change="$emit('set-render-whitespace', $event.target.value)">
          <option v-for="opt in whitespaceOptions" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
        </select>
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('bracketPairColorization') }}</label>
        <input type="checkbox" :checked="bracketPairColorization" @change="$emit('set-bracket-pair-colorization', $event.target.checked)" />
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('cursorBlinking') }}</label>
        <select :value="cursorBlinking" class="settings-select" @change="$emit('set-cursor-blinking', $event.target.value)">
          <option v-for="opt in cursorBlinkingOptions" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
        </select>
      </div>

      <div class="settings-field settings-field--inline">
        <label>{{ t('smoothScrolling') }}</label>
        <input type="checkbox" :checked="smoothScrolling" @change="$emit('set-smooth-scrolling', $event.target.checked)" />
      </div>

      <div class="settings-field">
        <label>{{ t('autoSave') }}</label>
        <select :value="autoSave" class="settings-input" @change="$emit('set-auto-save', $event.target.value)">
          <option value="off">{{ t('off') }}</option>
          <option value="afterDelay">{{ t('afterDelay') }}</option>
          <option value="onFocusChange">{{ t('onFocusChange') }}</option>
        </select>
      </div>
    </section>

    <section class="settings-section">
      <p class="pane__label">{{ t('workspaceSection') }}</p>
      <h3>{{ t('workspace') }}</h3>
      <div class="settings-field settings-field--stack">
        <label>
          <input type="checkbox" :checked="explorerCompactFolders" @change="$emit('set-compact-folders', $event.target.checked)" />
          {{ t('compactFolders') }}
        </label>
        <label>
          <input type="checkbox" :checked="terminalShellIntegration" @change="$emit('set-shell-integration', $event.target.checked)" />
          {{ t('terminalShellIntegration') }}
        </label>
      </div>
      <div class="settings-field">
        <label>{{ t('terminalFontSize') }}</label>
        <input type="range" min="11" max="18" :value="terminalFontSize" @input="$emit('set-terminal-font-size', $event.target.value)" />
        <span>{{ terminalFontSize }} px</span>
      </div>
    </section>

    <section class="settings-section">
      <p class="pane__label">{{ t('keyboardShortcuts') }}</p>
      <h3>{{ t('keyboardShortcuts') }}</h3>
      <div v-for="[actionKey, labelKey] in keybindRows" :key="actionKey" class="settings-field">
        <label>{{ t(labelKey) }}</label>
        <input class="settings-input" :value="keybinds[actionKey]" @change="$emit('set-keybind', actionKey, $event.target.value)" />
      </div>
    </section>
  </div>
</template>
