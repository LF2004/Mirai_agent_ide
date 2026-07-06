import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProxyAgent } from 'undici';
import { getToolDefinitions, executeTool as executeToolEngine } from '../tools/agent/index.js';
import { buildSystemPrompt } from '../prompts/prompt-manager.js';

/**
 * AgentService — Core Agent engine for Mirai Agent IDE
 *
 * Architecture:
 *   - LLM Client: OpenAI + Anthropic streaming APIs
 *   - Tool Engine: Built-in tools (read/write/list/grep/shell/create/delete)
 *   - Session Manager: Conversation history + context per session
 *   - Agent Loop: State machine (IDLE → PROCESSING → TOOL_CALLING → TURN_ENDED)
 *   - Prompt Builder: System prompt + project context + tool schemas
 */

const MAX_TOOL_ROUNDS = 20;
const LLM_TIMEOUT_MS = 120000;
const TOOL_TIMEOUT_MS = 30000;
const TOOL_RETRY_COUNT = 1;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60000;
const PROXY_ENV_KEYS = ['CURSOR_RELAY_OUTBOUND_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
const WRITE_TOOL_NAMES = new Set(['write_file', 'create_file', 'delete_file', 'run_command']);

// Explicit state machine constants
const SESSION_STATUS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  TOOL_CALLING: 'tool_calling',
  TURN_ENDED: 'turn_ended',
  ERROR: 'error',
  DEGRADED: 'degraded'
};

// Rough token estimation: ~4 chars per token for English/code
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function estimateMessageTokens(msg) {
  if (!msg) return 0;
  let total = 4; // role overhead
  if (msg.content) total += estimateTokens(msg.content);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.function?.name || '');
      total += estimateTokens(tc.function?.arguments || '');
    }
  }
  return total;
}

/**
 * Truncate conversation history to fit within the context window.
 * Always keeps: system message + last N messages.
 * Older messages are summarized or dropped.
 */
function truncateMessages(messages, maxTokens, systemPrompt) {
  const systemTokens = estimateTokens(systemPrompt);
  const budget = maxTokens - systemTokens - 1000; // reserve 1k for response
  if (budget <= 0) return messages;

  let totalTokens = 0;
  // Walk from the end (most recent) backwards
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (totalTokens + tokens > budget) break;
    kept.unshift(messages[i]);
    totalTokens += tokens;
  }

  // Ensure we keep at least the last 2 messages (user + assistant)
  if (kept.length < 2 && messages.length >= 2) {
    kept.unshift(messages[messages.length - 2]);
    kept.unshift(messages[messages.length - 1]);
  }

  return kept;
}

async function executeTool(toolName, args, context) {
  const maxRetries = TOOL_RETRY_COUNT;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeToolEngine(toolName, args, context);
      // Don't retry on logical errors (e.g. "file not found"), only on transient failures
      if (!result.success && result.error && /timeout|timed out|ECONN|ENOTFOUND|network/i.test(result.error) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  return { success: false, error: lastError?.message || 'Tool execution failed after retries' };
}

function safeParseJSON(value, defaultValue = {}) {
  if (!value) return defaultValue;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

function buildOpenAIInputMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'user') {
      const userContent = [];
      if (message.content) {
        userContent.push({ type: 'text', text: message.content });
      }
      for (const attachment of message.attachments || []) {
        if (attachment.kind === 'image' && attachment.dataUrl) {
          userContent.push({
            type: 'image_url',
            image_url: { url: attachment.dataUrl }
          });
          continue;
        }
        if (attachment.kind === 'text' && attachment.textContent) {
          userContent.push({
            type: 'text',
            text: `Attached file: ${attachment.name}\n\n${attachment.textContent}`
          });
          continue;
        }
        userContent.push({
          type: 'text',
          text: `Attached file: ${attachment.name} (${attachment.mime || 'file'}, ${attachment.size || 0} bytes)`
        });
      }
      return {
        role: 'user',
        content: userContent.length ? userContent : message.content || ''
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content || '',
        tool_call_id: message.tool_call_id
      };
    }

    const content = message.tool_calls?.length
      ? [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.tool_calls.map((tc) => ({
            type: 'tool_call',
            id: tc.id,
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || ''
          }))
        ]
      : message.content || '';

    const result = {
      role: message.role,
      content
    };

    if (message.tool_calls?.length) {
      result.tool_calls = message.tool_calls.map((tc) => ({
        id: tc.id,
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || ''
        }
      }));
    }

    return result;
  });
}

