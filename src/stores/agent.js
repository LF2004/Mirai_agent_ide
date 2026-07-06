import { defineStore } from 'pinia';
import { getDesktopApi } from '../services/desktop.js';

const desktopApi = getDesktopApi();

/**
 * Deep-clone a reactive proxy into a plain object safe for Electron IPC.
 * Vue's toRaw only unwraps the top level; JSON round-trip handles nesting.
 */
function toPlain(obj) {
  if (obj == null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${generateId()}`;
}

function parseToolResultContent(content) {
  if (content == null || content === '') return null;
  if (typeof content === 'object' && typeof content.success === 'boolean') {
    return content;
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.success === 'boolean') {
      return parsed;
    }
    return { success: true, result: parsed };
  } catch {
    const text = String(content);
    if (text.startsWith('Error:')) {
      return { success: false, error: text.slice(6).trim() };
    }
    return { success: true, result: text };
  }
}

function normalizeAttachment(attachment = {}) {
  return {
    id: attachment.id || `att-${generateId()}`,
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

function hydrateSessionMessages(messages = []) {
  const hydrated = [];
  const toolCallIndex = new Map();

  for (const message of messages) {
    if (message.role === 'tool') {
      const target = toolCallIndex.get(message.tool_call_id);
      if (target) {
        target.result = parseToolResultContent(message.content);
      }
      continue;
    }

    const hydratedMessage = {
      id: `restored-${generateId()}`,
      role: message.role,
      content: message.content || '',
      attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizeAttachment) : [],
      createdAt: message.createdAt || new Date().toISOString(),
      status: 'done'
    };

    if (message.role === 'assistant') {
      const toolCalls = Array.isArray(message.tool_calls)
        ? message.tool_calls.map((tc) => ({
            id: tc.id || `tool-${generateId()}`,
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}',
            result: null,
            expanded: false
          }))
        : [];

      hydratedMessage.toolCalls = toolCalls;
      for (const toolCall of toolCalls) {
        toolCallIndex.set(toolCall.id, toolCall);
      }
    }

    hydrated.push(hydratedMessage);
  }

  return hydrated;
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
    extraParams: '',
    customHeaders: '',
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
    extraParams: '',
    customHeaders: '',
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
    listenerRegistered: false,

    // In-flight session creation promise to avoid send/abort races
    sessionInitPromise: null,

    // Session history (persisted sessions)
    sessionHistory: [],
    activeSessionIndex: 0,

    // Lightweight workflow summary for plan/multitask modes
    workflow: {
      mode: '',
      title: '',
      steps: [],
      updatedAt: ''
    },

    activeRequestId: '',
    diagnostics: [],
    diagnosticsLoadedAt: '',
    lastErrorAt: ''
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

    async reloadConfig() {
      this.configLoaded = false;
      await this.loadConfig();
      return this.config;
    },

    async saveConfig(config) {
      this.config = { ...this.config, ...config };
      try {
        await desktopApi.agentSetConfig(toPlain(this.config));
      } catch (err) {
        console.error('Failed to save agent config:', err);
        throw err;
      }
    },

    async addModel(provider) {
      const model = provider === 'anthropic' ? createDefaultAnthropicModel() : createDefaultOpenAIModel();
      this.config.models.push(model);
      this.config.selectedModelId = model.id;
      await this._persistConfig();
      return model;
    },

    async updateModel(modelId, patch) {
      const idx = this.config.models.findIndex(m => m.id === modelId);
      if (idx >= 0) {
        this.config.models[idx] = { ...this.config.models[idx], ...patch };
        await this._persistConfig();
      }
    },

    async deleteModel(modelId) {
      const idx = this.config.models.findIndex(m => m.id === modelId);
      if (idx >= 0) {
        this.config.models.splice(idx, 1);
        if (this.config.selectedModelId === modelId) {
          this.config.selectedModelId = this.config.models[0]?.id || '';
        }
        await this._persistConfig();
      }
    },

    async selectModel(modelId) {
      this.config.selectedModelId = modelId;
      await this._persistConfig();
    },

    // Fire-and-forget persistence helper — converts reactive state to plain
    // object and sends to the backend for SQLite storage.
    _persistConfig() {
      return this.saveConfig(this.config).catch((err) => {
        console.error('Failed to persist model config:', err);
      });
    },

    async testModel(model) {
      // Use a simple non-streaming test call via backend
      try {
        const result = await desktopApi.agentTestModel(toPlain(model));
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async ensureSession() {
      if (this.sessionId) {
        return this.sessionId;
      }
      if (!this.sessionInitPromise) {
        this.sessionInitPromise = desktopApi.agentCreateSession(this.mode)
          .then((id) => {
            this.sessionId = id;
            return id;
          })
          .finally(() => {
            this.sessionInitPromise = null;
          });
      }
      return this.sessionInitPromise;
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
        case 'workflow': {
          this.setWorkflow({
            mode: event.mode || this.mode,
            ...event.workflow,
            updatedAt: new Date().toISOString()
          });
          break;
        }
        case 'tool_call': {
          // Add tool call to the current streaming message
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (!msg) return;
          if (!msg.toolCalls) msg.toolCalls = [];
          const existing = msg.toolCalls.find((tc) => tc.id === event.id || (!event.id && tc.name === event.name));
          if (existing) {
            if (event.name) existing.name = event.name;
            if (typeof event.arguments === 'string' && event.arguments) {
              existing.arguments = event.arguments;
            }
          } else {
            msg.toolCalls.push({
              id: event.id || `tool-${generateId()}`,
              name: event.name,
              arguments: event.arguments || '{}',
              result: null,
              expanded: false
            });
          }
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
            if (event.aborted && !msg.content) {
              msg.content = '(stopped)';
            }
          }
          this.isStreaming = false;
          this.streamingMessageId = null;
          this.activeRequestId = '';
          this.loadSessionHistory();
          break;
        }
        case 'error': {
          this.error = event.error;
           this.lastErrorAt = new Date().toISOString();
          let msg = this.messages.find(m => m.id === this.streamingMessageId);
          if (msg) {
            msg.status = 'error';
            msg.content += `\n\n**Error:** ${event.error}`;
          }
          this.isStreaming = false;
          this.streamingMessageId = null;
          this.activeRequestId = '';
          this.loadSessionHistory();
          break;
        }
      }
    },

    async send(content, attachments = []) {
      const text = String(content || '').trim();
      const normalizedAttachments = Array.isArray(attachments) ? attachments.map(normalizeAttachment) : [];
      if ((!text && normalizedAttachments.length === 0) || this.isStreaming) return;

      this.registerEventListener();
      await this.ensureSession();

      // Add user message
      const userMsgId = `msg-${Date.now()}-u`;
      this.messages.push({
        id: userMsgId,
        role: 'user',
        content: text,
        attachments: normalizedAttachments,
        status: 'done',
        createdAt: new Date().toISOString()
      });

      // Add placeholder assistant message for streaming
      const assistantMsgId = `msg-${Date.now()}-a`;
      const requestId = generateRequestId();
      this.messages.push({
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        status: 'streaming',
        requestId,
        createdAt: new Date().toISOString()
      });

      this.streamingMessageId = assistantMsgId;
      this.activeRequestId = requestId;
      this.isStreaming = true;
      this.error = null;

      try {
        await desktopApi.agentSend({
          sessionId: this.sessionId,
          content: text,
          attachments: normalizedAttachments
        });
      } catch (err) {
        this.error = err.message;
        this.lastErrorAt = new Date().toISOString();
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.activeRequestId = '';
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
          if (!msg.content) msg.content = '(stopped)';
        }
        this.streamingMessageId = null;
      }
      this.activeRequestId = '';
    },

    async clearChat() {
      if (this.isStreaming) {
        await this.abort();
      }
      this.messages = [];
      this.error = null;
      this.workflow = {
        mode: '',
        title: '',
        steps: [],
        updatedAt: ''
      };
      this.activeRequestId = '';
      this.sessionInitPromise = null;
      if (this.sessionId) {
        try {
          await desktopApi.agentClearSession(this.sessionId);
        } catch { /* ignore */ }
      }
    },

    async newSession(mode = this.mode) {
      if (this.isStreaming) {
        await this.abort();
      }
      this.sessionId = null;
      this.sessionInitPromise = null;
      this.messages = [];
      this.error = null;
      this.workflow = {
        mode: '',
        title: '',
        steps: [],
        updatedAt: ''
      };
      this.activeRequestId = '';
      this.mode = String(mode || 'agent');
      this.sessionId = await desktopApi.agentCreateSession(this.mode);
      await this.loadSessionHistory();
      return this.sessionId;
    },

    async setMode(mode) {
      const nextMode = String(mode || 'agent');
      this.mode = nextMode;
      this.workflow = {
        mode: nextMode,
        title: nextMode === 'plan' ? 'Planning workflow' : nextMode === 'multitask' ? 'Task workflow' : '',
        steps: [],
        updatedAt: new Date().toISOString()
      };

      await desktopApi.saveSetting?.({
        key: 'lastMode',
        value: nextMode
      });

      if (this.sessionId) {
        this.sessionId = null;
        this.messages = [];
        this.error = null;
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.activeRequestId = '';
        this.sessionInitPromise = null;
      }

      try {
        this.sessionId = await desktopApi.agentCreateSession(nextMode);
      } catch (err) {
        console.error('Failed to recreate agent session after mode change:', err);
      }
    },

    // ===== Session History =====

    async loadSessionHistory() {
      try {
        this.sessionHistory = await desktopApi.agentListSessions();
        if (!this.sessionHistory.some((s) => s.id === this.sessionId)) {
          this.activeSessionIndex = 0;
        }
      } catch (err) {
        console.error('Failed to load session history:', err);
        this.sessionHistory = [];
      }
    },

    async loadSession(sessionId) {
      try {
        const result = await desktopApi.agentLoadSession(sessionId);
        if (result.ok && result.session) {
          // Restore messages into the store
          this.messages = hydrateSessionMessages(result.session.messages);
          this.sessionId = sessionId;
          this.sessionInitPromise = null;
          this.mode = result.session.mode || 'agent';
          this.activeSessionIndex = Math.max(0, this.sessionHistory.findIndex((s) => s.id === sessionId));
          this.workflow = {
            mode: this.mode,
            title: result.session.title || '',
            steps: [],
            updatedAt: new Date().toISOString()
          };
          return true;
        }
        return false;
      } catch (err) {
        console.error('Failed to load session:', err);
        return false;
      }
    },

    async deleteSessionFromHistory(sessionId) {
      try {
        await desktopApi.agentDeleteSession(sessionId);
        this.sessionHistory = this.sessionHistory.filter(s => s.id !== sessionId);
        if (this.sessionId === sessionId) {
          this.sessionId = null;
          this.messages = [];
          this.workflow = {
            mode: this.mode,
            title: '',
            steps: [],
            updatedAt: ''
          };
          this.activeRequestId = '';
          this.sessionInitPromise = null;
          this.activeSessionIndex = 0;
        }
      } catch (err) {
        console.error('Failed to delete session:', err);
      }
    },

    async renameSession(sessionId, title) {
      const value = String(title || '').trim();
      if (!sessionId || !value) return false;
      try {
        const result = await desktopApi.agentRenameSession({ sessionId, title: value });
        if (!result?.ok) return false;
        const session = this.sessionHistory.find((item) => item.id === sessionId);
        if (session) {
          session.title = value;
        }
        return true;
      } catch (err) {
        console.error('Failed to rename session:', err);
        return false;
      }
    },

    async switchSession(sessionId) {
      if (!sessionId || sessionId === this.sessionId) return true;
      const ok = await this.loadSession(sessionId);
      if (ok) {
        await this.loadSessionHistory();
      }
      return ok;
    },

    async getDiagnostics() {
      try {
        return await desktopApi.agentGetDiagnostics();
      } catch {
        return [];
      }
    },

    async refreshDiagnostics() {
      this.diagnostics = await this.getDiagnostics();
      this.diagnosticsLoadedAt = new Date().toISOString();
      return this.diagnostics;
    },

    buildSessionExport(sessionId = this.sessionId) {
      const session = this.sessionHistory.find((item) => item.id === sessionId) || null;
      return {
        exportedAt: new Date().toISOString(),
        sessionId,
        mode: this.mode,
        session,
        workflow: toPlain(this.workflow),
        messages: toPlain(this.messages),
        diagnostics: toPlain(this.diagnostics)
      };
    },

    toggleToolCallExpand(messageId, toolCallId) {
      let msg = this.messages.find(m => m.id === messageId);
      if (!msg?.toolCalls) return;
      let tc = msg.toolCalls.find(t => t.id === toolCallId);
      if (tc) {
        tc.expanded = !tc.expanded;
      }
    },

    setWorkflow(workflow) {
      this.workflow = {
        mode: workflow?.mode || this.mode,
        title: workflow?.title || '',
        steps: Array.isArray(workflow?.steps) ? workflow.steps : [],
        updatedAt: workflow?.updatedAt || new Date().toISOString()
      };
    }
  }
});
