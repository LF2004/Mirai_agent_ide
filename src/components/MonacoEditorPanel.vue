<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  Decoration
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, completionKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { vue } from '@codemirror/lang-vue';
import { t } from '../utils/i18n.js';

const props = defineProps({
  filePath: {
    type: String,
    default: ''
  },
  file: {
    type: Object,
    default: null
  },
  content: {
    type: String,
    default: ''
  },
  fontSize: {
    type: Number,
    default: 13
  },
  fontFamily: {
    type: String,
    default: 'Cascadia Code'
  },
  focusLine: {
    type: Number,
    default: 0
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
  },
  minimap: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['change', 'save', 'cursor-change']);
const containerRef = ref(null);
const minimapRef = ref(null);
const editorView = ref(null);
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
const featuresCompartment = new Compartment();
const themeCompartment = new Compartment();
const emptyState = computed(() => !props.filePath);
const isImageFile = computed(() => props.file?.kind === 'image');
const breadcrumbSegments = computed(() => {
  if (!props.filePath) return [];
  return props.filePath.replace(/\\/g, '/').split('/').filter(Boolean);
});
let applyingExternalChange = false;
let minimapRaf = null;

function extensionFromPath(filePath) {
  return (filePath.split(/[\\/]/).pop() || '').split('.').pop()?.toLowerCase() || '';
}

// Language-aware completion sources
const JS_KEYWORDS = [
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'package', 'private', 'protected', 'public', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'
];

const JS_BUILTINS = [
  { label: 'console', detail: 'Console API', type: 'namespace' },
  { label: 'console.log', detail: 'Log to console', type: 'method' },
  { label: 'console.error', detail: 'Log error', type: 'method' },
  { label: 'console.warn', detail: 'Log warning', type: 'method' },
  { label: 'console.info', detail: 'Log info', type: 'method' },
  { label: 'console.debug', detail: 'Log debug', type: 'method' },
  { label: 'console.table', detail: 'Log table', type: 'method' },
  { label: 'console.group', detail: 'Group logs', type: 'method' },
  { label: 'console.groupEnd', detail: 'End group', type: 'method' },
  { label: 'console.time', detail: 'Start timer', type: 'method' },
  { label: 'console.timeEnd', detail: 'End timer', type: 'method' },
  { label: 'Math', detail: 'Math object', type: 'namespace' },
  { label: 'Math.floor', detail: 'Round down', type: 'method' },
  { label: 'Math.ceil', detail: 'Round up', type: 'method' },
  { label: 'Math.round', detail: 'Round nearest', type: 'method' },
  { label: 'Math.random', detail: 'Random number', type: 'method' },
  { label: 'Math.max', detail: 'Maximum value', type: 'method' },
  { label: 'Math.min', detail: 'Minimum value', type: 'method' },
  { label: 'Math.abs', detail: 'Absolute value', type: 'method' },
  { label: 'Math.pow', detail: 'Power', type: 'method' },
  { label: 'Math.sqrt', detail: 'Square root', type: 'method' },
  { label: 'JSON', detail: 'JSON object', type: 'namespace' },
  { label: 'JSON.parse', detail: 'Parse JSON string', type: 'method' },
  { label: 'JSON.stringify', detail: 'Stringify to JSON', type: 'method' },
  { label: 'Object', detail: 'Object constructor', type: 'class' },
  { label: 'Object.keys', detail: 'Get keys', type: 'method' },
  { label: 'Object.values', detail: 'Get values', type: 'method' },
  { label: 'Object.entries', detail: 'Get entries', type: 'method' },
  { label: 'Object.assign', detail: 'Assign properties', type: 'method' },
  { label: 'Object.freeze', detail: 'Freeze object', type: 'method' },
  { label: 'Array', detail: 'Array constructor', type: 'class' },
  { label: 'Array.from', detail: 'Create from iterable', type: 'method' },
  { label: 'Array.isArray', detail: 'Check if array', type: 'method' },
  { label: 'Array.of', detail: 'Create array', type: 'method' },
  { label: 'Promise', detail: 'Promise object', type: 'class' },
  { label: 'Promise.all', detail: 'Wait for all', type: 'method' },
  { label: 'Promise.race', detail: 'First to settle', type: 'method' },
  { label: 'Promise.resolve', detail: 'Resolved promise', type: 'method' },
  { label: 'Promise.reject', detail: 'Rejected promise', type: 'method' },
  { label: 'String', detail: 'String constructor', type: 'class' },
  { label: 'Number', detail: 'Number constructor', type: 'class' },
  { label: 'Boolean', detail: 'Boolean constructor', type: 'class' },
  { label: 'Symbol', detail: 'Symbol constructor', type: 'class' },
  { label: 'Map', detail: 'Map collection', type: 'class' },
  { label: 'Set', detail: 'Set collection', type: 'class' },
  { label: 'WeakMap', detail: 'WeakMap collection', type: 'class' },
  { label: 'WeakSet', detail: 'WeakSet collection', type: 'class' },
  { label: 'Date', detail: 'Date constructor', type: 'class' },
  { label: 'RegExp', detail: 'RegExp constructor', type: 'class' },
  { label: 'Error', detail: 'Error constructor', type: 'class' },
  { label: 'TypeError', detail: 'TypeError', type: 'class' },
  { label: 'RangeError', detail: 'RangeError', type: 'class' },
  { label: 'setTimeout', detail: 'Set timeout', type: 'function' },
  { label: 'setInterval', detail: 'Set interval', type: 'function' },
  { label: 'clearTimeout', detail: 'Clear timeout', type: 'function' },
  { label: 'clearInterval', detail: 'Clear interval', type: 'function' },
  { label: 'fetch', detail: 'Fetch API', type: 'function' },
  { label: 'require', detail: 'CommonJS require', type: 'function' },
  { label: 'module', detail: 'Module object', type: 'namespace' },
  { label: 'exports', detail: 'Module exports', type: 'namespace' },
  { label: 'process', detail: 'Node.js process', type: 'namespace' },
  { label: 'Buffer', detail: 'Node.js Buffer', type: 'class' },
  { label: 'global', detail: 'Global object', type: 'namespace' },
  { label: 'globalThis', detail: 'Global this', type: 'namespace' },
  { label: 'window', detail: 'Browser window', type: 'namespace' },
  { label: 'document', detail: 'DOM document', type: 'namespace' },
  { label: 'localStorage', detail: 'Local storage', type: 'namespace' },
  { label: 'sessionStorage', detail: 'Session storage', type: 'namespace' },
  { label: 'addEventListener', detail: 'Add event listener', type: 'method' },
  { label: 'removeEventListener', detail: 'Remove event listener', type: 'method' },
  { label: 'querySelector', detail: 'Query selector', type: 'method' },
  { label: 'querySelectorAll', detail: 'Query all selectors', type: 'method' },
  { label: 'getElementById', detail: 'Get by ID', type: 'method' },
  { label: 'createElement', detail: 'Create element', type: 'method' }
];

const VUE_SNIPPETS = [
  { label: 'v-if', detail: 'Conditional rendering', type: 'keyword' },
  { label: 'v-else', detail: 'Else condition', type: 'keyword' },
  { label: 'v-for', detail: 'List rendering', type: 'keyword' },
  { label: 'v-model', detail: 'Two-way binding', type: 'keyword' },
  { label: 'v-bind', detail: 'One-way binding', type: 'keyword' },
  { label: 'v-on', detail: 'Event binding', type: 'keyword' },
  { label: 'v-show', detail: 'Toggle visibility', type: 'keyword' },
  { label: 'v-html', detail: 'Render HTML', type: 'keyword' },
  { label: 'defineProps', detail: 'Vue 3 defineProps', type: 'function' },
  { label: 'defineEmits', detail: 'Vue 3 defineEmits', type: 'function' },
  { label: 'defineExpose', detail: 'Vue 3 defineExpose', type: 'function' },
  { label: 'ref', detail: 'Vue 3 ref', type: 'function' },
  { label: 'reactive', detail: 'Vue 3 reactive', type: 'function' },
  { label: 'computed', detail: 'Vue 3 computed', type: 'function' },
  { label: 'watch', detail: 'Vue 3 watch', type: 'function' },
  { label: 'watchEffect', detail: 'Vue 3 watchEffect', type: 'function' },
  { label: 'onMounted', detail: 'Vue 3 onMounted', type: 'function' },
  { label: 'onBeforeUnmount', detail: 'Vue 3 onBeforeUnmount', type: 'function' },
  { label: 'onUpdated', detail: 'Vue 3 onUpdated', type: 'function' },
  { label: 'provide', detail: 'Vue 3 provide', type: 'function' },
  { label: 'inject', detail: 'Vue 3 inject', type: 'function' },
  { label: 'useRouter', detail: 'Vue Router useRouter', type: 'function' },
  { label: 'useRoute', detail: 'Vue Router useRoute', type: 'function' },
  { label: 'useStore', detail: 'Pinia useStore', type: 'function' },
  { label: 'nextTick', detail: 'Vue 3 nextTick', type: 'function' }
];

const PYTHON_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  'reversed', 'sum', 'min', 'max', 'abs', 'round', 'type', 'isinstance',
  'hasattr', 'getattr', 'setattr', 'delattr', 'open', 'input', 'str', 'int',
  'float', 'bool', 'list', 'dict', 'set', 'tuple', 'frozenset'
];