function buildResponsesPayload(model, messages, tools) {
  const systemMessage = messages.find((m) => m.role === 'system');
  const inputMessages = buildOpenAIInputMessages(messages.filter((m) => m.role !== 'system')).map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((item) => {
        if (item.type === 'text') return { type: 'input_text', text: item.text };
        if (item.type === 'image_url') return { type: 'input_image', image_url: item.image_url?.url || '' };
        return item;
      })
    };
  });
  const payload = {
    model: model.modelId,
    input: inputMessages,
    stream: true,
    max_output_tokens: Number(model.maxOutputTokens) || 4096
  };

  if (systemMessage?.content) {
    payload.instructions = systemMessage.content;
  }

  if (model.reasoningStrength && model.reasoningStrength !== 'none') {
    payload.reasoning = { effort: model.reasoningStrength };
  }

  if (tools && tools.length > 0) {
    payload.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }));
  }

  const extraParams = model.extraParamsEnabled ? safeParseJSON(model.extraParams) : {};
  Object.assign(payload, extraParams);
  return payload;
}

function* normalizeResponsesEvent(chunk) {
  const type = chunk?.type;
  if (!type) return;

  if (type === 'response.output_text.delta') {
    const content = chunk.delta || chunk.text || '';
    if (content) {
      yield { type: 'text', content };
    }
    return;
  }

  if (type === 'response.reasoning_text.delta') {
    const content = chunk.delta || chunk.text || '';
    if (content) {
      yield { type: 'thinking', content };
    }
    return;
  }

  if (type === 'response.output_item.added') {
    const item = chunk.item;
    if (item?.type === 'function_call' || item?.type === 'tool_call') {
      yield {
        type: 'tool_call',
        id: item.id || chunk.item_id || '',
        name: item.name || '',
        arguments: item.arguments || ''
      };
    }
    return;
  }

  if (type === 'response.function_call_arguments.delta') {
    yield {
      type: 'tool_call_delta',
      index: chunk.output_index ?? 0,
      id: chunk.item_id || '',
      name: chunk.name || '',
      arguments: chunk.delta || ''
    };
  }
}

function normalizeProxyUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (/^[a-z]+:\/\//i.test(raw)) {
    return raw;
  }

  return `http://${raw}`;
}

function readWindowsSystemProxy() {
  if (process.platform !== 'win32') {
    return '';
  }

  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
      { encoding: 'utf8', windowsHide: true }
    );

    const match = output.match(/ProxyServer\s+REG_\w+\s+(.+)/i);
    if (!match) {
      return '';
    }

    const raw = String(match[1] || '').trim();
    if (!raw) {
      return '';
    }

    if (raw.includes('=')) {
      const pairs = raw.split(';').map((item) => item.trim()).filter(Boolean);
      const map = new Map();
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
          map.set(key.trim().toLowerCase(), value.trim());
        }
      }

      return normalizeProxyUrl(map.get('https') || map.get('http') || map.values().next().value || '');
    }

    return normalizeProxyUrl(raw);
  } catch {
    return '';
  }
}

function detectProxyConfig() {
  for (const key of PROXY_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return {
        enabled: true,
        url: value,
        source: key.toLowerCase().includes('cursor') ? 'cursor-env' : 'env'
      };
    }
  }

  const windowsProxy = readWindowsSystemProxy();
  if (windowsProxy) {
    return {
      enabled: true,
      url: windowsProxy,
      source: 'windows-registry'
    };
  }

  return {
    enabled: false,
    url: '',
    source: 'direct'
  };
}

function createProxyDispatcher(proxyConfig) {
  if (!proxyConfig?.enabled || !proxyConfig.url) {
    return null;
  }

  try {
    return new ProxyAgent(proxyConfig.url);
  } catch {
    return null;
  }
}

function createSessionSnapshot(session) {
  return {
    id: session.id,
    mode: session.mode || 'agent',
    status: session.status || SESSION_STATUS.IDLE,
    createdAt: session.createdAt || Date.now(),
    updatedAt: Date.now(),
    title: session.title || 'New Session',
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    lastMessageAt: session.messages?.[session.messages.length - 1]?.createdAt || null
  };
}

