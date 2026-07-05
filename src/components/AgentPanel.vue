<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import { useAgentStore } from '../stores/agent.js';

const props = defineProps({
  mode: { type: String, default: 'agent' },
  model: { type: String, default: '' },
  currentFile: { type: String, default: '' },
  collapsed: { type: Boolean, default: false }
});

const emit = defineEmits(['mode-change', 'model-change', 'toggle-collapse']);

const agentStore = useAgentStore();
const dialog = inject('ideDialog', { alert: fallbackAlert, confirm: fallbackConfirm });

function fallbackAlert(message, title = '提示') {
  window.alert(`${title}\n\n${message}`);
}

function fallbackConfirm(message, title = '确认') {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

const input = ref('');
const messageListRef = ref(null);
const showConfig = ref(false);
const editingModel = ref(null);
const testingModel = ref(false);
const testResult = ref(null);
const showApiKeyMap = ref({});
const copiedSessionId = ref('');

const modes = [
  { value: 'agent', label: 'Agent' },
  { value: 'ask', label: 'Ask' },
  { value: 'plan', label: 'Plan' },
  { value: 'debug', label: 'Debug' }
];

const strengthOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'none', label: 'None' }
];

const endpointOptions = [
  { value: '/v1/chat/completions', label: '/v1/chat/completions' },
  { value: '/v1/responses', label: '/v1/responses' }
];

const isStreaming = computed(() => agentStore.isStreaming);
const messages = computed(() => agentStore.messages);
const hasConfig = computed(() => agentStore.hasConfig);
const currentModel = computed(() => agentStore.currentModel);
const modelsList = computed(() => agentStore.config.models);
const workflow = computed(() => agentStore.workflow);
const sessionHistory = computed(() => agentStore.sessionHistory);
const currentSession = computed(() => sessionHistory.value.find((s) => s.id === agentStore.sessionId) || null);
const currentSessionTitle = computed(() => currentSession.value?.title || 'New chat');
const currentSessionHint = computed(() => {
  if (currentSession.value) return `${currentSession.value.mode || 'agent'} · ${messages.value.length} msgs`;
  return 'Create a new conversation';
});

const agentStatus = computed(() => {
  if (!isStreaming.value) return { label: 'Ready', icon: 'codicon-check', type: 'ready' };
  const lastMsg = messages.value[messages.value.length - 1];
  if (lastMsg?.role === 'assistant' && lastMsg?.toolCalls?.length) {
    const pending = lastMsg.toolCalls.filter((tc) => !tc.result).length;
    if (pending > 0) return { label: `Calling tools (${pending})`, icon: 'codicon-tools', type: 'tool-calling' };
  }
  return { label: 'Thinking...', icon: 'codicon-loading codicon-modifier-spin', type: 'thinking' };
});

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
  });
}

watch(messages, () => scrollToBottom(), { deep: true });

watch(() => props.model, async (newId) => {
  if (newId && agentStore.config.selectedModelId !== newId) {
    await agentStore.selectModel(newId);
  }
}, { immediate: true });

async function handleSend() {
  const value = input.value.trim();
  if (!value || isStreaming.value) return;
  if (!agentStore.configLoaded) await agentStore.loadConfig();
  if (!agentStore.hasConfig) {
    openConfig();
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
  await agentStore.newSession(agentStore.mode);
}

async function switchSession(sessionId) {
  await agentStore.switchSession(sessionId);
  scrollToBottom();
}

async function handleModelSelect(event) {
  const modelId = event.target.value;
  await agentStore.selectModel(modelId);
  emit('model-change', modelId);
}

async function copySessionId(sessionId) {
  if (!sessionId) return;
  try {
    await navigator.clipboard.writeText(sessionId);
    copiedSessionId.value = sessionId;
    setTimeout(() => {
      if (copiedSessionId.value === sessionId) copiedSessionId.value = '';
    }, 1500);
  } catch {
    await dialog.alert(sessionId, 'Session ID');
  }
}

function cloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

function createEmptyModel(provider) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (provider === 'anthropic') {
    return {
      id,
      provider: 'anthropic',
      displayName: 'Anthropic - Claude 3.5 Sonnet',
      modelId: 'claude-3-5-sonnet-20241022',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      thinkingStrength: 'medium',
      extraParams: '',
      customHeaders: '',
      extraParamsEnabled: false,
      customHeadersEnabled: false,
      notes: ''
    };
  }
  return {
    id,
    provider: 'openai',
    displayName: 'OpenAI - GPT-4o',
    modelId: 'gpt-4o',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    reasoningStrength: 'medium',
    endpoint: '/v1/chat/completions',
    extraParams: '',
    customHeaders: '',
    extraParamsEnabled: false,
    customHeadersEnabled: false,
    notes: ''
  };
}