const CSS_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'margin', 'padding', 'border', 'border-radius', 'background', 'color',
  'font-size', 'font-family', 'font-weight', 'line-height', 'text-align',
  'flex', 'flex-direction', 'justify-content', 'align-items', 'grid',
  'grid-template-columns', 'grid-template-rows', 'gap', 'z-index', 'opacity',
  'transition', 'transform', 'animation', 'box-shadow', 'overflow', 'cursor'
];

function buildCompletionOptions(filePath) {
  const ext = extensionFromPath(filePath);
  const options = [];

  // Always include common snippets
  options.push(
    snippetCompletion('console.log(${value});', { label: 'console.log', detail: 'Log value', type: 'snippet' }),
    snippetCompletion('console.error(${value});', { label: 'console.error', detail: 'Log error', type: 'snippet' }),
    snippetCompletion('console.warn(${value});', { label: 'console.warn', detail: 'Log warning', type: 'snippet' }),
    snippetCompletion('async function ${name}(${args}) {\n\t${}\n}', { label: 'async function', detail: 'Async function', type: 'snippet' }),
    snippetCompletion('function ${name}(${args}) {\n\t${}\n}', { label: 'function', detail: 'Function declaration', type: 'snippet' }),
    snippetCompletion('const ${name} = (${args}) => {\n\t${}\n};', { label: 'const arrow', detail: 'Arrow function (const)', type: 'snippet' }),
    snippetCompletion('export default {\n\tname: "${name}",\n\tsetup() {\n\t\t${}\n\t}\n};', { label: 'Vue export default', detail: 'Vue component option', type: 'snippet' }),
    snippetCompletion('import { ${name} } from "${module}";', { label: 'import named', detail: 'Named import', type: 'snippet' }),
    snippetCompletion('import ${name} from "${module}";', { label: 'import default', detail: 'Default import', type: 'snippet' }),
    snippetCompletion('export const ${name} = ${value};', { label: 'export const', detail: 'Export constant', type: 'snippet' }),
    snippetCompletion('if (${condition}) {\n\t${}\n}', { label: 'if', detail: 'If statement', type: 'snippet' }),
    snippetCompletion('for (const ${item} of ${array}) {\n\t${}\n}', { label: 'for of', detail: 'For...of loop', type: 'snippet' }),
    snippetCompletion('for (let ${i} = 0; ${i} < ${array}.length; ${i}++) {\n\t${}\n}', { label: 'for loop', detail: 'For loop', type: 'snippet' }),
    snippetCompletion('try {\n\t${}\n} catch (${error}) {\n\t\n}', { label: 'try catch', detail: 'Try/catch block', type: 'snippet' }),
    snippetCompletion('class ${Name} {\n\tconstructor(${args}) {\n\t\t${}\n\t}\n}', { label: 'class', detail: 'Class declaration', type: 'snippet' }),
    snippetCompletion('Promise.resolve(${value})', { label: 'Promise.resolve', detail: 'Resolved promise', type: 'snippet' }),
    snippetCompletion('new Promise((resolve, reject) => {\n\t${}\n})', { label: 'new Promise', detail: 'New Promise', type: 'snippet' }),
    snippetCompletion('setTimeout(() => {\n\t${}\n}, ${delay});', { label: 'setTimeout', detail: 'Set timeout', type: 'snippet' }),
    snippetCompletion('setInterval(() => {\n\t${}\n}, ${interval});', { label: 'setInterval', detail: 'Set interval', type: 'snippet' }),
    snippetCompletion('fetch(${url})\n\t.then(response => response.json())\n\t.then(data => {\n\t\t${}\n\t})\n\t.catch(error => {\n\t\t\n\t});', { label: 'fetch', detail: 'Fetch API call', type: 'snippet' })
  );

  // JS/TS keywords and builtins
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) {
    for (const kw of JS_KEYWORDS) {
      options.push({ label: kw, detail: 'keyword', type: 'keyword' });
    }
    for (const builtin of JS_BUILTINS) {
      options.push(builtin);
    }
  }

  // Vue specific
  if (ext === 'vue') {
    for (const kw of JS_KEYWORDS) {
      options.push({ label: kw, detail: 'keyword', type: 'keyword' });
    }
    for (const builtin of JS_BUILTINS) {
      options.push(builtin);
    }
    for (const v of VUE_SNIPPETS) {
      options.push(v);
    }
    // Vue template directives - split strings to avoid Vue SFC compiler confusion
    const tClose = '</' + 'template>';
    const sClose = '</' + 'script>';
    const stClose = '</' + 'style>';
    options.push(
      snippetCompletion('<template>\n\t${}\n' + tClose + '\n\n<script setup>\n${}\n' + sClose + '\n\n<style scoped>\n${}\n' + stClose, { label: 'vue template', detail: 'Vue SFC template', type: 'snippet' }),
      snippetCompletion('v-' + 'if="${condition}"', { label: 'v-if', detail: 'Conditional rendering', type: 'snippet' }),
      snippetCompletion('v-' + 'for="${item} in ${list}" :key="${item}.id"', { label: 'v-for', detail: 'List rendering', type: 'snippet' }),
      snippetCompletion('v-' + 'model="${value}"', { label: 'v-model', detail: 'Two-way binding', type: 'snippet' }),
      snippetCompletion('@' + 'click="${handler}"', { label: '@click', detail: 'Click event', type: 'snippet' }),
      snippetCompletion(":class=\"{ '${active}': ${condition} }\"", { label: ':class', detail: 'Class binding', type: 'snippet' })
    );
  }

  // Python keywords
  if (ext === 'py') {
    for (const kw of PYTHON_KEYWORDS) {
      options.push({ label: kw, detail: 'keyword', type: 'keyword' });
    }
    options.push(
      snippetCompletion('def ${name}(${args}):\n\t${}', { label: 'def', detail: 'Function definition', type: 'snippet' }),
      snippetCompletion('class ${Name}:\n\tdef __init__(self, ${args}):\n\t\t${}', { label: 'class', detail: 'Class definition', type: 'snippet' }),
      snippetCompletion('if __name__ == "__main__":\n\t${}', { label: 'main', detail: 'Main guard', type: 'snippet' }),
      snippetCompletion('for ${item} in ${iterable}:\n\t${}', { label: 'for', detail: 'For loop', type: 'snippet' }),
      snippetCompletion('try:\n\t${}\nexcept ${Exception} as e:\n\t\n', { label: 'try except', detail: 'Try/except block', type: 'snippet' }),
      snippetCompletion('with open(${filename}, "${mode}") as f:\n\t${}', { label: 'with open', detail: 'Open file', type: 'snippet' })
    );
  }

  // CSS properties
  if (['css', 'scss', 'less'].includes(ext)) {
    for (const prop of CSS_PROPERTIES) {
      options.push({ label: prop, detail: 'CSS property', type: 'property' });
    }
    options.push(
      snippetCompletion('display: flex;\n\tjustify-content: ${center};\n\talign-items: ${center};', { label: 'flex center', detail: 'Flex center', type: 'snippet' }),
      snippetCompletion('display: grid;\n\tgrid-template-columns: ${1fr 1fr};\n\tgap: ${10px};', { label: 'grid 2col', detail: 'Grid 2 columns', type: 'snippet' }),
      snippetCompletion('@media (max-width: ${768}px) {\n\t${}\n}', { label: '@media', detail: 'Media query', type: 'snippet' })
    );
  }

  // HTML snippets
  if (['html', 'htm', 'svg', 'xml'].includes(ext)) {
    options.push(
      snippetCompletion('<div class="${class}">\n\t${}\n</div>', { label: 'div', detail: 'Div element', type: 'snippet' }),
      snippetCompletion('<a href="${url}">${text}</a>', { label: 'a', detail: 'Anchor link', type: 'snippet' }),
      snippetCompletion('<img src="${src}" alt="${alt}" />', { label: 'img', detail: 'Image', type: 'snippet' }),
      snippetCompletion('<ul>\n\t<li>${item}</li>\n</ul>', { label: 'ul', detail: 'Unordered list', type: 'snippet' }),
      snippetCompletion('<input type="${text}" ' + 'v-model="${value}" />', { label: 'input', detail: 'Input element', type: 'snippet' })
    );
  }

  // JSON
  if (['json', 'jsonc'].includes(ext)) {
    options.push(
      { label: 'name', detail: 'name field', type: 'property' },
      { label: 'version', detail: 'version field', type: 'property' },
      { label: 'description', detail: 'description field', type: 'property' },
      { label: 'main', detail: 'main field', type: 'property' },
      { label: 'scripts', detail: 'scripts field', type: 'property' },
      { label: 'dependencies', detail: 'dependencies field', type: 'property' },
      { label: 'devDependencies', detail: 'devDependencies field', type: 'property' },
      { label: 'type', detail: 'type field', type: 'property' },
      { label: 'license', detail: 'license field', type: 'property' },
      { label: 'author', detail: 'author field', type: 'property' },
      { label: 'keywords', detail: 'keywords field', type: 'property' }
    );
  }

  return options;
}