function normalizeSessionMessages(messages = []) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content || '',
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          path: attachment.path,
          kind: attachment.kind,
          mime: attachment.mime,
          size: attachment.size,
          textContent: attachment.textContent,
          dataUrl: attachment.dataUrl,
          createdAt: attachment.createdAt
        }))
      : undefined,
    tool_calls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || ''
          }
        }))
      : undefined,
    tool_call_id: message.tool_call_id || undefined,
    createdAt: message.createdAt || Date.now()
  }));
}

function extractWorkflowFromText(text, mode) {
  const raw = String(text || '').trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = match ? match[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.map((step, index) => ({
          id: step.id || `${mode || 'workflow'}-${index + 1}`,
          title: String(step.title || step.name || `Step ${index + 1}`),
          detail: String(step.detail || step.description || ''),
          status: String(step.status || 'pending')
        }))
      : [];

    if (!parsed.title && steps.length === 0) {
      return null;
    }

    return {
      title: String(parsed.title || parsed.summary || (mode === 'plan' ? 'Plan' : 'Workflow')),
      steps,
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
      raw: parsed
    };
  } catch {
    return null;
  }
}

function getCurrentModel(config) {
  if (!config || !Array.isArray(config.models)) return null;
  let model = config.models.find(m => m.id === config.selectedModelId);
  if (!model) model = config.models[0];
  return model || null;
}

async function fetchWithTimeout(url, options, timeoutMs = LLM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstreamSignal = options?.signal;
    if (upstreamSignal?.aborted) {
      controller.abort();
    } else if (upstreamSignal) {
      upstreamSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call OpenAI-compatible chat completions streaming API
 */
async function callOpenAIStream(model, messages, tools, signal, dispatcher = null) {
  const baseUrl = (model.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = model.endpoint || '/v1/chat/completions';
  const url = `${baseUrl}${endpoint}`;

  const isResponsesEndpoint = endpoint.includes('responses');
  const body = isResponsesEndpoint
    ? buildResponsesPayload(model, messages, tools)
    : {
        model: model.modelId,
        messages,
        stream: true,
        max_tokens: Number(model.maxOutputTokens) || 4096
      };

  if (!isResponsesEndpoint) {
    const extraParams = model.extraParamsEnabled ? safeParseJSON(model.extraParams) : {};
    if (model.provider === 'openai' && model.reasoningStrength && model.reasoningStrength !== 'none') {
      body.reasoning_effort = model.reasoningStrength;
    }
    Object.assign(body, extraParams);

    if (tools && tools.length > 0 && endpoint.includes('chat/completions')) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${model.apiKey || ''}`
  };
  const customHeaders = model.customHeadersEnabled ? safeParseJSON(model.customHeaders) : {};
  Object.assign(headers, customHeaders);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
    dispatcher
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('No response body from LLM API');
  }

  return response.body;
}

/**
 * Call Anthropic Messages streaming API
 */
async function callAnthropicStream(model, messages, tools, signal, dispatcher = null) {
  const baseUrl = (model.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/messages`;

  // Convert messages to Anthropic format
  const anthropicMessages = messages.map(m => {
    if (m.role === 'system') return null;
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }]
      };
    }
    if (m.role === 'assistant' && m.tool_calls) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeParseJSON(tc.function.arguments, {})
        });
      }
      return { role: 'assistant', content };
    }
    if (m.role === 'user') {
      const content = [];
      if (m.content) {
        content.push({ type: 'text', text: m.content });
      }
      for (const attachment of m.attachments || []) {
        if (attachment.kind === 'image' && attachment.dataUrl) {
          const match = String(attachment.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2]
              }
            });
            continue;
          }
        }
        if (attachment.kind === 'text' && attachment.textContent) {
          content.push({ type: 'text', text: `Attached file: ${attachment.name}\n\n${attachment.textContent}` });
        } else {
          content.push({ type: 'text', text: `Attached file: ${attachment.name}` });
        }
      }
      return { role: 'user', content: content.length ? content : m.content };
    }
    return { role: m.role, content: m.content };
  }).filter(Boolean);

  // Extract system message
  const systemMessage = messages.find(m => m.role === 'system');

  const body = {
    model: model.modelId,
    messages: anthropicMessages,
    max_tokens: Number(model.maxOutputTokens) || 4096,
    stream: true
  };

  if (systemMessage) {
    body.system = systemMessage.content;
  }

  if (model.thinkingStrength && model.thinkingStrength !== 'none') {
    const budget = model.thinkingStrength === 'high' ? 16000 : model.thinkingStrength === 'medium' ? 8000 : 4000;
    body.thinking = { type: 'enabled', budget_tokens: budget };
  }

  // Anthropic tools format
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }

  const extraParams = model.extraParamsEnabled ? safeParseJSON(model.extraParams) : {};
  Object.assign(body, extraParams);

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': model.apiKey || '',
    'anthropic-version': '2023-06-01'
  };
  const customHeaders = model.customHeadersEnabled ? safeParseJSON(model.customHeaders) : {};
  Object.assign(headers, customHeaders);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
    dispatcher
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('No response body from Anthropic API');
  }

  return response.body;
}

