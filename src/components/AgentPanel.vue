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
    default: ''
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
const editingModel = ref(null);
const testingModel = ref(false);
const testResult = ref(null);
const showApiKeyMap = ref({});

const modes = [
  { value: 'agent', label: 'Agent', icon: 'codicon-robot' },
  { value: 'ask', label: 'Ask', icon: 'codicon-question' },
  { value: 'plan', label: 'Plan', icon: 'codicon-list-tree' },
  { value: 'debug', label: 'Debug', icon: 'codicon-bug' }
];

const strengthOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'none', label: '无' }
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

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
}

watch(messages, () => scrollToBottom(), { deep: true });

watch(() => props.model, (newId) => {
  if (newId && agentStore.config.selectedModelId !== newId) {
    agentStore.selectModel(newId);
  }
}, { immediate: true });

async function handleSend() {
  const value = input.value.trim();
  if (!value || isStreaming.value) return;

  if (!agentStore.configLoaded) {
    await agentStore.loadConfig();
  }

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
  await agentStore.clearChat();
}

function handleModelSelect(event) {
  const modelId = event.target.value;
  agentStore.selectModel(modelId);
  emit('model-change', modelId);
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
  if (!m.extraParamsEnabled) {
    m.extraParams = '';
  }
  if (!m.customHeadersEnabled) {
    m.customHeaders = '';
  }
  return m;
}

async function openConfig() {
  if (!agentStore.configLoaded) {
    await agentStore.loadConfig();
  }
  const model = agentStore.currentModel;
  editingModel.value = model ? cloneModel(model) : createEmptyModel('openai');
  showConfig.value = true;
  testResult.value = null;
}

function selectModelToEdit(model) {
  // Save current edits before switching
  if (editingModel.value) {
    agentStore.updateModel(editingModel.value.id, normalizeModelForm(editingModel.value));
  }
  agentStore.selectModel(model.id);
  editingModel.value = cloneModel(model);
  testResult.value = null;
}

function addModel(provider) {
  const model = agentStore.addModel(provider);
  editingModel.value = cloneModel(model);
  testResult.value = null;
}

function deleteModel(model) {
  if (!confirm(`确定要删除模型 "${model.displayName}" 吗？`)) return;
  agentStore.deleteModel(model.id);
  editingModel.value = agentStore.currentModel ? cloneModel(agentStore.currentModel) : null;
  if (agentStore.currentModel) {
    emit('model-change', agentStore.currentModel.id);
  }
}

function setProvider(provider) {
  if (!editingModel.value) return;
  const id = editingModel.value.id;
  const displayName = editingModel.value.displayName;
  const base = createEmptyModel(provider);
  base.id = id;
  base.displayName = displayName;
  editingModel.value = base;
}

async function saveConfig(testAfterSave = false) {
  if (!editingModel.value) return;
  const model = normalizeModelForm(editingModel.value);
  agentStore.updateModel(model.id, model);
  agentStore.selectModel(model.id);
  await agentStore.saveConfig(agentStore.config);
  emit('model-change', model.id);

  if (testAfterSave) {
    await runTest(model);
  } else {
    showConfig.value = false;
  }
}

async function runTest(model) {
  testingModel.value = true;
  testResult.value = null;
  const result = await agentStore.testModel(model);
  testResult.value = result;
  testingModel.value = false;
}

