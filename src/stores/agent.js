import { defineStore } from 'pinia';
import { getDesktopApi } from '../services/desktop.js';

const desktopApi = getDesktopApi();

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDefaultOpenAIModel() {
  return {
    id: generateId(),
    provider: 'openai',
    displayName: 'OpenAI - GPT-4o',
    modelId: 'gpt-4o',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    reasoningStrength: 'medium',
    endpoint: '/v1/chat/completions',
    extraParams: {},
    customHeaders: {},
    extraParamsEnabled: false,
    customHeadersEnabled: false,
    notes: ''
  };
}

function createDefaultAnthropicModel() {
  return {
    id: generateId(),
    provider: 'anthropic',
    displayName: 'Anthropic - Claude 3.5 Sonnet',
    modelId: 'claude-3-5-sonnet-20241022',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    thinkingStrength: 'medium',
    extraParams: {},
    customHeaders: {},
    extraParamsEnabled: false,
    customHeadersEnabled: false,
    notes: ''
  };
}

function migrateLegacyConfig(cfg) {
  // Migrate from old flat config to new model array
  if (cfg && cfg.models && Array.isArray(cfg.models)) {
    return cfg;
  }
  if (cfg && cfg.apiKey) {
    const isAnthropic = cfg.baseUrl?.includes('anthropic') || cfg.model?.startsWith('claude');
    const model = isAnthropic ? createDefaultAnthropicModel() : createDefaultOpenAIModel();
    model.displayName = cfg.model || model.modelId;
    model.modelId = cfg.model || model.modelId;
    model.apiKey = cfg.apiKey || '';
    model.baseUrl = cfg.baseUrl || model.baseUrl;
    model.maxOutputTokens = cfg.maxTokens || model.maxOutputTokens;
    return {
      selectedModelId: model.id,
      models: [model]
    };
  }
  const defaultModel = createDefaultOpenAIModel();
  return {
    selectedModelId: defaultModel.id,
    models: [defaultModel]
  };
}