async function* parseSSEStream(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line) continue;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data);
          } catch {
            // skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Normalize streamed chunks from OpenAI or Anthropic into a common shape
 */
async function* normalizeStream(chunks, provider) {
  for await (const chunk of chunks) {
    if (provider === 'anthropic') {
      const type = chunk.type;
      if (type === 'content_block_delta') {
        const delta = chunk.delta;
        if (delta && delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text };
        } else if (delta && delta.type === 'thinking_delta') {
          yield { type: 'thinking', content: delta.thinking };
        }
      } else if (type === 'content_block_start') {
        if (chunk.content_block?.type === 'tool_use') {
          yield {
            type: 'tool_call',
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            arguments: ''
          };
        }
      } else if (type === 'content_block_stop') {
        // end of block
      } else if (type === 'message_delta') {
        // stop reason
      }
    } else if (provider === 'openai-responses') {
      for (const event of normalizeResponsesEvent(chunk) || []) {
        yield event;
      }
    } else {
      // OpenAI format
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text', content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            index: tc.index,
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments
          };
        }
      }
    }
  }
}

export class AgentService {
  constructor(databaseService, userDataPath) {
    this.db = databaseService;
    this.userDataPath = userDataPath || '';
    this.sessionsDir = userDataPath ? path.join(userDataPath, 'agent-sessions') : '';

    // Load config from database if available
    const savedConfig = databaseService?.getAgentConfig?.();
    this.config = savedConfig && savedConfig.models ? savedConfig : {
      selectedModelId: '',
      models: []
    };

    this.sessions = new Map();
    this.activeController = null;
    this.workspacePath = '';
    this.workspaceName = '';
    this.proxyConfig = detectProxyConfig();
    this.proxyDispatcher = createProxyDispatcher(this.proxyConfig);

    // Circuit breaker state — per session
    this.circuitBreakers = new Map(); // sessionId -> { errors, lastErrorTime, tripped }

    // Diagnostics log (in-memory ring buffer)
    this.diagnostics = [];
    this.maxDiagnostics = 200;

    // Ensure sessions directory exists
    if (this.sessionsDir) {
      try {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      } catch { /* ignore */ }
    }

    this.log('info', 'Proxy detection complete', this.proxyConfig);
  }

  getSessionDir(sessionId) {
    if (!this.sessionsDir || !sessionId) return '';
    return path.join(this.sessionsDir, sessionId);
  }

  getSessionStatePath(sessionId) {
    return path.join(this.getSessionDir(sessionId), 'state.json');
  }

  getSessionMessagesPath(sessionId) {
    return path.join(this.getSessionDir(sessionId), 'messages.json');
  }

