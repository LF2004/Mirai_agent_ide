<script setup>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import { useAgentStore } from '../stores/agent.js';
import { getDesktopApi } from '../services/desktop.js';
import { t, locale, LOCALES } from '../utils/i18n.js';
import ContextMenu from './ContextMenu.vue';

const props = defineProps({
  mode: { type: String, default: 'agent' },
  model: { type: String, default: '' },
  currentFile: { type: String, default: '' },
  collapsed: { type: Boolean, default: false }
});

const emit = defineEmits(['mode-change', 'model-change', 'toggle-collapse']);

const agentStore = useAgentStore();
const desktopApi = getDesktopApi();
const dialog = inject('ideDialog', { alert: fallbackAlert, confirm: fallbackConfirm });

function fallbackAlert(message, title = t('bridgeError')) {
  window.alert(`${title}\n\n${message}`);
}

function fallbackConfirm(message, title = t('apply')) {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

const input = ref('');
const pendingAttachments = ref([]);
const messageListRef = ref(null);
const previewAttachment = ref(null);
const showConfig = ref(false);
const editingModel = ref(null);
const testingModel = ref(false);
const testResult = ref(null);
const showApiKeyMap = ref({});
const copiedSessionId = ref('');
const copiedRequestId = ref('');
const historyQuery = ref('');
const showHistory = ref(false);
const hoveredTabId = ref('');
const sessionMenu = ref({ visible: false, x: 0, y: 0, sessionId: '' });

const modes = computed(() => [
  { value: 'agent', label: t('agentModeAgent') },
  { value: 'ask', label: t('agentModeAsk') },
  { value: 'plan', label: t('agentModePlan') },
  { value: 'multitask', label: t('agentModeTask') },
  { value: 'debug', label: t('agentModeDebug') }
]);

const strengthOptions = computed(() => [
  { value: 'low', label: t('agentStrengthLow') },
  { value: 'medium', label: t('agentStrengthMedium') },
  { value: 'high', label: t('agentStrengthHigh') },
  { value: 'none', label: t('agentStrengthNone') }
]);

const endpointOptions = [
  { value: '/v1/chat/completions', label: '/v1/chat/completions' },
  { value: '/v1/responses', label: '/v1/responses' }
];

const isStreaming = computed(() => agentStore.isStreaming);
const messages = computed(() => agentStore.messages);
const hasConfig = computed(() => agentStore.hasConfig);
const currentModel = computed(() => agentStore.currentModel);
const modelsList = computed(() => agentStore.config.models);
const sessionHistory = computed(() => agentStore.sessionHistory);
const currentSession = computed(() => sessionHistory.value.find((s) => s.id === agentStore.sessionId) || null);
const topSessions = computed(() => sessionHistory.value.slice(0, 5));
const localeCode = computed(() => (locale.value === LOCALES.EN ? 'en-US' : 'zh-CN'));
function getAgentTitle(sessionLike) {
  const title = sessionLike?.title?.trim?.() || '';
  if (!title || /^new\s+session$/i.test(title) || /^new\s+chat$/i.test(title) || /^new\s+agent$/i.test(title)) return t('agentNewAgent');
  return title;
}

const currentSessionTitle = computed(() => getAgentTitle(currentSession.value));
const filteredSessionHistory = computed(() => {
  const query = historyQuery.value.trim().toLowerCase();
  if (!query) return sessionHistory.value;
  return sessionHistory.value.filter((session) =>
    [session.title, session.id, session.mode]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  );
});
const latestAssistantMessage = computed(() => {
  return [...messages.value].reverse().find((message) => message.role === 'assistant') || null;
});
const currentRequestId = computed(() => agentStore.activeRequestId || latestAssistantMessage.value?.requestId || '');
function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
}

function closeFloatingPanels() {
  showHistory.value = false;
  sessionMenu.value.visible = false;
}

watch(messages, () => scrollToBottom(), { deep: true });

watch(() => props.model, async (newId) => {
  if (newId && agentStore.config.selectedModelId !== newId) {
    await agentStore.selectModel(newId);
  }
}, { immediate: true });