function completionSource(context) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }

  const options = buildCompletionOptions(props.filePath);
  if (!options.length) {
    return null;
  }

  return {
    from: word.from,
    options,
    validFor: /^\w*$/
  };
}

function languageExtension(filePath) {
  const extension = extensionFromPath(filePath);

  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension)) {
    return javascript({ jsx: ['jsx', 'tsx'].includes(extension), typescript: ['ts', 'tsx'].includes(extension) });
  }
  if (extension === 'vue') {
    return vue();
  }
  if (['json', 'jsonc'].includes(extension)) {
    return json();
  }
  if (['html', 'htm', 'svg', 'xml'].includes(extension)) {
    return html();
  }
  if (['css', 'scss', 'less'].includes(extension)) {
    return css();
  }
  if (['md', 'mdx'].includes(extension)) {
    return markdown();
  }
  if (extension === 'py') {
    return python();
  }
  if (extension === 'sql') {
    return sql();
  }

  return [];
}

function buildEditorTheme() {
  const cursorAnimation = props.cursorBlinking === 'solid' ? 'none' : 
    props.cursorBlinking === 'smooth' ? 'cm-cursor-smooth' :
    props.cursorBlinking === 'phase' ? 'cm-cursor-phase' :
    props.cursorBlinking === 'expand' ? 'cm-cursor-expand' : '';
  const smoothScroll = props.smoothScrolling ? 'smooth' : 'auto';

  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-fg)',
      fontSize: '13px',
      scrollBehavior: smoothScroll
    },
    '.cm-scroller': {
      fontFamily: `${props.fontFamily}, Consolas, "Courier New", monospace`,
      fontSize: `${props.fontSize}px`,
      lineHeight: '21px',
      scrollBehavior: smoothScroll
    },
    '.cm-content': {
      caretColor: 'var(--editor-cursor)',
      padding: '8px 0'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-line-number)',
      borderRight: '1px solid var(--editor-border)',
      width: '52px'
    },
    '.cm-gutter.cm-lineNumbers': {
      minWidth: '44px'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 8px',
      fontSize: '12px'
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
      fontSize: '12px',
      color: 'var(--text-soft)',
      cursor: 'pointer'
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--editor-line-active)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-line-active)',
      color: 'var(--editor-fg)'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--editor-selection)'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--editor-cursor)',
      borderLeftWidth: '2px'
    },
    // Autocomplete tooltip - VSCode style
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--panel-bg-strong)',
      border: '1px solid var(--border-strong)',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontFamily: 'inherit'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
      fontSize: '13px',
      maxHeight: '300px',
      padding: '4px 0'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '3px 12px 3px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      lineHeight: '20px',
      borderRadius: '0'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: '#ffffff'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul li .cm-completionIcon': {
      fontSize: '14px',
      width: '16px',
      flex: '0 0 16px'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul li .cm-completionLabel': {
      fontSize: '12px',
      opacity: '0.8',
      marginLeft: 'auto',
      paddingLeft: '12px'
    },
    // Completion detail tooltip
    '.cm-tooltip.cm-completionInfo': {
      backgroundColor: 'var(--panel-bg-strong)',
      border: '1px solid var(--border-strong)',
      borderRadius: '4px',
      fontSize: '12px',
      padding: '6px 10px',
      maxWidth: '300px'
    },
    // Hover tooltip
    '.cm-tooltip': {
      backgroundColor: 'var(--panel-bg-strong)',
      border: '1px solid var(--border-strong)',
      borderRadius: '4px',
      fontSize: '12px'
    },
    // Search match highlighting
    '.cm-searchMatch': {
      backgroundColor: 'rgba(234, 184, 16, 0.25)',
      borderRadius: '2px'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(234, 184, 16, 0.45)'
    },
    // Selection matches
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(86, 156, 214, 0.15)',
      borderRadius: '2px'
    },
    // Panels (find/replace)
    '.cm-panels': {
      backgroundColor: 'var(--bg-panel-alt)',
      color: 'var(--text-main)',
      borderTop: '1px solid var(--border)',
      padding: '4px 8px'
    },
    '.cm-panels input': {
      backgroundColor: 'var(--cursor-input)',
      border: '1px solid var(--border-strong)',
      borderRadius: '2px',
      color: 'var(--text-main)',
      padding: '2px 6px',
      outline: 'none'
    },
    '.cm-panels button[name="close"]': {
      color: 'var(--text-soft)',
      padding: '2px 6px'
    },
    // Bracket matching
    '.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(86, 156, 214, 0.15)',
      outline: '1px solid rgba(86, 156, 214, 0.4)',
      borderRadius: '2px'
    },
    '.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(244, 67, 54, 0.15)',
      borderRadius: '2px'
    }
  });
}

const darkPlusHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syntax-control)' },
  { tag: tags.operatorKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.atom, color: 'var(--syntax-keyword)' },
  { tag: tags.bool, color: 'var(--syntax-keyword)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.special(tags.string), color: 'var(--syntax-escape)' },
  { tag: tags.regexp, color: 'var(--syntax-regexp)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--syntax-variable)' },
  { tag: tags.local(tags.variableName), color: 'var(--editor-fg)' },
  { tag: tags.definition(tags.variableName), color: 'var(--syntax-variable)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
  { tag: tags.function(tags.definition(tags.variableName)), color: 'var(--syntax-function)' },
  { tag: tags.propertyName, color: 'var(--syntax-property)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--syntax-property)' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.className, color: 'var(--syntax-type)' },
  { tag: tags.namespace, color: 'var(--syntax-type)' },
  { tag: tags.tagName, color: 'var(--syntax-keyword)' },
  { tag: tags.attributeName, color: 'var(--syntax-variable)' },
  { tag: tags.angleBracket, color: 'var(--syntax-muted)' },
  { tag: tags.bracket, color: 'var(--syntax-bracket)' },
  { tag: tags.punctuation, color: 'var(--editor-fg)' },
  { tag: tags.operator, color: 'var(--editor-fg)' },
  { tag: tags.invalid, color: 'var(--syntax-invalid)' },
  { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.link, color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' }
]);

function buildWrapExtension() {
  return props.wordWrap ? [EditorView.lineWrapping] : [];
}

function buildTabSizeExtension() {
  return EditorState.tabSize.of(props.tabSize || 2);
}

function buildFeaturesExtension() {
  const exts = [];
  if (props.lineNumbers) {
    exts.push(lineNumbers());
    exts.push(highlightActiveLineGutter());
  }
  exts.push(foldGutter());
  if (props.bracketPairColorization) {
    exts.push(bracketMatching());
  }
  exts.push(indentOnInput());
  // Render whitespace via decorations
  if (props.renderWhitespace && props.renderWhitespace !== 'none') {
    exts.push(buildWhitespacePlugin());
  }
  return exts;
}

// ===== Whitespace rendering plugin =====
function buildWhitespacePlugin() {
  return EditorView.decorations.of((view) => {
    const { state } = view;
    const doc = state.doc;
    const decorations = [];
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const text = line.text;
      let pos = line.from;
      for (let j = 0; j < text.length; j++) {
        const ch = text[j];
        if (ch === ' ' || ch === '\t') {
          const isBoundary = props.renderWhitespace === 'boundary';
          const prevChar = j > 0 ? text[j - 1] : '';
          const nextChar = j < text.length - 1 ? text[j + 1] : '';
          const isAtBoundary = prevChar === '' || nextChar === '' || prevChar === ch;
          if (!isBoundary || isAtBoundary) {
            decorations.push({
              from: pos + j,
              to: pos + j + 1,
              value: Decoration.mark({ class: 'cm-whitespace' })
            });
          }
        }
      }
    }
    return Decoration.set(decorations);
  });
}