  ensureSessionDir(sessionId) {
    const dir = this.getSessionDir(sessionId);
    if (!dir) return '';
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ===== Config =====

  setWorkspace(wsPath, wsName) {
    this.workspacePath = wsPath || '';
    this.workspaceName = wsName || '';
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
    // Persist to SQLite so models survive app restart
    if (this.db?.saveAgentConfig) {
      try {
        this.db.saveAgentConfig(this.config);
      } catch (err) {
        this.log('error', `Failed to persist agent config: ${err.message}`);
      }
    }
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  log(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    this.diagnostics.push(entry);
    if (this.diagnostics.length > this.maxDiagnostics) {
      this.diagnostics.shift();
    }
  }

  getDiagnostics() {
    return [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'proxy-status',
        proxy: this.proxyConfig
      },
      ...this.diagnostics
    ];
  }

  // ===== Circuit Breaker =====

  getCircuitBreaker(sessionId) {
    if (!this.circuitBreakers.has(sessionId)) {
      this.circuitBreakers.set(sessionId, {
        errors: 0,
        lastErrorTime: 0,
        tripped: false
      });
    }
    return this.circuitBreakers.get(sessionId);
  }

  recordError(sessionId) {
    const cb = this.getCircuitBreaker(sessionId);
    cb.errors++;
    cb.lastErrorTime = Date.now();
    if (cb.errors >= CIRCUIT_BREAKER_THRESHOLD) {
      cb.tripped = true;
      this.log('warn', `Circuit breaker tripped for session ${sessionId} after ${cb.errors} errors`);
    }
    return cb.tripped;
  }

  recordSuccess(sessionId) {
    const cb = this.getCircuitBreaker(sessionId);
    cb.errors = 0;
    cb.tripped = false;
  }

  isCircuitTripped(sessionId) {
    const cb = this.getCircuitBreaker(sessionId);
    if (!cb.tripped) return false;
    // Auto-reset after cooldown
    if (Date.now() - cb.lastErrorTime > CIRCUIT_BREAKER_COOLDOWN_MS) {
      cb.tripped = false;
      cb.errors = 0;
      this.log('info', `Circuit breaker reset for session ${sessionId} after cooldown`);
      return false;
    }
    return true;
  }

  // ===== Session Persistence =====

  persistSession(sessionId) {
    if (!this.sessionsDir) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      this.ensureSessionDir(sessionId);
      const snapshot = createSessionSnapshot(session);
      const messages = normalizeSessionMessages(session.messages);
      fs.writeFileSync(this.getSessionStatePath(sessionId), JSON.stringify(snapshot, null, 2), 'utf-8');
      fs.writeFileSync(this.getSessionMessagesPath(sessionId), JSON.stringify(messages, null, 2), 'utf-8');
    } catch (err) {
      this.log('error', `Failed to persist session ${sessionId}: ${err.message}`);
    }
  }