function toggleShowApiKey(modelId) {
  showApiKeyMap.value[modelId] = !showApiKeyMap.value[modelId];
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
      <select :value="currentModel?.id" class="composer-model" @change="handleModelSelect">
        <option v-for="m in modelsList" :key="m.id" :value="m.id">{{ m.displayName || m.modelId }}</option>
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

        <!-- Message content -->
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

    <!-- Model Config Dialog -->
    <Transition name="fade">
      <div v-if="showConfig" class="agent-config-overlay" @click.self="showConfig = false">
        <div class="agent-config agent-config--wide">
          <div class="agent-config__header">
            <strong>模型编辑</strong>
            <button class="icon-button codicon codicon-close" @click="showConfig = false"></button>
          </div>

          <div v-if="editingModel" class="agent-config__layout">
            <!-- Left: model list -->
            <div class="agent-config__sidebar">
              <div class="agent-config__sidebar-title">新增模型配置</div>
              <div class="agent-config__provider-tabs">
                <button class="agent-config__provider-tab" :class="{ active: false }" @click="addModel('openai')">
                  <span class="codicon codicon-globe"></span> OpenAI
                </button>
                <button class="agent-config__provider-tab" :class="{ active: false }" @click="addModel('anthropic')">
                  <span class="codicon codicon-sparkle"></span> Anthropic
                </button>
              </div>
              <div class="agent-config__model-list">
                <div
                  v-for="m in modelsList"
                  :key="m.id"
                  class="agent-config__model-item"
                  :class="{ active: editingModel.id === m.id }"
                  @click="selectModelToEdit(m)"
                >
                  <span class="codicon" :class="m.provider === 'anthropic' ? 'codicon-sparkle' : 'codicon-globe'"></span>
                  <span class="agent-config__model-name">{{ m.displayName || m.modelId }}</span>
                  <button
                    class="icon-button codicon codicon-trash agent-config__model-delete"
                    @click.stop="deleteModel(m)"
                  ></button>
                </div>
              </div>
            </div>

            <!-- Right: form -->
            <div class="agent-config__body">
              <!-- Provider tabs -->
              <div class="agent-config__provider-tabs">
                <button
                  class="agent-config__provider-tab"
                  :class="{ active: editingModel.provider === 'openai' }"
                  @click="setProvider('openai')"
                >
                  <span class="codicon codicon-globe"></span> OpenAI
                </button>
                <button
                  class="agent-config__provider-tab"
                  :class="{ active: editingModel.provider === 'anthropic' }"
                  @click="setProvider('anthropic')"
                >
                  <span class="codicon codicon-sparkle"></span> Anthropic
                </button>
              </div>

              <div class="agent-config__grid">
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 显示名称
                  </span>
                  <input v-model="editingModel.displayName" type="text" placeholder="例如：OpenAI - GPT-4.1" class="agent-config__input" />
                </label>
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 模型标识
                  </span>
                  <input v-model="editingModel.modelId" type="text" placeholder="例如：gpt-4.1" class="agent-config__input" />
                </label>
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 访问密钥
                  </span>
                  <div class="agent-config__input-row">
                    <input
                      v-model="editingModel.apiKey"
                      :type="showApiKeyMap[editingModel.id] ? 'text' : 'password'"
                      placeholder="例如：sk-xxxxxx"
                      class="agent-config__input"
                    />
                    <button class="icon-button codicon" :class="showApiKeyMap[editingModel.id] ? 'codicon-eye-closed' : 'codicon-eye'" @click="toggleShowApiKey(editingModel.id)"></button>
                  </div>
                </label>
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 接口地址
                  </span>
                  <input v-model="editingModel.baseUrl" type="text" :placeholder="editingModel.provider === 'anthropic' ? '例如：https://api.anthropic.com' : '例如：https://api.openai.com/v1'" class="agent-config__input" />
                </label>
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 上下文窗口
                  </span>
                  <input v-model.number="editingModel.contextWindow" type="number" placeholder="例如：200000（留空用默认值）" class="agent-config__input" />
                </label>
                <label class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 最大输出 Token
                  </span>
                  <input v-model.number="editingModel.maxOutputTokens" type="number" placeholder="例如：65536（留空用默认值）" class="agent-config__input" />
                </label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-lightbulb"></span> 推理强度
                  </span>
                  <select v-model="editingModel.reasoningStrength" class="agent-config__input">
                    <option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                </label>
                <label v-else class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-lightbulb"></span> 思考强度
                  </span>
                  <select v-model="editingModel.thinkingStrength" class="agent-config__input">
                    <option v-for="opt in strengthOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                </label>
                <label v-if="editingModel.provider === 'openai'" class="agent-config__field">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 接口端点
                  </span>
                  <select v-model="editingModel.endpoint" class="agent-config__input">
                    <option v-for="opt in endpointOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                </label>
              </div>

              <div class="agent-config__advanced">
                <label class="agent-config__field agent-config__field--toggle">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span>
                    {{ editingModel.provider === 'anthropic' ? 'Anthropic 额外参数 JSON' : '额外参数 JSON' }}
                  </span>
                  <input v-model="editingModel.extraParamsEnabled" type="checkbox" />
                </label>
                <textarea
                  v-model="editingModel.extraParams"
                  :disabled="!editingModel.extraParamsEnabled"
                  rows="3"
                  placeholder='例如：{ "top_p": 0.9 }'
                  class="agent-config__input agent-config__textarea"
                ></textarea>
              </div>

              <div class="agent-config__advanced">
                <label class="agent-config__field agent-config__field--toggle">
                  <span class="agent-config__label">
                    <span class="codicon codicon-info"></span> 自定义请求头 JSON
                  </span>
                  <input v-model="editingModel.customHeadersEnabled" type="checkbox" />
                </label>
                <textarea
                  v-model="editingModel.customHeaders"
                  :disabled="!editingModel.customHeadersEnabled"
                  rows="3"
                  placeholder='例如：{ "X-Custom-Header": "value" }'
                  class="agent-config__input agent-config__textarea"
                ></textarea>
              </div>

              <label class="agent-config__field">
                <span class="agent-config__label">
                  <span class="codicon codicon-info"></span> 备注
                </span>
                <textarea v-model="editingModel.notes" rows="3" placeholder="备注" class="agent-config__input agent-config__textarea"></textarea>
              </label>

              <!-- Model test -->
              <div class="agent-config__test">
                <div class="agent-config__test-title">模型测试</div>
                <div v-if="!testResult" class="agent-config__test-status">
                  {{ testingModel ? '测试中...' : '尚未测试' }}
                </div>
                <div v-else-if="testResult.ok" class="agent-config__test-status agent-config__test-status--ok">
                  测试通过：{{ testResult.response }}
                </div>
                <div v-else class="agent-config__test-status agent-config__test-status--err">
                  测试失败：{{ testResult.error }}
                </div>
              </div>
            </div>
          </div>

          <div class="agent-config__footer">
            <button class="ghost-button" @click="showConfig = false">取消</button>
            <button class="primary-button" :disabled="testingModel" @click="saveConfig(true)">保存并测试</button>
            <button class="primary-button" :disabled="testingModel" @click="saveConfig(false)">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