async function handleSend() {
  const value = input.value.trim();
  if ((!value && pendingAttachments.value.length === 0) || isStreaming.value) return;
  if (!agentStore.configLoaded) await agentStore.loadConfig();
  if (!agentStore.hasConfig) {
    openConfig();
    return;
  }
  const attachments = pendingAttachments.value.map((attachment) => ({ ...attachment }));
  input.value = '';
  pendingAttachments.value = [];
  await agentStore.send(value, attachments);
  showHistory.value = false;
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

function removePendingAttachment(attachmentId) {
  pendingAttachments.value = pendingAttachments.value.filter((attachment) => attachment.id !== attachmentId);
}

function openAttachmentPreview(attachment) {
  if (!attachment?.dataUrl) return;
  previewAttachment.value = attachment;
}

function closeAttachmentPreview() {
  previewAttachment.value = null;
}

function createAttachmentId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePendingAttachment(attachment = {}) {
  return {
    id: attachment.id || createAttachmentId(),
    name: attachment.name || 'attachment',
    path: attachment.path || '',
    kind: attachment.kind || 'file',
    mime: attachment.mime || '',
    size: Number(attachment.size) || 0,
    textContent: attachment.textContent || '',
    dataUrl: attachment.dataUrl || '',
    createdAt: attachment.createdAt || new Date().toISOString()
  };
}

function upsertPendingAttachments(attachments = []) {
  const next = attachments.map(normalizePendingAttachment);
  const seen = new Set(pendingAttachments.value.map((attachment) => attachment.path || attachment.name));
  for (const attachment of next) {
    const key = attachment.path || attachment.name;
    if (!seen.has(key)) {
      pendingAttachments.value.push(attachment);
      seen.add(key);
    }
  }
}

async function handleAttachmentPick() {
  const filePaths = await desktopApi.agentPickAttachments?.();
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;
  const attachments = [];
  for (const filePath of filePaths) {
    const result = await desktopApi.agentReadAttachment?.(filePath);
    if (result?.ok) attachments.push(result);
  }
  upsertPendingAttachments(attachments);
}

async function handlePaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
  if (!imageItems.length) return;
  event.preventDefault();
  const attachments = await Promise.all(imageItems.map((item, index) => new Promise((resolve) => {
    const file = item.getAsFile();
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      id: createAttachmentId(),
      name: file.name || `pasted-image-${Date.now()}-${index + 1}.png`,
      kind: 'image',
      mime: file.type || 'image/png',
      size: file.size || 0,
      dataUrl: typeof reader.result === 'string' ? reader.result : '',
      createdAt: new Date().toISOString()
    });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  })));
  upsertPendingAttachments(attachments.filter(Boolean));
}

async function handleNewChat() {
  showHistory.value = false;
  await agentStore.newSession(agentStore.mode);
}

async function switchSession(sessionId) {
  await agentStore.switchSession(sessionId);
  closeFloatingPanels();
  scrollToBottom();
}

async function handleModelSelect(event) {
  const modelId = event.target.value;
  await agentStore.selectModel(modelId);
  emit('model-change', modelId);
}

async function copyText(value, kind) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    if (kind === 'session') {
      copiedSessionId.value = value;
      setTimeout(() => {
        if (copiedSessionId.value === value) copiedSessionId.value = '';
      }, 1500);
    } else {
      copiedRequestId.value = value;
      setTimeout(() => {
        if (copiedRequestId.value === value) copiedRequestId.value = '';
      }, 1500);
    }
  } catch {
    await dialog.alert(value, kind === 'session' ? t('agentSessionId') : t('agentRequestId'));
  }
}

async function deleteSession(session) {
  const ok = await dialog.confirm(t('agentCloseConfirm').replace('{title}', getAgentTitle(session)), t('agentCloseTitle'));
  if (!ok) return;
  const deletingCurrent = agentStore.sessionId === session.id;
  await agentStore.deleteSessionFromHistory(session.id);
  if (deletingCurrent) {
    const fallback = agentStore.sessionHistory[0];
    if (fallback?.id) {
      await switchSession(fallback.id);
    } else {
      await handleNewChat();
    }
  }
}

async function renameSession(session) {
  if (!session?.id) return;
  const nextTitle = window.prompt(t('agentRenameTitle'), getAgentTitle(session));
  if (!nextTitle || !nextTitle.trim()) return;
  await agentStore.renameSession(session.id, nextTitle.trim());
}