export const useAgentStore = defineStore('agent', {
  state: () => ({
    // Configuration
    config: {
      selectedModelId: '',
      models: []
    },
    configLoaded: false,

    // Session
    sessionId: null,
    mode: 'agent',

    // Messages — each message is:
    // { id, role: 'user'|'assistant', content: string, toolCalls: [], status: 'streaming'|'done'|'error' }
    messages: [],

    // Streaming state
    isStreaming: false,
    streamingMessageId: null,

    // Error
    error: null,

    // Event listener registered flag
    listenerRegistered: false
  }),

  getters: {
    hasConfig: (state) => state.config.models.some(m => Boolean(m.apiKey)),
    currentModel: (state) => {
      return state.config.models.find(m => m.id === state.config.selectedModelId) || state.config.models[0] || null;
    },
    canSend: (state) => !state.isStreaming,
    messageCount: (state) => state.messages.length
  },

  actions: {
    async loadConfig() {
      if (this.configLoaded) return;
      try {
        const cfg = await desktopApi.agentGetConfig();
        this.config = migrateLegacyConfig(cfg);
        if (!this.config.selectedModelId && this.config.models.length > 0) {
          this.config.selectedModelId = this.config.models[0].id;
        }
        this.configLoaded = true;
      } catch (err) {
        console.error('Failed to load agent config:', err);
        const defaultModel = createDefaultOpenAIModel();
        this.config = {
          selectedModelId: defaultModel.id,
          models: [defaultModel]
        };
        this.configLoaded = true;
      }
    },

    async saveConfig(config) {
      this.config = { ...this.config, ...config };
      try {
        await desktopApi.agentSetConfig(this.config);
      } catch (err) {
        console.error('Failed to save agent config:', err);
      }
    },

    addModel(provider) {
      const model = provider === 'anthropic' ? createDefaultAnthropicModel() : createDefaultOpenAIModel();
      this.config.models.push(model);
      this.config.selectedModelId = model.id;
      return model;
    },

    updateModel(modelId, patch) {
      const idx = this.config.models.findIndex(m => m.id === modelId);
      if (idx >= 0) {
        this.config.models[idx] = { ...this.config.models[idx], ...patch };
      }
    },

    deleteModel(modelId) {
      const idx = this.config.models.findIndex(m => m.id === modelId);
      if (idx >= 0) {
        this.config.models.splice(idx, 1);
        if (this.config.selectedModelId === modelId) {
          this.config.selectedModelId = this.config.models[0]?.id || '';
        }
      }
    },

    selectModel(modelId) {
      this.config.selectedModelId = modelId;
    },

    async testModel(model) {
      // Use a simple non-streaming test call via backend
      try {
        const result = await desktopApi.agentTestModel(model);
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    ensureSession() {
      if (!this.sessionId) {
        // Create session synchronously (the IPC call is async but we set a placeholder)
        this.sessionId = `pending-${Date.now()}`;
        desktopApi.agentCreateSession(this.mode).then((id) => {
          this.sessionId = id;
        });
      }
      return this.sessionId;
    },

    registerEventListener() {
      if (this.listenerRegistered) return;
      this.listenerRegistered = true;
      desktopApi.onAgentEvent((event) => {
        this.handleAgentEvent(event);
      });
    },

    handleAgentEvent(event) {
      // Only handle events for the current session
      if (event.sessionId && this.sessionId && event.sessionId !== this.sessionId) {
        return;
      }

      switch (event.type) {
        case 'text': {
          // Append streaming text to the current streaming message
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (!msg) {
            // Shouldn't happen, but handle gracefully
            return;
          }
          msg.content += event.content;
          break;
        }
        case 'tool_call': {
          // Add tool call to the current streaming message
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (!msg) return;
          if (!msg.toolCalls) msg.toolCalls = [];
          msg.toolCalls.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            result: null,
            expanded: false
          });
          break;
        }
        case 'tool_result': {
          // Update the tool call with its result
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (!msg) return;
          const tc = msg.toolCalls?.find(t => t.id === event.id);
          if (tc) {
            tc.result = event.result;
          }
          break;
        }
        case 'round_end': {
          // A tool round completed, LLM will continue
          break;
        }
        case 'done': {
          // Mark streaming message as done
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (msg) {
            msg.status = event.aborted ? 'aborted' : 'done';
          }
          this.isStreaming = false;
          this.streamingMessageId = null;
          break;
        }
        case 'error': {
          this.error = event.error;
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (msg) {
            msg.status = 'error';
            msg.content += `\n\n**Error:** ${event.error}`;
          }
          this.isStreaming = false;
          this.streamingMessageId = null;
          break;
        }
      }
    },

    async send(content) {
      if (!content.trim() || this.isStreaming) return;

      this.registerEventListener();
      this.ensureSession();

      // Wait for session to be ready
      if (this.sessionId?.startsWith('pending-')) {
        await new Promise(resolve => {
          const check = setInterval(() => {
            if (!this.sessionId?.startsWith('pending-')) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      }

      // Add user message
      const userMsgId = `msg-${Date.now()}-u`;
      this.messages.push({
        id: userMsgId,
        role: 'user',
        content: content.trim(),
        status: 'done'
      });

      // Add placeholder assistant message for streaming
      const assistantMsgId = `msg-${Date.now()}-a`;
      this.messages.push({
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        status: 'streaming'
      });

      this.streamingMessageId = assistantMsgId;
      this.isStreaming = true;
      this.error = null;

      try {
        await desktopApi.agentSend({
          sessionId: this.sessionId,
          content: content.trim()
        });
      } catch (err) {
        this.error = err.message;
        this.isStreaming = false;
        this.streamingMessageId = null;
        let msg = this.messages.find(m => m.id === assistantMsgId);
        if (msg) {
          msg.status = 'error';
          msg.content = `**Error:** ${err.message}`;
        }
      }
    },

    async abort() {
      try {
        await desktopApi.agentAbort();
      } catch { /* ignore */ }
      this.isStreaming = false;
      if (this.streamingMessageId) {
        let msg = this.messages.find(m => m.id === this.streamingMessageId);
        if (msg) {
          msg.status = 'aborted';
          if (!msg.content) msg.content = '(aborted)';
        }
        this.streamingMessageId = null;
      }
    },

    async clearChat() {
      if (this.isStreaming) {
        await this.abort();
      }
      this.messages = [];
      this.error = null;
      if (this.sessionId) {
        try {
          await desktopApi.agentClearSession(this.sessionId);
        } catch { /* ignore */ }
      }
    },

    setMode(mode) {
      this.mode = mode;
    },

    toggleToolCallExpand(messageId, toolCallId) {
      let msg = this.messages.find(m => m.id === messageId);
      if (!msg?.toolCalls) return;
      let tc = msg.toolCalls.find(t => t.id === toolCallId);
      if (tc) {
        tc.expanded = !tc.expanded;
      }
    }
  }
});