// ===== Minimap =====
function renderMinimap() {
  if (!minimapRef.value || !editorView.value) return;
  const canvas = minimapRef.value;
  const ctx = canvas.getContext('2d');
  const view = editorView.value;
  const doc = view.state.doc;
  const lines = doc.lines;
  const lineHeight = 2;
  const charWidth = 1.2;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 80;
  const cssHeight = canvas.clientHeight || 300;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.font = `${lineHeight * 4}px monospace`;

  // Get visible line range
  const scrollTop = view.scrollDOM.scrollTop;
  const editorLineHeight = 21;
  const visibleStart = Math.floor(scrollTop / editorLineHeight);
  const visibleCount = Math.ceil(cssHeight / lineHeight);
  const startLine = Math.max(0, Math.floor(scrollTop / editorLineHeight) - 5);
  const maxLines = Math.min(lines, startLine + visibleCount + 20);

  // Get theme colors
  const styles = getComputedStyle(document.documentElement);
  const bgColor = styles.getPropertyValue('--editor-bg').trim() || '#1e1e1e';
  const fgColor = styles.getPropertyValue('--editor-fg').trim() || '#d4d4d4';
  const keywordColor = styles.getPropertyValue('--syntax-keyword').trim() || '#569cd6';
  const stringColor = styles.getPropertyValue('--syntax-string').trim() || '#ce9178';
  const commentColor = styles.getPropertyValue('--syntax-comment').trim() || '#6a9955';
  const numberColor = styles.getPropertyValue('--syntax-number').trim() || '#b5cea8';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  for (let i = startLine; i < maxLines; i++) {
    const line = doc.line(i + 1);
    const text = line.text;
    const y = i * lineHeight;
    if (y > cssHeight) break;

    let x = 2;
    for (let j = 0; j < text.length && x < cssWidth; j++) {
      const ch = text[j];
      if (ch === ' ') { x += charWidth * 0.5; continue; }
      if (ch === '\t') { x += charWidth * 4; continue; }

      // Simple color heuristic
      let color = fgColor;
      if (j < text.length) {
        const remaining = text.slice(j);
        if (/^\s*(\/\/|\/\*|#)/.test(text.slice(0, j + 2))) {
          color = commentColor;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          color = stringColor;
        } else if (/\d/.test(ch)) {
          color = numberColor;
        } else if (/[a-zA-Z_$]/.test(ch)) {
          const wordMatch = remaining.match(/^(\w+)/);
          if (wordMatch) {
            const word = wordMatch[1];
            if (JS_KEYWORDS.includes(word) || PYTHON_KEYWORDS.includes(word)) {
              color = keywordColor;
            }
          }
        }
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, charWidth, lineHeight);
      x += charWidth;
    }
  }

  // Draw viewport indicator
  const viewStartY = (scrollTop / editorLineHeight) * lineHeight;
  const viewHeight = (canvas.clientHeight / editorLineHeight) * lineHeight * (cssHeight / (view.scrollDOM.scrollHeight || 1));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(0, viewStartY, cssWidth, Math.min(viewHeight, cssHeight));
}

function scheduleMinimap() {
  if (minimapRaf) return;
  minimapRaf = requestAnimationFrame(() => {
    minimapRaf = null;
    renderMinimap();
  });
}

function handleMinimapClick(event) {
  if (!editorView.value || !minimapRef.value) return;
  const rect = minimapRef.value.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  const scrollDom = editorView.value.scrollDOM;
  scrollDom.scrollTop = ratio * scrollDom.scrollHeight - scrollDom.clientHeight / 2;
}

function createState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      wrapCompartment.of(buildWrapExtension()),
      tabSizeCompartment.of(buildTabSizeExtension()),
      featuresCompartment.of(buildFeaturesExtension()),
      history(),
      drawSelection(),
      dropCursor(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(darkPlusHighlightStyle),
      EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
      autocompletion({
        activateOnTyping: true,
        maxRenderedSuggestions: 50,
        aboveCursor: false,
        defaultKeymap: true,
        closeOnBlur: true
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      languageCompartment.of(languageExtension(props.filePath)),
      themeCompartment.of(buildEditorTheme()),
      keymap.of([
        {
          key: 'Mod-s',
          run() {
            emit('save');
            return true;
          }
        },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...searchKeymap
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternalChange && !isImageFile.value) {
          emit('change', update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          const col = head - line.from + 1;
          emit('cursor-change', { line: line.number, col });
        }
        if (update.docChanged || update.viewportChanged) {
          scheduleMinimap();
        }
      })
    ]
  });
}

