<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { useAgentStore } from '../stores/agent.js';
import { t } from '../utils/i18n.js';

const props = defineProps({
  mode: {
    type: String,
    default: 'agent'
  },
  model: {
    type: String,
    default: 'gpt-4o'
  },
  currentFile: {
    type: String,
    default: ''
  },
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['mode-change', 'model-change', 'toggle-collapse']);

const agentStore = useAgentStore();

const input = ref('');
const messageListRef = ref(null);
const showConfig = ref(false);
const configForm = ref({
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 4096
});

const models = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'deepseek-coder', label: 'DeepSeek Coder' },
  { value: 'custom', label: 'Custom...' }
];

const modes = [
  { value: 'agent', label: 'Agent', icon: 'codicon-robot' },
  { value: 'ask', label: 'Ask', icon: 'codicon-question' },
  { value: 'plan', label: 'Plan', icon: 'codicon-list-tree' },
  { value: 'debug', label: 'Debug', icon: 'codicon-bug' }
];

const isStreaming = computed(() => agentStore.isStreaming);
const messages = computed(() => agentStore.messages);
const hasConfig = computed(() => agentStore.hasConfig);

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
}

watch(messages, () => scrollToBottom(), { deep: true });

async function handleSend() {
  const value = input.value.trim();
  if (!value || isStreaming.value) return;

  // Ensure config is loaded
  if (!agentStore.configLoaded) {
    await agentStore.loadConfig();
  }

  // If no API key, open config dialog
  if (!agentStore.hasConfig) {
    showConfig.value = true;
    return;
  }

  input.value = '';
  await agentStore.send(value);
  scrollToBottom();
}

function handleKeydown(event) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSend();
  }
}

async function handleAbort() {
  await agentStore.abort();
}

async function handleNewChat() {
  await agentStore.clearChat();
}

async function openConfig() {
  // Load current config into form
  if (!agentStore.configLoaded) {
    await agentStore.loadConfig();
  }
  configForm.value = { ...agentStore.config };
  // Sync model dropdown
  if (!models.find(m => m.value === configForm.value.model)) {
    configForm.value.model = configForm.value.model || 'gpt-4o';
  }
  showConfig.value = true;
}

async function saveConfig() {
  await agentStore.saveConfig(configForm.value);
  // Update model selection
  emit('model-change', configForm.value.model);
  showConfig.value = false;
}

function toggleToolCall(messageId, toolCallId) {
  agentStore.toggleToolCallExpand(messageId, toolCallId);
}

function formatToolArgs(argsStr) {
  try {
    const parsed = JSON.parse(argsStr);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return argsStr || '{}';
  }
}

function formatToolResult(result) {
  if (!result) return '';
  if (result.success) {
    const r = result.result;
    if (typeof r === 'string') {
      // Truncate very long results
      if (r.length > 2000) return r.slice(0, 2000) + '\n... (truncated)';
      return r;
    }
    return JSON.stringify(r, null, 2);
  }
  return `Error: ${result.error}`;
}

function isToolSuccess(result) {
  return result?.success === true;
}

onMounted(() => {
  agentStore.loadConfig();
  agentStore.registerEventListener();
});

onBeforeUnmount(() => {
  // Don't remove the listener — it persists across panel show/hide
});

// --- Markdown rendering ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return '<pre class="md-code-block"><code>' + code + '</code></pre>';
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function getToolIcon(toolName) {
  const icons = {
    read_file: 'codicon-file-code',
    write_file: 'codicon-edit',
    list_files: 'codicon-list-tree',
    search_files: 'codicon-search',
    run_command: 'codicon-terminal',
    create_file: 'codicon-new-file',
    delete_file: 'codicon-trash',
    get_workspace_info: 'codicon-info'
  };
  return icons[toolName] || 'codicon-tools';
}
</script>