async function exportSession(session = currentSession.value) {
  if (!session?.id) return;
  if (!agentStore.diagnostics.length) {
    await agentStore.refreshDiagnostics();
  }
  const payload = agentStore.buildSessionExport(session.id);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(session.title || t('agentSessionFile')).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
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
  if (editingModel.value) {
    await agentStore.updateModel(editingModel.value.id, normalizeModelForm(editingModel.value));
  }
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
  const ok = await dialog.confirm(t('agentDeleteModelConfirm').replace('{title}', model.displayName), t('agentDeleteModelTitle'));
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
  if (result.success) {
    return typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
  }
  return `Error: ${result.error}`;
}

function isToolSuccess(result) {
  return result?.success === true;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(localeCode.value, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(localeCode.value, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function sessionSubtitle(session) {
  const updated = formatDate(session.updatedAt || session.createdAt);
  return `${resolveModeLabel(session.mode || 'agent')} · ${session.messageCount || 0} ${t('agentMessagesShort')}${updated ? ` · ${updated}` : ''}`;
}

function openSessionMenu(event, session) {
  event.preventDefault();
  sessionMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    sessionId: session.id
  };
}

const sessionMenuItems = computed(() => {
  const session = sessionHistory.value.find((item) => item.id === sessionMenu.value.sessionId);
  if (!session) return [];
  return [
    { id: 'rename', label: t('agentRenameAction') },
    { id: 'export', label: t('agentExportAction') },
    { separator: true },
    { id: 'copy', label: t('agentCopyIdAction') },
    { id: 'delete', label: t('agentCloseAction'), danger: true }
  ];
});

function resolveModeLabel(mode) {
  return modes.value.find((item) => item.value === mode)?.label || t('agentModeAgent');
}

async function handleSessionMenuSelect(item) {
  const session = sessionHistory.value.find((entry) => entry.id === sessionMenu.value.sessionId);
  if (!session) return;
  if (item.id === 'rename') {
    await renameSession(session);
  } else if (item.id === 'export') {
    await exportSession(session);
  } else if (item.id === 'copy') {
    await copyText(session.id, 'session');
  } else if (item.id === 'delete') {
    await deleteSession(session);
  }
  sessionMenu.value.visible = false;
}

function openCurrentSessionMenu(event) {
  if (!currentSession.value) return;
  openSessionMenu(event, currentSession.value);
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
  document.addEventListener('click', closeFloatingPanels);
  document.addEventListener('contextmenu', closeFloatingPanels);
});

onBeforeUnmount(() => {
  sessionMenu.value.visible = false;
  document.removeEventListener('click', closeFloatingPanels);
  document.removeEventListener('contextmenu', closeFloatingPanels);
});
</script>

<template>
  <div class="panel agent-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="agent-header">
      <div class="agent-header__leading">
        <button class="agent-header__current" type="button" @click="showHistory = !showHistory">
          <span class="agent-header__current-title">{{ currentSessionTitle }}</span>
          <span class="codicon codicon-chevron-down"></span>
        </button>
      </div>
      <div class="agent-header__actions">
        <button class="icon-button codicon codicon-add" :title="t('agentNewAgent')" @click="handleNewChat"></button>
        <button class="icon-button codicon codicon-history" :title="t('history')" @click.stop="showHistory = !showHistory"></button>
        <button class="icon-button codicon codicon-ellipsis" :title="t('agentActions')" @click.stop="openCurrentSessionMenu($event)"></button>
        <button class="icon-button codicon" :class="collapsed ? 'codicon-chevron-left' : 'codicon-chevron-right'" :title="collapsed ? t('showAgentPanel') : t('collapseAgentPanel')" type="button" @click="$emit('toggle-collapse')"></button>
      </div>
    </div>

    <div v-if="!collapsed && topSessions.length" class="agent-session-tabs">
      <div
        v-for="session in topSessions"
        :key="session.id"
        class="agent-session-tab"
        :class="{ active: session.id === agentStore.sessionId }"
        @mouseenter="hoveredTabId = session.id"
        @mouseleave="hoveredTabId = ''"
        @contextmenu="openSessionMenu($event, session)"
      >
        <button
          class="agent-session-tab__main"
          @click="switchSession(session.id)"
        >
          <span class="agent-session-tab__title">{{ getAgentTitle(session) }}</span>
          <span class="agent-session-tab__meta">{{ session.messageCount || 0 }}</span>
        </button>
        <button
          v-if="hoveredTabId === session.id"
          class="agent-session-tab__close codicon codicon-close"
          :title="t('agentCloseAction')"
          @click.stop="deleteSession(session)"
        ></button>
      </div>
    </div>

    <div v-if="!collapsed && showHistory" class="agent-history-popover">
      <div class="agent-history__search">
        <span class="codicon codicon-search"></span>
        <input v-model="historyQuery" type="text" :placeholder="t('agentSearchPlaceholder')" />
      </div>
      <div class="agent-history__section-label">{{ t('agentToday') }}</div>
      <div class="agent-history__list">
        <div v-if="!filteredSessionHistory.length" class="agent-history__empty">{{ t('agentNoMatchingAgents') }}</div>
        <article
          v-for="session in filteredSessionHistory"
          :key="session.id"
          class="agent-history-item"
          :class="{ active: session.id === agentStore.sessionId }"
          @contextmenu="openSessionMenu($event, session)"
        >
          <button class="agent-history-item__main" @click="switchSession(session.id)">
            <span class="agent-history-item__status codicon" :class="session.id === agentStore.sessionId ? 'codicon-check' : 'codicon-circle-large-outline'"></span>
            <span class="agent-history-item__copy">
              <strong>{{ getAgentTitle(session) }}</strong>
              <small>{{ sessionSubtitle(session) }}</small>
            </span>
          </button>
          <div class="agent-history-item__actions">
            <button class="icon-button codicon codicon-ellipsis" :title="t('more')" @click.stop="openSessionMenu($event, session)"></button>
          </div>
        </article>
      </div>
    </div>

    <div v-if="!collapsed" ref="messageListRef" class="agent-message-list">
      <div v-if="messages.length === 0" class="agent-empty">
        <span class="codicon codicon-sparkle agent-empty__icon"></span>
        <p>{{ t('agentComposerPlaceholder') }}</p>
        <p v-if="!hasConfig" class="agent-empty__hint">{{ t('agentConfigHint') }}</p>
      </div>

      <article v-for="message in messages" :key="message.id" class="agent-msg" :class="`agent-msg--${message.role}`">
        <div class="agent-msg__content">
          <div class="agent-msg__header">
            <div class="agent-msg__identity">
              <strong>{{ message.role === 'user' ? t('agentYou') : t('agentAssistantName') }}</strong>
              <span v-if="message.createdAt" class="agent-msg__time">{{ formatTime(message.createdAt) }}</span>
              <span v-if="message.requestId" class="agent-msg__request-chip" @click="copyText(message.requestId, 'request')">
                {{ copiedRequestId === message.requestId ? t('agentCopied') : message.requestId.slice(0, 8) }}
              </span>
            </div>
            <div class="agent-msg__state">
              <span v-if="message.toolCalls?.length" class="agent-msg__metric">
                <span class="codicon codicon-tools"></span>
                {{ message.toolCalls.length }}
              </span>
              <span v-if="message.status === 'streaming'" class="agent-msg__status agent-msg__status--streaming"><span class="agent-cursor"></span></span>
              <span v-else-if="message.status === 'error'" class="agent-msg__status agent-msg__status--error">{{ t('agentStatusError') }}</span>
              <span v-else-if="message.status === 'aborted'" class="agent-msg__status agent-msg__status--aborted">{{ t('agentStatusStopped') }}</span>
            </div>
          </div>
          <div v-if="message.content" class="agent-msg__body" v-html="renderMarkdown(message.content)"></div>
          <div v-if="message.attachments?.length" class="agent-msg__attachments">
            <button
              v-for="attachment in message.attachments"
              :key="attachment.id"
              class="agent-attachment-pill"
              :class="{ 'agent-attachment-pill--image': attachment.kind === 'image' }"
              type="button"
              @click="attachment.kind === 'image' ? openAttachmentPreview(attachment) : null"
            >
              <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" class="agent-attachment-pill__thumb" />
              <span v-else class="codicon codicon-attach"></span>
              <span class="agent-attachment-pill__name">{{ attachment.name }}</span>
            </button>
          </div>
          <div v-if="message.toolCalls && message.toolCalls.length" class="agent-msg__tools">
            <div v-for="tc in message.toolCalls" :key="tc.id" class="tool-call" :class="{ 'tool-call--expanded': tc.expanded }">
              <button class="tool-call__header" @click="toggleToolCall(message.id, tc.id)">
                <span class="codicon" :class="tc.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></span>
                <span class="codicon tool-call__icon" :class="getToolIcon(tc.name)"></span>
                <span class="tool-call__name">{{ tc.name }}</span>
                <span class="tool-call__summary">{{ tc.result ? (isToolSuccess(tc.result) ? t('agentToolCompleted') : t('agentToolFailed')) : t('agentToolRunning') }}</span>
                <span v-if="tc.result" class="tool-call__badge" :class="isToolSuccess(tc.result) ? 'tool-call__badge--ok' : 'tool-call__badge--err'">{{ isToolSuccess(tc.result) ? t('agentToolDone') : t('agentStatusError') }}</span>
                <span v-else class="tool-call__badge tool-call__badge--pending">{{ t('agentToolLive') }}</span>
              </button>
              <div v-if="tc.expanded" class="tool-call__body">
                <div class="tool-call__section">
                  <span class="tool-call__label">{{ t('agentToolArguments') }}</span>
                  <pre class="tool-call__code">{{ formatToolArgs(tc.arguments) }}</pre>
                </div>
                <div v-if="tc.result" class="tool-call__section">
                  <span class="tool-call__label">{{ t('agentToolResult') }}</span>
                  <pre class="tool-call__code" :class="{ 'tool-call__code--err': !isToolSuccess(tc.result) }">{{ formatToolResult(tc.result) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-if="!collapsed" class="agent-composer composer-input-blur-wrapper">
      <div class="ai-input-full-input-box full-input-box">
        <div class="agent-composer__input-shell">
          <div class="agent-composer__inline-title">{{ currentSessionTitle }}</div>
          <div v-if="pendingAttachments.length" class="agent-composer__attachments">
            <div
              v-for="attachment in pendingAttachments"
              :key="attachment.id"
              class="agent-attachment-pill agent-attachment-pill--pending"
              :class="{ 'agent-attachment-pill--image': attachment.kind === 'image' }"
              @click="attachment.kind === 'image' ? openAttachmentPreview(attachment) : null"
            >
              <img v-if="attachment.kind === 'image' && attachment.dataUrl" :src="attachment.dataUrl" :alt="attachment.name" class="agent-attachment-pill__thumb" />
              <span v-else class="codicon codicon-attach"></span>
              <span class="agent-attachment-pill__name">{{ attachment.name }}</span>
              <span class="agent-attachment-pill__grow"></span>
              <span class="agent-attachment-pill__preview codicon" :class="attachment.kind === 'image' ? 'codicon-eye' : 'codicon-file'"></span>
              <button class="agent-attachment-pill__remove codicon codicon-close" type="button" :title="t('agentRemoveAttachment')" @click.stop="removePendingAttachment(attachment.id)"></button>
            </div>
          </div>
          <textarea v-model="input" class="agent-composer__input" rows="3" :placeholder="t('agentComposerPlaceholder')" :disabled="isStreaming" @keydown="handleKeydown" @paste="handlePaste"></textarea>
        </div>
        <div class="ai-input-full-input-box-bottom-container">
          <div class="agent-composer__controls">
            <select :value="mode" class="agent-chip agent-chip--composer" @change="$emit('mode-change', $event.target.value)">
              <option v-for="m in modes" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <select :value="currentModel?.id" class="agent-chip agent-chip--composer agent-chip--model" @change="handleModelSelect">
              <option v-for="m in modelsList" :key="m.id" :value="m.id">{{ m.displayName || m.modelId }}</option>
            </select>
          </div>
          <div class="agent-composer__actions">
            <button class="icon-button codicon codicon-attach" :title="t('attach')" type="button" @click="handleAttachmentPick"></button>
            <button class="icon-button codicon codicon-mic" :title="t('agentVoice')" type="button"></button>
            <button v-if="isStreaming" class="composer__icon-button codicon codicon-debug-stop" :title="t('agentStop')" @click="handleAbort"></button>
            <button v-else class="composer__icon-button composer__icon-button--send codicon codicon-arrow-up" :disabled="!input.trim() && !pendingAttachments.length" :title="t('send')" @click="handleSend"></button>
          </div>
        </div>
        <div class="agent-composer__meta">
          <span class="composer__hint">{{ t('agentSendHint') }}</span>
        </div>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="showConfig" class="agent-config-overlay" @click.self="showConfig = false">
        <div class="agent-config agent-config--wide">
          <div class="agent-config__header">
            <strong>{{ t('agentModelConfig') }}</strong>
            <button class="icon-button codicon codicon-close" @click="showConfig = false"></button>
          </div>

          <div v-if="editingModel" class="agent-config__layout">
            <div class="agent-config__sidebar">
              <div class="agent-config__sidebar-title">{{ t('agentModels') }}</div>
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
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentDisplayName') }}</span><input v-model="editingModel.displayName" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentModelId') }}</span><input v-model="editingModel.modelId" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentApiKey') }}</span><div class="agent-config__input-row"><input v-model="editingModel.apiKey" :type="showApiKeyMap[editingModel.id] ? 'text' : 'password'" class="agent-config__input" /><button class="icon-button codicon" :class="showApiKeyMap[editingModel.id] ? 'codicon-eye-closed' : 'codicon-eye'" @click="toggleShowApiKey(editingModel.id)"></button></div></label>
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentBaseUrl') }}</span><input v-model="editingModel.baseUrl" type="text" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentContextWindow') }}</span><input v-model.number="editingModel.contextWindow" type="number" class="agent-config__input" /></label>
                <label class="agent-config__field"><span class="agent-config__label">{{ t('agentMaxOutput') }}</span><input v-model.number="editingModel.maxOutputTokens" type="number" class="agent-config__input" /></label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field"><span class="agent-config__label">{{ t('agentReasoning') }}</span><select v-model="editingModel.reasoningStrength" class="agent-config__input"><option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
                <label v-else class="agent-config__field"><span class="agent-config__label">{{ t('agentThinking') }}</span><select v-model="editingModel.thinkingStrength" class="agent-config__input"><option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field"><span class="agent-config__label">{{ t('agentEndpoint') }}</span><select v-model="editingModel.endpoint" class="agent-config__input"><option v-for="opt in endpointOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
              </div>
              <div v-if="testResult" class="agent-config__test">
                <div class="agent-config__test-title">{{ t('agentConnectionTest') }}</div>
                <div class="agent-config__test-status" :class="testResult.ok ? 'agent-config__test-status--ok' : 'agent-config__test-status--err'">
                  {{ testResult.ok ? (testResult.response || t('agentConnected')) : (testResult.error || t('agentFailed')) }}
                </div>
              </div>
              <div class="agent-config__footer">
                <button class="ghost-button" @click="showConfig = false">{{ t('cancel') }}</button>
                <button class="primary-button" :disabled="testingModel" @click="saveConfig(true)">{{ t('agentSaveAndTest') }}</button>
                <button class="primary-button" :disabled="testingModel" @click="saveConfig(false)">{{ t('agentSave') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <ContextMenu
      v-if="sessionMenu.visible"
      :items="sessionMenuItems"
      :x="sessionMenu.x"
      :y="sessionMenu.y"
      @close="sessionMenu.visible = false"
      @select="handleSessionMenuSelect"
    />

    <Transition name="fade">
      <div v-if="previewAttachment" class="agent-preview" @click="closeAttachmentPreview">
        <div class="agent-preview__dialog" @click.stop>
          <div class="agent-preview__header">
            <strong>{{ previewAttachment.name }}</strong>
            <button class="icon-button codicon codicon-close" type="button" :title="t('closePanel')" @click="closeAttachmentPreview"></button>
          </div>
          <img :src="previewAttachment.dataUrl" :alt="previewAttachment.name" class="agent-preview__image" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.agent-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #181a20;
  color: #d7dce5;
  overflow: hidden;
}

.agent-header {
  min-height: 35px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid #262932;
  background: #1b1d23;
}

.agent-header__leading {
  min-width: 0;
  flex: 1;
}

.agent-header__current {
  min-width: 0;
  max-width: 100%;
  height: 24px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #edf0f7;
}

.agent-header__current:hover {
  background: #242730;
}

.agent-header__current-title {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.agent-header__actions .icon-button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8d97ac;
  font-size: 13px;
}

.agent-header__actions .icon-button:hover {
  background: #2a2d37;
  color: #eef2f8;
}

.agent-session-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px 8px 0;
  min-height: 33px;
  background: #1b1d23;
  border-bottom: 1px solid #262932;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.agent-session-tab {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 176px;
  flex: 0 0 auto;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  background: transparent;
}