function replaceDocument(content) {
  if (!editorView.value) {
    return;
  }

  const current = editorView.value.state.doc.toString();
  if (current === (content || '')) {
    return;
  }

  applyingExternalChange = true;
  editorView.value.dispatch({
    changes: {
      from: 0,
      to: editorView.value.state.doc.length,
      insert: content || ''
    }
  });
  applyingExternalChange = false;
}

async function focusEditor() {
  await nextTick();
  editorView.value?.focus?.();
}

function revealLine(lineNumber) {
  if (!editorView.value || !lineNumber) {
    return;
  }

  const line = editorView.value.state.doc.line(Math.min(Math.max(1, lineNumber), editorView.value.state.doc.lines));
  editorView.value.dispatch({
    selection: EditorSelection.cursor(line.from),
    scrollIntoView: true
  });
  editorView.value.focus();
}

let scrollDomRef = null;

function handleScroll() {
  scheduleMinimap();
}

onMounted(() => {
  editorView.value = new EditorView({
    state: createState(props.content || ''),
    parent: containerRef.value
  });
  if (editorView.value && props.minimap) {
    scrollDomRef = editorView.value.scrollDOM;
    scrollDomRef.addEventListener('scroll', handleScroll);
    nextTick(() => renderMinimap());
  }
});