function normalizeModelForm(form) {
  const m = { ...form };
  m.contextWindow = Number(m.contextWindow) || 0;
  m.maxOutputTokens = Number(m.maxOutputTokens) || 0;
  if (!m.extraParamsEnabled) m.extraParams = '';
  if (!m.customHeadersEnabled) m.customHeaders = '';
  return m;
}

async function openConfig() {
  if (!agentStore.configLoaded) await agentStore.loadConfig();
  const model = agentStore.currentModel;
  editingModel.value = model ? cloneModel(model) : createEmptyModel('openai');
  showConfig.value = true;
  testResult.value = null;
}

async function selectModelToEdit(model) {
  if (editingModel.value) await agentStore.updateModel(editingModel.value.id, normalizeModelForm(editingModel.value));
  await agentStore.selectModel(model.id);
  editingModel.value = cloneModel(model);
  testResult.value = null;
}

async function addModel(provider) {
  const model = await agentStore.addModel(provider);
  editingModel.value = cloneModel(model);
  testResult.value = null;
}

async function deleteModel(model) {
  const ok = await dialog.confirm(`确定要删除模型 "${model.displayName}" 吗？`, '删除模型');
  if (!ok) return;
  await agentStore.deleteModel(model.id);
  editingModel.value = agentStore.currentModel ? cloneModel(agentStore.currentModel) : null;
}

function setProvider(provider) {
  if (!editingModel.value || editingModel.value.provider === provider) return;
  const current = editingModel.value;
  current.provider = provider;
  if (provider === 'anthropic') {
    if (!current.baseUrl) current.baseUrl = 'https://api.anthropic.com';
    if (!current.modelId) current.modelId = 'claude-3-5-sonnet-20241022';
    if (!current.thinkingStrength) current.thinkingStrength = 'medium';
  } else {
    if (!current.baseUrl) current.baseUrl = 'https://api.openai.com/v1';
    if (!current.modelId) current.modelId = 'gpt-4o';
    if (!current.reasoningStrength) current.reasoningStrength = 'medium';
    if (!current.endpoint) current.endpoint = '/v1/chat/completions';
  }
}

async function saveConfig(testAfterSave = false) {
  if (!editingModel.value) return;
  const model = normalizeModelForm(editingModel.value);
  await agentStore.updateModel(model.id, model);
  await agentStore.selectModel(model.id);
  await agentStore.saveConfig(agentStore.config);
  if (testAfterSave) {
    testingModel.value = true;
    testResult.value = await agentStore.testModel(model);
    testingModel.value = false;
  } else {
    showConfig.value = false;
  }
}

function toggleShowApiKey(modelId) {
  showApiKeyMap.value[modelId] = !showApiKeyMap.value[modelId];
}

function toggleToolCall(messageId, toolCallId) {
  agentStore.toggleToolCallExpand(messageId, toolCallId);
}

function formatToolArgs(argsStr) {
  try {
    return JSON.stringify(JSON.parse(argsStr), null, 2);
  } catch {
    return argsStr || '{}';
  }
}

function formatToolResult(result) {
  if (!result) return '';
  if (result.success) return typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
  return `Error: ${result.error}`;
}

