import { defineStore } from 'pinia';
import { getDesktopApi } from '../services/desktop.js';

const desktopApi = getDesktopApi();

export const useAgentStore = defineStore('agent', {
  state: () => ({
    // Configuration
    config: {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096
    },
    configLoaded: false,

    // Session
    sessionId: null,
    mode: 'agent',
    model: 'gpt-4o',

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
    hasConfig: (state) => Boolean(state.config.apiKey),
    canSend: (state) => !state.isStreaming,
    messageCount: (state) => state.messages.length
  },

  actions: {
    async loadConfig() {
      if (this.configLoaded) return;
      try {
        const cfg = await desktopApi.agentGetConfig();
        this.config = { ...this.config, ...cfg };
        this.configLoaded = true;
      } catch (err) {
        console.error('Failed to load agent config:', err);
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

    setModel(model) {
      this.model = model;
      // Also update config model
      this.config.model = model;
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