onBeforeUnmount(() => {
  if (scrollDomRef) {
    scrollDomRef.removeEventListener('scroll', handleScroll);
  }
  if (minimapRaf) {
    cancelAnimationFrame(minimapRaf);
  }
  editorView.value?.destroy();
});

watch(
  () => props.filePath,
  async (filePath) => {
    if (!editorView.value) {
      return;
    }

    editorView.value.dispatch({
      effects: languageCompartment.reconfigure(languageExtension(filePath))
    });
    replaceDocument(props.content);

    if (filePath) {
      await focusEditor();
    }
  }
);

watch(
  () => [props.fontSize, props.fontFamily, props.cursorBlinking, props.smoothScrolling],
  () => {
    if (!editorView.value) {
      return;
    }

    editorView.value.dispatch({
      effects: themeCompartment.reconfigure(buildEditorTheme())
    });
  }
);

watch(
  () => props.content,
  (content) => {
    replaceDocument(content);
  }
);

watch(
  () => props.focusLine,
  (lineNumber) => {
    if (lineNumber) {
      revealLine(lineNumber);
    }
  }
);

// Reconfigure editor features when settings change
watch(
  () => props.wordWrap,
  () => {
    editorView.value?.dispatch({
      effects: wrapCompartment.reconfigure(buildWrapExtension())
    });
  }
);

watch(
  () => props.tabSize,
  () => {
    editorView.value?.dispatch({
      effects: tabSizeCompartment.reconfigure(buildTabSizeExtension())
    });
  }
);

watch(
  () => [props.lineNumbers, props.bracketPairColorization, props.renderWhitespace],
  () => {
    editorView.value?.dispatch({
      effects: featuresCompartment.reconfigure(buildFeaturesExtension())
    });
  }
);