  loadPersistedSession(sessionId) {
    if (!this.sessionsDir) return null;
    try {
      const statePath = this.getSessionStatePath(sessionId);
      const messagesPath = this.getSessionMessagesPath(sessionId);
      if (!fs.existsSync(statePath)) return null;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const messages = fs.existsSync(messagesPath) ? JSON.parse(fs.readFileSync(messagesPath, 'utf-8')) : [];
      const session = {
        id: state.id,
        mode: state.mode || 'agent',
        messages: Array.isArray(messages) ? messages : [],
        status: 'idle',
        createdAt: state.createdAt || Date.now(),
        title: state.title || 'Restored Session',
        updatedAt: state.updatedAt || state.createdAt || Date.now()
      };
      this.sessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  listPersistedSessions() {
    if (!this.sessionsDir) return [];
    try {
      const dirs = fs.readdirSync(this.sessionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      const sessions = [];
      for (const dir of dirs) {
        try {
          const statePath = path.join(this.sessionsDir, dir.name, 'state.json');
          if (!fs.existsSync(statePath)) continue;
          const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          sessions.push({
            id: data.id,
            mode: data.mode,
            title: data.title || 'Untitled',
            messageCount: data.messageCount || 0,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt || data.createdAt,
            status: data.status || 'idle'
          });
        } catch { /* skip */ }
      }
      sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return sessions;
    } catch {
      return [];
    }
  }

  deletePersistedSession(sessionId) {
    if (!this.sessionsDir) return;
    try {
      const dir = this.getSessionDir(sessionId);
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  // ===== Session Management =====

  createSession(mode = 'agent') {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id,
      mode,
      messages: [],
      status: SESSION_STATUS.IDLE,
      createdAt: Date.now(),
      title: 'New Agent'
    };
    this.sessions.set(id, session);
    this.persistSession(id);
    this.log('info', `Session created: ${id} (mode: ${mode})`);
    return id;
  }

  getSession(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      // Try loading from disk
      session = this.loadPersistedSession(sessionId);
    }
    return session;
  }

  getMessages(sessionId) {
    const session = this.getSession(sessionId);
    return session ? session.messages : [];
  }

  clearSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.status = SESSION_STATUS.IDLE;
      this.persistSession(sessionId);
    }
    this.circuitBreakers.delete(sessionId);
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    this.deletePersistedSession(sessionId);
    this.circuitBreakers.delete(sessionId);
    this.log('info', `Session deleted: ${sessionId}`);
  }

  renameSession(sessionId, title) {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    session.title = String(title || '').trim() || 'Untitled Session';
    this.persistSession(sessionId);
    this.log('info', `Session renamed`, { sessionId, title: session.title });
    return true;
  }

  abort() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
      this.log('info', 'Agent aborted by user');
    }
  }

  async testModel(model) {
    if (!model.apiKey) {
      return { ok: false, error: 'API key is required' };
    }
    if (!model.modelId) {
      return { ok: false, error: 'Model ID is required' };
    }

    try {
      const provider = model.provider || 'openai';
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi, please respond with a short greeting.' }
      ];

      if (provider === 'anthropic') {
        const stream = await callAnthropicStream(model, messages, [], null);
        let text = '';
        for await (const chunk of parseSSEStream(stream, null)) {
          const delta = chunk;
          if (delta.type === 'content_block_delta' && delta.delta?.type === 'text_delta') {
            text += delta.delta.text;
          }
          if (text.length > 50) break;
        }
        return { ok: true, response: text.trim() || 'Got response' };
      } else {
        const stream = await callOpenAIStream(model, messages, [], null);
        let text = '';
        for await (const chunk of parseSSEStream(stream, null)) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) text += delta.content;
          if (text.length > 50) break;
        }
        return { ok: true, response: text.trim() || 'Got response' };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async sendMessage(sessionId, content, attachments = [], onEvent) {
    let session = this.getSession(sessionId);
    if (!session) {
      onEvent({ type: 'error', error: 'Session not found' });
      return;
    }

    // ===== Circuit breaker check =====
    if (this.isCircuitTripped(sessionId)) {
      onEvent({
        type: 'error',
        error: `Circuit breaker is tripped for this session (too many consecutive errors). Please wait ~60s or clear the session.`
      });
      return;
    }

    const model = getCurrentModel(this.config);
    if (!model || !model.apiKey) {
      onEvent({ type: 'error', error: 'Model not configured. Click the settings icon to add a model.' });
      return;
    }

    this.abort();
    this.activeController = new AbortController();
    const { signal } = this.activeController;

    // ===== State machine: IDLE → PROCESSING =====
    session.messages.push({ role: 'user', content, attachments });
    if (!session.title || session.title === 'New Session') {
      session.title = content.slice(0, 60);
    }
    session.status = SESSION_STATUS.PROCESSING;
    this.log('info', `sendMessage start`, { sessionId, mode: session.mode, round: 0 });

    const tools = getToolDefinitions();
    const toolNames = tools.map(t => t.function?.name).filter(Boolean);
    const contextWindow = Number(model.contextWindow) || 128000;
    let round = 0;

    try {
      while (round < MAX_TOOL_ROUNDS) {
        round++;

        if (signal.aborted) break;

        // ===== Context window management =====
        const systemPrompt = buildSystemPrompt(session.mode, this.workspacePath, toolNames);
        const truncatedHistory = truncateMessages(session.messages, contextWindow, systemPrompt);
        const apiMessages = [
          { role: 'system', content: systemPrompt },
          ...truncatedHistory
        ];

        this.log('debug', `LLM call`, {
          round,
          messages: apiMessages.length,
          estimatedTokens: apiMessages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
        });

        const provider = model.provider || 'openai';
        const streamProvider = provider === 'openai' && String(model.endpoint || '').includes('responses')
          ? 'openai-responses'
          : provider;
        const rawStream = streamProvider === 'anthropic'
          ? await callAnthropicStream(model, apiMessages, tools, signal, this.proxyDispatcher)
          : await callOpenAIStream(model, apiMessages, tools, signal, this.proxyDispatcher);

        let assistantContent = '';
        const toolCalls = [];

        for await (const event of normalizeStream(parseSSEStream(rawStream, signal), streamProvider)) {
          if (signal.aborted) break;

          if (event.type === 'text') {
            assistantContent += event.content;
            onEvent({ type: 'text', content: event.content });
          } else if (event.type === 'thinking') {
            onEvent({ type: 'text', content: event.content });
          } else if (event.type === 'tool_call') {
            toolCalls.push({
              id: event.id,
              type: 'function',
              function: { name: event.name, arguments: event.arguments }
            });
            onEvent({ type: 'tool_call', id: event.id, name: event.name, arguments: event.arguments });
          } else if (event.type === 'tool_call_delta') {
            const idx = event.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: event.id || '',
                type: 'function',
                function: { name: '', arguments: '' }
              };
              if (event.id) {
                onEvent({ type: 'tool_call', id: event.id, name: '', arguments: '' });
              }
            }
            if (event.id) toolCalls[idx].id = event.id;
            if (event.name) toolCalls[idx].function.name += event.name;
            if (event.arguments) toolCalls[idx].function.arguments += event.arguments;
          }
        }

        if (signal.aborted) break;

        const assistantMessage = { role: 'assistant' };
        if (assistantContent) {
          assistantMessage.content = assistantContent;
        }
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls.filter(tc => tc && tc.function.name);
        }

        session.messages.push(assistantMessage);

        const workflow = extractWorkflowFromText(assistantContent, session.mode);
        if (workflow && (session.mode === 'plan' || session.mode === 'multitask')) {
          onEvent({
            type: 'workflow',
            mode: session.mode,
            workflow
          });
        }

        if (toolCalls.length === 0 || toolCalls.every(tc => !tc?.function?.name)) {
          session.status = SESSION_STATUS.TURN_ENDED;
          session.status = SESSION_STATUS.IDLE;
          this.recordSuccess(sessionId);
          this.persistSession(sessionId);
          this.log('info', `sendMessage done`, { sessionId, round, toolCalls: 0 });
          onEvent({ type: 'done' });
          return;
        }

        // ===== State machine: PROCESSING → TOOL_CALLING =====
        session.status = SESSION_STATUS.TOOL_CALLING;

        for (const tc of toolCalls) {
          if (!tc?.function?.name) continue;
          if (signal.aborted) break;

          onEvent({
            type: 'tool_call',
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments
          });

          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            // keep empty args
          }

          // Read-only mode enforcement
          const readOnly = session.mode === 'plan' || session.mode === 'ask';
          if (readOnly && WRITE_TOOL_NAMES.has(tc.function.name)) {
            const result = {
              success: false,
              error: `Tool '${tc.function.name}' is not available in ${session.mode} mode (read-only).`
            };
            session.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result)
            });
            onEvent({ type: 'tool_result', id: tc.id, result });
            continue;
          }

          // Execute tool (with retry built into executeTool)
          this.log('debug', `Tool call`, { tool: tc.function.name, args: parsedArgs });
          const result = await executeTool(tc.function.name, parsedArgs, { workspacePath: this.workspacePath });
          const resultStr = result.success ? result.result : `Error: ${result.error}`;

          session.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof resultStr === 'string' ? resultStr : JSON.stringify(resultStr)
          });

          onEvent({ type: 'tool_result', id: tc.id, result });
          this.log('debug', `Tool result`, { tool: tc.function.name, success: result.success });
        }

        if (signal.aborted) break;

        // Persist after each tool round
        this.persistSession(sessionId);

        // ===== State machine: TOOL_CALLING → PROCESSING (next round) =====
        session.status = SESSION_STATUS.PROCESSING;
        onEvent({ type: 'round_end', round });
      }

      if (round >= MAX_TOOL_ROUNDS) {
        onEvent({ type: 'text', content: '\n\n[Agent reached maximum tool call rounds (' + MAX_TOOL_ROUNDS + '). Stopping.]' });
        this.log('warn', `Max tool rounds reached`, { sessionId, round });
      }

      session.status = SESSION_STATUS.IDLE;
      this.recordSuccess(sessionId);
      this.persistSession(sessionId);
      onEvent({ type: 'done' });
    } catch (err) {
      session.status = SESSION_STATUS.ERROR;
      session.status = SESSION_STATUS.IDLE; // reset for next attempt
      if (err.name === 'AbortError') {
        const abortedByUser = Boolean(this.activeController?.signal?.aborted || signal?.aborted);
        if (abortedByUser) {
          onEvent({ type: 'done', aborted: true });
          this.log('info', `sendMessage aborted`, { sessionId, round });
        } else {
          const message = 'LLM request timed out or was interrupted before completion.';
          onEvent({ type: 'error', error: message });
          this.log('error', `sendMessage timeout`, { sessionId, round, error: message });
          this.recordError(sessionId);
        }
      } else {
        // Record error for circuit breaker
        const tripped = this.recordError(sessionId);
        onEvent({ type: 'error', error: err.message || String(err) });
        this.log('error', `sendMessage error`, { sessionId, round, error: err.message, circuitTripped: tripped });
      }
      this.persistSession(sessionId);
    } finally {
      this.activeController = null;
    }
  }
}
