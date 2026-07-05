<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps({
  workspacePath: {
    type: String,
    default: ''
  }
});

const terminalHostRef = ref(null);
const terminal = ref(null);
const fitAddon = ref(null);
const terminalSessions = ref([]);
const activeTerminalId = ref('');
const resizeObserver = ref(null);
let refreshTimer = null;

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
    fontSize: 13,
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
</script>

<template>
  <section class="terminal-panel">
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
        <button class="icon-button codicon codicon-add" title="New Terminal" @click="createTerminalSession"></button>
      </div>
    </div>
    <div class="terminal-panel__body">
      <div ref="terminalHostRef" class="terminal-host"></div>
      <div v-if="!terminalSessions.length" class="terminal-empty">
        No terminal yet. Create one from the + button.
      </div>
    </div>
  </section>
</template>