function isToolSuccess(result) {
  return result?.success === true;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre class="md-code-block"><code>${code}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

onMounted(() => {
  agentStore.loadConfig();
  agentStore.registerEventListener();
  agentStore.loadSessionHistory().then(() => {
    if (!agentStore.sessionId && sessionHistory.value[0]?.id) {
      agentStore.switchSession(sessionHistory.value[0].id);
    }
  });
});

onBeforeUnmount(() => {});
</script>

<template>
  <div class="panel agent-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="agent-header">
      <div class="agent-header__title">
        <span class="agent-header__glyph codicon codicon-comment-discussion"></span>
        <div class="agent-header__text">
          <strong>{{ currentSessionTitle }}</strong>
          <span>{{ currentSessionHint }}</span>
        </div>
      </div>
      <div class="agent-header__actions">
        <button class="icon-button codicon" :class="hasConfig ? 'codicon-check' : 'codicon-settings-gear'" :title="hasConfig ? 'API configured' : 'Configure API'" @click="openConfig"></button>
        <button class="icon-button codicon codicon-refresh" title="Reload models" @click="agentStore.reloadConfig()"></button>
        <button class="icon-button codicon codicon-add" title="New chat" @click="handleNewChat"></button>
        <button class="icon-button codicon" :class="collapsed ? 'codicon-chevron-left' : 'codicon-chevron-right'" :title="collapsed ? 'Show panel' : 'Collapse panel'" type="button" @click="$emit('toggle-collapse')"></button>
      </div>
    </div>

    <div v-if="!collapsed" class="agent-subheader">
      <div class="agent-subheader__left">
        <select :value="mode" class="agent-chip" @change="$emit('mode-change', $event.target.value)">
          <option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
        <select :value="currentModel?.id" class="agent-chip" @change="handleModelSelect">
          <option v-for="m in modelsList" :key="m.id" :value="m.id">{{ m.displayName || m.modelId }}</option>
        </select>
      </div>
      <div class="agent-subheader__right">
        <button class="agent-session-chip" @click="copySessionId(agentStore.sessionId)">
          {{ copiedSessionId === agentStore.sessionId ? 'Copied' : (agentStore.sessionId ? agentStore.sessionId.slice(-8) : 'No Session') }}
        </button>
        <span class="agent-status" :class="`is-${agentStatus.type}`">
          <span class="codicon" :class="agentStatus.icon"></span>
          {{ agentStatus.label }}
        </span>
      </div>
    </div>

    <div v-if="!collapsed && sessionHistory.length" class="agent-tabs">
      <button
        v-for="(session, index) in sessionHistory.slice(0, 6)"
        :key="session.id"
        class="agent-tabs__tab"
        :class="{ active: session.id === agentStore.sessionId }"
        @click="switchSession(session.id)"
      >
        <span class="agent-tabs__label">{{ session.title || `Session ${index + 1}` }}</span>
        <span class="agent-tabs__meta">{{ session.messageCount || 0 }}</span>
      </button>
      <button class="agent-tabs__tab agent-tabs__tab--new" @click="handleNewChat">+ New</button>
    </div>

    <div v-if="!collapsed && workflow.steps.length" class="agent-workflow">
      <div class="agent-workflow__header">
        <span class="codicon codicon-list-tree"></span>
        <strong>{{ workflow.title || 'Workflow' }}</strong>
      </div>
      <div class="agent-workflow__list">
        <div v-for="(step, index) in workflow.steps" :key="step.id || `${index}-${step.title}`" class="agent-workflow__step" :class="`is-${step.status || 'pending'}`">
          <span class="agent-workflow__dot"></span>
          <div class="agent-workflow__body">
            <strong>{{ step.title }}</strong>
            <p v-if="step.detail">{{ step.detail }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!collapsed" ref="messageListRef" class="agent-message-list">
      <div v-if="messages.length === 0" class="agent-empty">
        <span class="codicon codicon-robot agent-empty__icon"></span>
        <p>提问、规划，或触发本地工具。</p>
        <p v-if="!hasConfig" class="agent-empty__hint">先配置一个模型，然后开始对话。</p>
      </div>

      <article v-for="message in messages" :key="message.id" class="agent-msg" :class="`agent-msg--${message.role}`">
        <div class="agent-msg__header">
          <span class="codicon" :class="message.role === 'user' ? 'codicon-account' : 'codicon-robot'"></span>
          <strong>{{ message.role === 'user' ? 'You' : 'Agent' }}</strong>
          <span v-if="message.createdAt" class="agent-msg__time">{{ formatTime(message.createdAt) }}</span>
          <span v-if="message.status === 'streaming'" class="agent-msg__status agent-msg__status--streaming"><span class="agent-cursor"></span></span>
          <span v-else-if="message.status === 'error'" class="agent-msg__status agent-msg__status--error">error</span>
          <span v-else-if="message.status === 'aborted'" class="agent-msg__status agent-msg__status--aborted">stopped</span>
        </div>
        <div v-if="message.content" class="agent-msg__body" v-html="renderMarkdown(message.content)"></div>
        <div v-if="message.toolCalls && message.toolCalls.length" class="agent-msg__tools">
          <div v-for="tc in message.toolCalls" :key="tc.id" class="tool-call" :class="{ 'tool-call--expanded': tc.expanded }">
            <button class="tool-call__header" @click="toggleToolCall(message.id, tc.id)">
              <span class="codicon" :class="tc.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></span>
              <span class="codicon tool-call__icon" :class="getToolIcon(tc.name)"></span>
              <span class="tool-call__name">{{ tc.name }}</span>
              <span v-if="tc.result" class="tool-call__badge" :class="isToolSuccess(tc.result) ? 'tool-call__badge--ok' : 'tool-call__badge--err'">{{ isToolSuccess(tc.result) ? 'success' : 'failed' }}</span>
              <span v-else class="tool-call__badge tool-call__badge--pending">running</span>
            </button>
            <div v-if="tc.expanded" class="tool-call__body">
              <div class="tool-call__section">
                <span class="tool-call__label">Arguments</span>
                <pre class="tool-call__code">{{ formatToolArgs(tc.arguments) }}</pre>
              </div>
              <div v-if="tc.result" class="tool-call__section">
                <span class="tool-call__label">Result</span>
                <pre class="tool-call__code" :class="{ 'tool-call__code--err': !isToolSuccess(tc.result) }">{{ formatToolResult(tc.result) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-if="!collapsed" class="agent-composer">
      <textarea v-model="input" class="agent-composer__input" rows="4" placeholder="提问、规划，或触发本地工具..." :disabled="isStreaming" @keydown="handleKeydown"></textarea>
      <div class="agent-composer__bar">
        <span class="composer__hint">Ctrl+Enter to send</span>
        <div class="agent-composer__actions">
          <button v-if="isStreaming" class="composer__button composer__button--abort" @click="handleAbort"><span class="codicon codicon-stop"></span> Stop</button>
          <button v-else class="primary-button composer__button" :disabled="!input.trim()" @click="handleSend"><span class="codicon codicon-send"></span> Send</button>
        </div>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="showConfig" class="agent-config-overlay" @click.self="showConfig = false">
        <div class="agent-config agent-config--wide">
          <div class="agent-config__header">
            <strong>Model Config</strong>
            <button class="icon-button codicon codicon-close" @click="showConfig = false"></button>
          </div>

          <div v-if="editingModel" class="agent-config__layout">
            <div class="agent-config__sidebar">
              <div class="agent-config__sidebar-title">Models</div>
              <div class="agent-config__provider-tabs">
                <button class="agent-config__provider-tab" @click="addModel('openai')">+ OpenAI</button>
                <button class="agent-config__provider-tab" @click="addModel('anthropic')">+ Anthropic</button>
              </div>
              <div class="agent-config__model-list">
                <div v-for="m in modelsList" :key="m.id" class="agent-config__model-item" :class="{ active: editingModel.id === m.id }" @click="selectModelToEdit(m)">
                  <span class="agent-config__model-name">{{ m.displayName || m.modelId }}</span>
                  <button class="icon-button codicon codicon-trash agent-config__model-delete" @click.stop="deleteModel(m)"></button>
                </div>
              </div>
            </div>

            <div class="agent-config__body">
              <div class="agent-config__provider-tabs">
                <button class="agent-config__provider-tab" :class="{ active: editingModel.provider === 'openai' }" @click="setProvider('openai')">OpenAI</button>
                <button class="agent-config__provider-tab" :class="{ active: editingModel.provider === 'anthropic' }" @click="setProvider('anthropic')">Anthropic</button>
              </div>
              <div class="agent-config__grid">
                <label class="agent-config__field"><span class="agent-config__label">Display Name</span><input v-model="editingModel.displayName" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">Model ID</span><input v-model="editingModel.modelId" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">API Key</span><div class="agent-config__input-row"><input v-model="editingModel.apiKey" :type="showApiKeyMap[editingModel.id] ? 'text' : 'password'" class="agent-config__input" /><button class="icon-button codicon" :class="showApiKeyMap[editingModel.id] ? 'codicon-eye-closed' : 'codicon-eye'" @click="toggleShowApiKey(editingModel.id)"></button></div></label>
                <label class="agent-config__field"><span class="agent-config__label">Base URL</span><input v-model="editingModel.baseUrl" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">Context Window</span><input v-model.number="editingModel.contextWindow" type="number" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">Max Output</span><input v-model.number="editingModel.maxOutputTokens" type="number" class="agent-config__input" /></label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field"><span class="agent-config__label">Reasoning</span><select v-model="editingModel.reasoningStrength" class="agent-config__input"><option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
                <label v-else class="agent-config__field"><span class="agent-config__label">Thinking</span><select v-model="editingModel.thinkingStrength" class="agent-config__input"><option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field"><span class="agent-config__label">Endpoint</span><select v-model="editingModel.endpoint" class="agent-config__input"><option v-for="opt in endpointOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
              </div>
              <div class="agent-config__footer">
                <button class="ghost-button" @click="showConfig = false">Cancel</button>
                <button class="primary-button" :disabled="testingModel" @click="saveConfig(true)">Save & Test</button>
                <button class="primary-button" :disabled="testingModel" @click="saveConfig(false)">Save</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
