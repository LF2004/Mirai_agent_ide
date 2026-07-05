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
  rectangularSelection
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
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
  }
});

const emit = defineEmits(['change', 'save']);
const containerRef = ref(null);
const editorView = ref(null);
const languageCompartment = new Compartment();
const emptyState = computed(() => !props.filePath);
const isImageFile = computed(() => props.file?.kind === 'image');
let applyingExternalChange = false;

function extensionFromPath(filePath) {
  return (filePath.split(/[\\/]/).pop() || '').split('.').pop()?.toLowerCase() || '';
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

function completionSource(context) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }

  return {
    from: word.from,
    options: [
      snippetCompletion('console.log(${value});', {
        label: 'console.log',
        detail: 'Log value'
      }),
      snippetCompletion('async function ${name}(${args}) {\n\t${}\n}', {
        label: 'async function',
        detail: 'Async function'
      }),
      snippetCompletion('export default {\n\tname: "${name}",\n\tsetup() {\n\t\t${}\n\t}\n};', {
        label: 'Vue export default',
        detail: 'Vue component option'
      })
    ]
  };
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-fg)',
    fontSize: '13px'
  },
    '.cm-scroller': {
    fontFamily: `${props.fontFamily}, Consolas, "Courier New", monospace`,
    fontSize: `${props.fontSize}px`,
    lineHeight: '20px'
  },
  '.cm-content': {
    caretColor: 'var(--editor-cursor)',
    padding: '10px 0'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-line-number)',
    borderRight: '1px solid var(--editor-border)'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--editor-line-active)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-line-active)'
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection)'
  },
  '&.cm-focused': {
    outline: 'none'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel-bg-strong)',
    border: '1px solid var(--border-strong)'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: '#04395e',
    color: '#ffffff'
  }
});

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

function createState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(darkPlusHighlightStyle),
      bracketMatching(),
      EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      languageCompartment.of(languageExtension(props.filePath)),
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
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternalChange) {
          emit('change', update.state.doc.toString());
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
  editorView.value?.focus();
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

onMounted(() => {
  editorView.value = new EditorView({
    state: createState(props.content || ''),
    parent: containerRef.value
  });
});

onBeforeUnmount(() => {
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
  () => [props.fontSize, props.fontFamily],
  () => {
    if (!editorView.value) {
      return;
    }

    editorView.value.setTheme?.(editorTheme);
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
</script>

<template>
  <div class="editor-panel">
    <div class="editor-panel__toolbar">
      <span>{{ filePath || t('selectFileToEdit') }}</span>
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
      <div v-show="!emptyState && !isImageFile" ref="containerRef" class="editor-panel__container"></div>
    </div>
  </div>
</template>