.agent-session-tab.active {
  background: #20232b;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.agent-session-tab__main {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 22px 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: #c0c6d4;
}

.agent-session-tab__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
}

.agent-session-tab__meta {
  display: none;
}

.agent-session-tab__close {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #9099ad;
  font-size: 11px;
}

.agent-session-tab__close:hover {
  background: #323642;
  color: #fff;
}

.agent-history-popover {
  position: absolute;
  top: 38px;
  left: 8px;
  width: 320px;
  max-width: calc(100% - 16px);
  z-index: 50;
  border: 1px solid #323642;
  border-radius: 8px;
  background: #1f222a;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.42);
}

.agent-history__search {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: 8px;
  padding: 0 10px;
  min-height: 30px;
  border: 1px solid #343845;
  border-radius: 6px;
  color: #7f8aa3;
  background: #171920;
}

.agent-history__search input {
  border: 0;
  outline: none;
  background: transparent;
  color: #d7dce5;
  font-size: 12px;
}

.agent-history__section-label {
  padding: 2px 10px 6px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7f8aa3;
}

.agent-history__list {
  max-height: 280px;
  overflow: auto;
  padding: 0 6px 8px;
}

.agent-history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 2px 6px;
  border-radius: 6px;
}

.agent-history-item:hover,
.agent-history-item.active {
  background: #2b2f39;
}