watch(
  () => props.minimap,
  (visible) => {
    if (visible) {
      nextTick(() => {
        if (editorView.value && !scrollDomRef) {
          scrollDomRef = editorView.value.scrollDOM;
          scrollDomRef.addEventListener('scroll', handleScroll);
        }
        renderMinimap();
      });
    } else if (scrollDomRef) {
      scrollDomRef.removeEventListener('scroll', handleScroll);
      scrollDomRef = null;
    }
  }
);

watch(
  () => props.content,
  (content) => {
    replaceDocument(content);
    scheduleMinimap();
  }
);

function editorUndo() {
  if (!editorView.value || isImageFile.value) {
    return false;
  }
  return undo(editorView.value);
}

function editorRedo() {
  if (!editorView.value || isImageFile.value) {
    return false;
  }
  return redo(editorView.value);
}

function editorFormat() {
  if (!editorView.value || isImageFile.value) {
    return;
  }
  // Simple format: re-indent the entire document
  const view = editorView.value;
  const state = view.state;
  const doc = state.doc.toString();
  const lines = doc.split('\n');
  let indent = 0;
  const tabSize = props.tabSize || 2;
  const formatted = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    // Decrease indent for lines starting with closing brackets
    if (/^[}\])]/.test(trimmed)) {
      indent = Math.max(0, indent - 1);
    }
    const result = ' '.repeat(indent * tabSize) + trimmed;
    // Increase indent for lines ending with opening brackets
    if (/[{[(]$/.test(trimmed) && !/^.*[}\])].*[{[(]$/.test(trimmed)) {
      indent++;
    }
    return result;
  }).join('\n');

  applyingExternalChange = true;
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: formatted }
  });
  applyingExternalChange = false;
}

function editorGoToDefinition() {
  if (!editorView.value || isImageFile.value) {
    return;
  }
  // Simple word-based search: find next occurrence of the word under cursor
  const view = editorView.value;
  const state = view.state;
  const head = state.selection.main.head;
  const word = state.wordAt(head);
  if (!word) return;

  const wordText = state.doc.sliceString(word.from, word.to);
  const doc = state.doc.toString();

  // Search for the word as a definition pattern (function/const/let/var/class)
  const patterns = [
    new RegExp(`function\\s+${wordText}\\b`, 'g'),
    new RegExp(`(?:const|let|var)\\s+${wordText}\\b`, 'g'),
    new RegExp(`class\\s+${wordText}\\b`, 'g'),
    new RegExp(`def\\s+${wordText}\\b`, 'g')
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(doc);
    if (match && match.index !== word.from) {
      const pos = match.index;
      const line = state.doc.lineAt(pos);
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        scrollIntoView: true
      });
      view.focus();
      return;
    }
  }
}

defineExpose({
  undo: editorUndo,
  redo: editorRedo,
  focus: focusEditor,
  format: editorFormat,
  goToDefinition: editorGoToDefinition,
  goToLine: revealLine
});
</script>

<template>
  <div class="editor-panel">
    <div class="editor-panel__toolbar">
      <div class="editor-breadcrumbs">
        <span class="editor-breadcrumbs__icon codicon codicon-folder"></span>
        <template v-if="filePath">
          <span
            v-for="(segment, index) in breadcrumbSegments"
            :key="index"
            class="editor-breadcrumbs__segment"
          >
            <span class="editor-breadcrumbs__chevron codicon codicon-chevron-right"></span>
            <span class="editor-breadcrumbs__name">{{ segment }}</span>
          </span>
        </template>
        <span v-else class="editor-breadcrumbs__placeholder">{{ t('selectFileToEdit') }}</span>
      </div>
      <div class="editor-panel__actions">
        <span class="editor-panel__hint">{{ t('saveHint') }}</span>
        <button class="ghost-button" @click="$emit('save')" :disabled="emptyState || isImageFile">{{ t('saveFile') }}</button>
      </div>
    </div>
    <div class="editor-panel__body">
      <div v-show="emptyState" class="editor-empty">
        <h3>Mirai Agent IDE</h3>
        <p>{{ t('openFileToBegin') }}</p>
      </div>
      <div v-if="isImageFile" class="image-preview">
        <div class="image-preview__frame">
          <img :src="file.dataUrl" :alt="file.name" />
        </div>
        <div class="image-preview__meta">
          <strong>{{ file.name }}</strong>
          <span>{{ file.mime }} · {{ Math.max(1, Math.round((file.size || 0) / 1024)) }} KB</span>
        </div>
      </div>
      <div v-show="!emptyState && !isImageFile" class="editor-panel__editor-wrapper">
        <div ref="containerRef" class="editor-panel__container"></div>
        <canvas
          v-if="minimap && !emptyState && !isImageFile"
          ref="minimapRef"
          class="editor-minimap"
          @click="handleMinimapClick"
        ></canvas>
      </div>
    </div>
  </div>
</template>