<template>
  <div class="panel agent-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="agent-header">
      <div class="agent-header__title">
        <span class="codicon codicon-comment-discussion"></span>
        <div class="agent-header__text">
          <strong>{{ t('agent') }}</strong>
          <span>{{ currentFile || t('noFileSelected') }}</span>
        </div>
      </div>
      <div class="agent-header__actions">
        <button
          class="icon-button codicon"
          :class="{ 'codicon-settings-gear': !hasConfig, 'codicon-check': hasConfig }"
          :title="hasConfig ? 'API configured' : 'Configure API'"
          @click="openConfig"
        ></button>
        <button class="icon-button codicon codicon-add" :title="t('newChat')" @click="handleNewChat"></button>
        <button
          class="icon-button codicon"
          :class="collapsed ? 'codicon-chevron-left' : 'codicon-chevron-right'"
          :title="collapsed ? t('showAgentPanel') : t('collapseAgentPanel')"
          type="button"
          @click="$emit('toggle-collapse')"
        ></button>
      </div>
    </div>

    <div v-if="!collapsed" class="agent-toolbar">
      <select :value="mode" class="composer-pill" @change="$emit('mode-change', $event.target.value)">
        <option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <select :value="model" class="composer-model" @change="$emit('model-change', $event.target.value)">
        <option v-for="m in models" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>

    <div v-if="!collapsed" ref="messageListRef" class="message-list agent-message-list">
      <!-- Empty state -->
      <div v-if="messages.length === 0" class="agent-empty">
        <span class="codicon codicon-robot agent-empty__icon"></span>
        <p>{{ t('agentInputPlaceholder') }}</p>
        <p v-if="!hasConfig" class="agent-empty__hint">
          Click the gear icon above to configure your LLM API key.
        </p>
      </div>

      <!-- Messages -->
      <article
        v-for="message in messages"
        :key="message.id"
        class="agent-msg"
        :class="`agent-msg--${message.role}`"
      >
        <div class="agent-msg__header">
          <span class="codicon" :class="message.role === 'user' ? 'codicon-account' : 'codicon-robot'"></span>
          <strong>{{ message.role === 'user' ? 'You' : 'Agent' }}</strong>
          <span v-if="message.status === 'streaming'" class="agent-msg__status agent-msg__status--streaming">
            <span class="agent-cursor"></span>
          </span>
          <span v-else-if="message.status === 'error'" class="agent-msg__status agent-msg__status--error">error</span>
          <span v-else-if="message.status === 'aborted'" class="agent-msg__status agent-msg__status--aborted">aborted</span>
        </div>

        <!-- Message content (markdown-like rendering) -->
        <div v-if="message.content" class="agent-msg__body" v-html="renderMarkdown(message.content)"></div>

        <!-- Tool calls -->
        <div v-if="message.toolCalls && message.toolCalls.length" class="agent-msg__tools">
          <div
            v-for="tc in message.toolCalls"
            :key="tc.id"
            class="tool-call"
            :class="{ 'tool-call--expanded': tc.expanded }"
          >
            <button class="tool-call__header" @click="toggleToolCall(message.id, tc.id)">
              <span class="codicon" :class="tc.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></span>
              <span class="codicon tool-call__icon" :class="getToolIcon(tc.name)"></span>
              <span class="tool-call__name">{{ tc.name }}</span>
              <span
                v-if="tc.result"
                class="tool-call__badge"
                :class="isToolSuccess(tc.result) ? 'tool-call__badge--ok' : 'tool-call__badge--err'"
              >
                {{ isToolSuccess(tc.result) ? 'success' : 'failed' }}
              </span>
              <span v-else class="tool-call__badge tool-call__badge--pending">running</span>
            </button>
            <div v-if="tc.expanded" class="tool-call__body">
              <div class="tool-call__section">
                <span class="tool-call__label">Arguments:</span>
                <pre class="tool-call__code">{{ formatToolArgs(tc.arguments) }}</pre>
              </div>
              <div v-if="tc.result" class="tool-call__section">
                <span class="tool-call__label">Result:</span>
                <pre class="tool-call__code" :class="{ 'tool-call__code--err': !isToolSuccess(tc.result) }">{{ formatToolResult(tc.result) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-if="!collapsed" class="composer agent-composer">
      <textarea
        v-model="input"
        class="composer__input"
        rows="4"
        :placeholder="hasConfig ? t('agentInputPlaceholder') : 'Configure API key to start chatting...'"
        :disabled="isStreaming"
        @keydown="handleKeydown"
      ></textarea>
      <div class="composer__bar">
        <div class="composer__left">
          <span class="composer__hint">Ctrl+Enter to send</span>
        </div>
        <div class="composer__right">
          <button
            v-if="isStreaming"
            class="composer__button composer__button--abort"
            @click="handleAbort"
          >
            <span class="codicon codicon-stop"></span>
            Stop
          </button>
          <button
            v-else
            class="primary-button composer__button"
            :disabled="!input.trim()"
            @click="handleSend"
          >
            <span class="codicon codicon-send"></span>
            {{ t('send') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Config Dialog -->
    <Transition name="fade">
      <div v-if="showConfig" class="agent-config-overlay" @click.self="showConfig = false">
        <div class="agent-config">
          <div class="agent-config__header">
            <strong>LLM API Configuration</strong>
            <button class="icon-button codicon codicon-close" @click="showConfig = false"></button>
          </div>
          <div class="agent-config__body">
            <label class="agent-config__field">
              <span>API Key</span>
              <input
                v-model="configForm.apiKey"
                type="password"
                placeholder="sk-..."
                class="agent-config__input"
              />
            </label>
            <label class="agent-config__field">
              <span>Base URL</span>
              <input
                v-model="configForm.baseUrl"
                type="text"
                placeholder="https://api.openai.com/v1"
                class="agent-config__input"
              />
            </label>
            <label class="agent-config__field">
              <span>Model</span>
              <select v-model="configForm.model" class="agent-config__input">
                <option v-for="m in models" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </label>
            <div class="agent-config__row">
              <label class="agent-config__field">
                <span>Temperature</span>
                <input
                  v-model.number="configForm.temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  class="agent-config__input"
                />
              </label>
              <label class="agent-config__field">
                <span>Max Tokens</span>
                <input
                  v-model.number="configForm.maxTokens"
                  type="number"
                  min="256"
                  max="32768"
                  step="256"
                  class="agent-config__input"
                />
              </label>
            </div>
            <div class="agent-config__hint">
              Works with any OpenAI-compatible API (OpenAI, Azure, Ollama, LM Studio, DeepSeek, etc.)
            </div>
          </div>
          <div class="agent-config__footer">
            <button class="ghost-button" @click="showConfig = false">Cancel</button>
            <button class="primary-button" @click="saveConfig">Save</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