.agent-history-item__main {
  min-width: 0;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
}

.agent-history-item__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-history-item__main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #dfe5ef;
}

.agent-history-item__main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: #8a94aa;
}

.agent-history-item__status {
  font-size: 12px;
  color: #8b96ad;
}

.agent-history-item__actions .icon-button {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8b96ad;
}

.agent-history-item__actions .icon-button:hover {
  background: #343847;
  color: #eef2f8;
}

.agent-message-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 0;
}

.agent-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #8a94aa;
  text-align: center;
}

.agent-empty__icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #22252d;
  color: #aeb7ca;
  font-size: 17px;
}

.agent-empty p {
  margin: 0;
  font-size: 12px;
}

.agent-empty__hint {
  font-size: 11px;
}

.agent-msg {
  display: flex;
  margin-bottom: 10px;
}

.agent-msg__content {
  min-width: 0;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #282c35;
  border-radius: 10px;
  background: #1f222a;
}

.agent-msg--user .agent-msg__content {
  background: #20242d;
  border-color: #303542;
}

.agent-msg__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.agent-msg__identity,
.agent-msg__state {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.agent-msg__identity strong {
  font-size: 12px;
  color: #edf2f8;
}

.agent-msg__time,
.agent-msg__request-chip,
.agent-msg__metric {
  font-size: 10px;
  color: #8692aa;
}

.agent-msg__request-chip {
  padding: 2px 6px;
  border: 1px solid #313643;
  border-radius: 999px;
  background: #1a1d24;
  cursor: pointer;
}

.agent-msg__request-chip:hover {
  border-color: #454b5a;
  color: #dfe5ef;
}

.agent-msg__body {
  font-size: 12.5px;
  line-height: 1.6;
  color: #dbe2ee;
  word-break: break-word;
}

.agent-msg__attachments,
.agent-composer__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.agent-msg__attachments {
  margin-top: 8px;
}

.agent-attachment-pill {
  max-width: 100%;
  min-height: 28px;
  padding: 0 8px 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #343a47;
  border-radius: 999px;
  background: #242933;
  color: #d8deea;
  font-size: 11px;
  cursor: default;
}

.agent-attachment-pill--pending {
  background: #2a2f3a;
  cursor: pointer;
}

.agent-attachment-pill--image {
  padding-left: 4px;
}

.agent-attachment-pill__thumb {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: cover;
  flex: 0 0 auto;
}

.agent-attachment-pill__name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-attachment-pill__grow {
  flex: 1;
}

.agent-attachment-pill__preview {
  color: #8e99af;
  font-size: 12px;
}

.agent-attachment-pill__remove {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #9da7bc;
  font-size: 10px;
}

.agent-attachment-pill__remove:hover {
  background: #3a4150;
  color: #fff;
}

.agent-msg__tools {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.tool-call {
  border: 1px solid #2f3440;
  border-radius: 8px;
  background: #181b22;
  overflow: hidden;
}

.tool-call__header {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: #d8deea;
  text-align: left;
}

.tool-call__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
}

.tool-call__summary,
.tool-call__badge {
  font-size: 10px;
  color: #8591aa;
}

.tool-call__badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: #232834;
}

