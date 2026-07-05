<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { t } from '../utils/i18n.js';

const props = defineProps({
  workspacePath: {
    type: String,
    default: ''
  },
  fontSize: {
    type: Number,
    default: 13
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  height: {
    type: Number,
    default: 180
  }
});

const emit = defineEmits(['toggle-collapse', 'update:height']);

const terminalHostRef = ref(null);
const terminal = ref(null);
const fitAddon = ref(null);
const searchAddonRef = ref(null);
const terminalSessions = ref([]);
const activeTerminalId = ref('');
const resizeObserver = ref(null);
const panelRef = ref(null);
const isResizing = ref(false);
const terminalSearchVisible = ref(false);
const terminalSearchQuery = ref('');
let refreshTimer = null;

function toggleCollapse() {
  emit('toggle-collapse');
}

function toggleTerminalSearch() {
  terminalSearchVisible.value = !terminalSearchVisible.value;
  if (!terminalSearchVisible.value) {
    terminalSearchQuery.value = '';
  }
}

function doTerminalSearch(direction) {
  if (!searchAddonRef.value || !terminalSearchQuery.value) return;
  if (direction === 'prev') {
    searchAddonRef.value.findPrevious(terminalSearchQuery.value);
  } else {
    searchAddonRef.value.findNext(terminalSearchQuery.value);
  }
}

function startResize(event) {
  event.preventDefault();
  isResizing.value = true;
  const startY = event.clientY;
  const startHeight = props.height;

  function onMouseMove(moveEvent) {
    const delta = startY - moveEvent.clientY;
    const nextHeight = Math.max(80, Math.min(600, startHeight + delta));
    emit('update:height', nextHeight);
  }

  function onMouseUp() {
    isResizing.value = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    resizeTerminal();
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

async function refreshTerminals() {
  const sessions = await window.mirai?.listTerminals?.();
  terminalSessions.value = Array.isArray(sessions) ? sessions : [];

  if (!activeTerminalId.value && terminalSessions.value.length) {
    activeTerminalId.value = terminalSessions.value[0].id;
  }
}

async function createTerminalSession() {
  const session = await window.mirai?.createTerminal?.({
    cwd: props.workspacePath || undefined,
    name: `Terminal ${terminalSessions.value.length + 1}`
  });

  if (session?.id) {
    await refreshTerminals();
    activeTerminalId.value = session.id;
    await nextTick();
    await attachTerminal(session.id);
  }
}

async function setActiveTerminal(terminalId) {
  activeTerminalId.value = terminalId;
  await window.mirai?.focusTerminal?.({ terminalId });
  await attachTerminal(terminalId);
}

async function closeTerminal(terminalId) {
  await window.mirai?.killTerminal?.({ terminalId });
  await refreshTerminals();
  if (activeTerminalId.value === terminalId) {
    activeTerminalId.value = terminalSessions.value[0]?.id || '';
  }
}

function clearTerminal() {
  if (!terminal.value) {
    return;
  }
  terminal.value.clear();
}

async function killTerminal() {
  if (!activeTerminalId.value) {
    return;
  }
  await closeTerminal(activeTerminalId.value);
}

async function attachTerminal(terminalId) {
  if (!terminal.value) {
    return;
  }

  const payload = await window.mirai?.readTerminal?.({ terminalId });
  if (payload?.buffer) {
    terminal.value.write(payload.buffer.replace(/\n/g, '\r\n'));
  }
}

async function pumpTerminalOutput() {
  if (!activeTerminalId.value || !terminal.value) {
    return;
  }

  const payload = await window.mirai?.readTerminal?.({ terminalId: activeTerminalId.value });
  if (payload?.buffer) {
    terminal.value.write(payload.buffer.replace(/\n/g, '\r\n'));
  }
}

function resizeTerminal() {
  if (props.collapsed || !terminal.value) {
    return;
  }
  try {
    fitAddon.value?.fit();
  } catch (error) {
    // noop
  }
}

async function sendInput(data) {
  if (!activeTerminalId.value) {
    return;
  }

  await window.mirai?.writeTerminal?.({
    terminalId: activeTerminalId.value,
    value: data
  });
}

function bindTerminalEvents(instance) {
  instance.onData((data) => {
    sendInput(data);
  });
}

onMounted(async () => {
  terminal.value = new Terminal({
    cursorBlink: true,
    fontSize: props.fontSize,
    fontFamily: 'Consolas, "Cascadia Code", monospace',
    theme: {
      background: 'var(--terminal-bg)',
      foreground: 'var(--terminal-fg)',
      cursor: 'var(--terminal-cursor)',
      selectionBackground: 'var(--editor-selection)'
    },
    allowTransparency: true,
    convertEol: true
  });

  fitAddon.value = new FitAddon();
  terminal.value.loadAddon(fitAddon.value);
  const searchAddon = new SearchAddon();
  terminal.value.loadAddon(searchAddon);
  searchAddonRef.value = searchAddon;
  terminal.value.open(terminalHostRef.value);
  bindTerminalEvents(terminal.value);

  resizeTerminal();
  await refreshTerminals();

  if (!terminalSessions.value.length) {
    await createTerminalSession();
  }

  refreshTimer = window.setInterval(async () => {
    await pumpTerminalOutput();
  }, 200);

  resizeObserver.value = new ResizeObserver(() => resizeTerminal());
  if (terminalHostRef.value) {
    resizeObserver.value.observe(terminalHostRef.value);
  }
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  resizeObserver.value?.disconnect();
  terminal.value?.dispose();
});

watch(
  () => props.workspacePath,
  async () => {
    await refreshTerminals();
    if (activeTerminalId.value) {
      await attachTerminal(activeTerminalId.value);
    }
  }
);

watch(
  () => props.fontSize,
  (size) => {
    if (terminal.value) {
      terminal.value.options.fontSize = size;
      resizeTerminal();
    }
  }
);

watch(
  () => props.collapsed,
  async (collapsed) => {
    if (!collapsed) {
      await nextTick();
      resizeTerminal();
      if (activeTerminalId.value) {
        await attachTerminal(activeTerminalId.value);
      }
    }
  }
);

watch(
  () => props.height,
  async () => {
    await nextTick();
    resizeTerminal();
  }
);

defineExpose({
  createTerminalSession,
  clearTerminal,
  killTerminal
});
</script>

<template>
  <section ref="panelRef" class="terminal-panel" :class="{ 'is-collapsed': collapsed }" :style="{ height: collapsed ? 'auto' : `${height}px` }">
    <div class="terminal-panel__header">
      <div class="terminal-panel__tabs">
        <button
          v-for="session in terminalSessions"
          :key="session.id"
          class="terminal-tab"
          :class="{ 'is-active': session.id === activeTerminalId }"
          @click="setActiveTerminal(session.id)"
        >
          {{ session.name }}
          <span class="terminal-tab__close codicon codicon-close" @click.stop="closeTerminal(session.id)"></span>
        </button>
      </div>
      <div class="terminal-panel__actions">
        <button v-if="terminalSessions.length" class="icon-button codicon codicon-search" title="Search" @click="toggleTerminalSearch"></button>
        <button class="icon-button codicon codicon-add" :title="t('newTerminal')" @click="createTerminalSession"></button>
        <button
          class="icon-button"
          :class="collapsed ? 'codicon codicon-chevron-up' : 'codicon codicon-chevron-down'"
          :title="collapsed ? t('expand') : t('closePanel')"
          @click="toggleCollapse"
        ></button>
      </div>
    </div>
    <div v-if="terminalSearchVisible && !collapsed" class="terminal-search-bar">
      <input
        v-model="terminalSearchQuery"
        class="terminal-search-bar__input"
        placeholder="Search terminal..."
        @keydown.enter.prevent="doTerminalSearch('next')"
        @keydown.escape="toggleTerminalSearch"
      />
      <button class="icon-button codicon codicon-arrow-up" title="Previous" @click="doTerminalSearch('prev')"></button>
      <button class="icon-button codicon codicon-arrow-down" title="Next" @click="doTerminalSearch('next')"></button>
      <button class="icon-button codicon codicon-close" title="Close" @click="toggleTerminalSearch"></button>
    </div>
    <div v-show="!collapsed" class="terminal-panel__body">
      <div ref="terminalHostRef" class="terminal-host"></div>
      <div v-if="!terminalSessions.length" class="terminal-empty">
        {{ t('noTerminalYet') }}
      </div>
    </div>
    <div
      v-show="!collapsed"
      class="terminal-panel__resize-handle"
      :class="{ 'is-resizing': isResizing }"
      @mousedown="startResize"
    ></div>
  </section>
</template>