.tool-call__badge--ok {
  color: #bdddc0;
  background: rgba(69, 122, 78, 0.24);
}

.tool-call__badge--err {
  color: #ffb5b5;
  background: rgba(155, 57, 57, 0.22);
}

.tool-call__badge--pending {
  color: #b9c7ea;
  background: rgba(70, 95, 155, 0.22);
}

.tool-call__body {
  padding: 10px;
  border-top: 1px solid #292e39;
}

.tool-call__section + .tool-call__section {
  margin-top: 8px;
}

.tool-call__label {
  display: block;
  margin-bottom: 4px;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7f8aa3;
}

.tool-call__code {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: #10131a;
  color: #ced6e4;
  font-size: 11px;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid #252b36;
}

.tool-call__code--err {
  color: #ffc3c3;
}

.agent-composer {
  margin: 0;
  padding: 12px 14px 14px;
  border: 0;
  background: linear-gradient(180deg, rgba(24, 26, 32, 0) 0%, #181a20 16%);
}

.composer-input-blur-wrapper {
  filter: none;
}

.ai-input-full-input-box.full-input-box {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 1px solid #343845;
  border-radius: 14px;
  background: #21252d;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.agent-composer__input-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 0;
}

.agent-composer__inline-title {
  font-size: 14px;
  font-weight: 600;
  color: #f1f5fb;
}

.agent-composer__input {
  width: 100%;
  min-height: 82px;
  max-height: 220px;
  padding: 2px 0 10px;
  border: 0;
  resize: none;
  outline: none;
  background: transparent;
  color: #d7dce5;
  font-size: 13px;
  line-height: 1.45;
}

.agent-composer__input::placeholder {
  color: #818aa0;
}

.ai-input-full-input-box-bottom-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 0 10px 0 8px;
  border-top: 1px solid #313642;
  background: #21252d;
}

.agent-composer__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.agent-chip {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #373c49;
  border-radius: 999px;
  background: #2b303a;
  color: #cfd6e3;
  font-size: 12px;
  outline: none;
  appearance: none;
}

.agent-chip--model {
  min-width: 122px;
  max-width: 168px;
}

.agent-composer__meta {
  display: flex;
  justify-content: flex-end;
  padding: 0 10px 8px;
  background: #21252d;
}

.composer__hint {
  font-size: 11px;
  color: #8692aa;
}

.agent-composer__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.composer__icon-button,
.agent-composer__actions .icon-button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #8994aa;
  font-size: 15px;
}

.agent-composer__actions .icon-button:hover,
.composer__icon-button:hover {
  background: #2f3440;
  color: #dfe6f4;
}

.composer__icon-button--send {
  background: #5f6780;
  color: #fff;
}

.composer__icon-button--send:hover {
  background: #7580a0;
}

.composer__icon-button:disabled {
  opacity: 0.45;
}

.agent-preview {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(10, 12, 16, 0.8);
  backdrop-filter: blur(4px);
}

.agent-preview__dialog {
  width: min(720px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid #373d4b;
  border-radius: 14px;
  background: #1d2129;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.agent-preview__header {
  min-height: 40px;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #313642;
  color: #eef2f8;
}

.agent-preview__header .icon-button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #95a0b8;
}

.agent-preview__header .icon-button:hover {
  background: #2f3440;
  color: #fff;
}

.agent-preview__image {
  width: 100%;
  max-height: calc(100vh - 140px);
  object-fit: contain;
  background: #14171d;
}

.md-inline-code {
  padding: 1px 4px;
  border-radius: 4px;
  background: #0f1319;
  font-size: 12px;
}

.md-code-block {
  margin: 6px 0;
  padding: 10px;
  border-radius: 8px;
  background: #10151d;
  overflow: auto;
  border: 1px solid #252b35;
}

@media (max-width: 720px) {
  .agent-history-popover {
    width: calc(100% - 16px);
  }

  .agent-message-list {
    padding: 10px 10px 0;
  }

  .agent-composer {
    padding: 10px;
  }

  .agent-composer__input {
    min-height: 74px;
  }
}
</style>
