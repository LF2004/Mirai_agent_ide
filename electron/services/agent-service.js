import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { readWorkspaceFile, writeWorkspaceFile, resolveInsideWorkspace } from '../tools/file-tools.js';

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

const SYSTEM_PROMPT_BASE = `You are Mirai Agent, an expert AI coding assistant integrated into the Mirai Agent IDE.
You help users with software development tasks: writing code, debugging, refactoring, explaining, and more.

You have access to tools for reading and modifying files in the user's workspace.
Always use tools to inspect the codebase before making changes.
When making file changes, always read the file first, then write the complete modified content.

Be concise and direct. Use markdown formatting for code blocks.
When you encounter errors, explain what went wrong and suggest fixes.`;

const MODE_PROMPTS = {
  agent: 'You are in Agent mode. You can read, write, and modify files, run commands, and make changes to the codebase autonomously. Always verify your changes work.',
  plan: 'You are in Plan mode. Only READ files and analyze the codebase. Do NOT make any changes. Provide a detailed plan of action with steps.',
  ask: 'You are in Ask mode. Answer questions about the codebase by reading files. Do NOT make any changes. Be educational and explain concepts clearly.',
  debug: 'You are in Debug mode. Focus on finding and fixing bugs. Read error messages, trace code paths, and propose targeted fixes.',
  multitask: 'You are in Multitask mode. Break complex tasks into subtasks, execute them in order, and summarize results.'
};

const MAX_TOOL_ROUNDS = 20;
const LLM_TIMEOUT_MS = 120000;
const TOOL_TIMEOUT_MS = 30000;
const TOOL_RETRY_COUNT = 1;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60000;

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

/**
 * Load skill prompts from skills/ directory in the workspace.
 * Each .md file in skills/ becomes a skill prompt.
 */
function loadSkills(workspacePath) {
  if (!workspacePath) return [];
  const skillsDir = path.join(workspacePath, 'skills');
  const skills = [];
  try {
    if (!fs.existsSync(skillsDir)) return skills;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(path.join(skillsDir, entry.name), 'utf-8');
          const name = entry.name.replace(/\.md$/, '');
          skills.push({ name, content: content.slice(0, 2000) }); // cap at 2k chars per skill
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return skills;
}

function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the content of a file in the workspace. Returns the file content as text.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative or absolute path to the file' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file in the workspace. Creates the file if it does not exist, overwrites if it does.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative or absolute path to the file' },
            content: { type: 'string', description: 'The full content to write to the file' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories in a given path. Returns names and types.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list (default: workspace root)', default: '' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for text patterns in files using regex. Returns matching lines with file paths and line numbers.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regular expression pattern to search for' },
            path: { type: 'string', description: 'Directory to search in (default: workspace root)', default: '' },
            glob: { type: 'string', description: 'File glob pattern to filter (e.g. "*.js")', default: '' }
          },
          required: ['pattern']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command in the workspace directory. Returns stdout, stderr, and exit code. Use sparingly and with caution.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a new file with the given content. Fails if the file already exists.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path for the new file' },
            content: { type: 'string', description: 'Content for the new file' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file from the workspace. Use with caution.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to delete' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_workspace_info',
        description: 'Get information about the current workspace: root path, name, and top-level file tree.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];
}

async function executeTool(toolName, args, workspacePath) {
  const maxRetries = TOOL_RETRY_COUNT;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeToolOnce(toolName, args, workspacePath);
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
  return formatError(lastError?.message || 'Tool execution failed after retries');
}

async function executeToolOnce(toolName, args, workspacePath) {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = resolveFilePath(args.path, workspacePath);
        if (!filePath) return formatError('Invalid or unsafe file path');
        const content = readWorkspaceFile(workspacePath, filePath);
        if (content === null) return formatError(`File not found: ${args.path}`);
        return { success: true, result: content };
      }
      case 'write_file': {
        const filePath = resolveFilePath(args.path, workspacePath);
        if (!filePath) return formatError('Invalid or unsafe file path');
        writeWorkspaceFile(workspacePath, filePath, args.content || '');
        return { success: true, result: `File written: ${args.path}` };
      }
      case 'list_files': {
        const dirPath = resolveFilePath(args.path || '', workspacePath);
        if (!dirPath) return formatError('Invalid path');
        const fullPath = path.join(workspacePath, dirPath);
        if (!fs.existsSync(fullPath)) return formatError(`Directory not found: ${args.path}`);
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const items = entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        return { success: true, result: JSON.stringify(items, null, 2) };
      }
      case 'search_files': {
        const searchDir = resolveFilePath(args.path || '', workspacePath);
        if (!searchDir) return formatError('Invalid search path');
        const results = await grepRecursive(
          path.join(workspacePath, searchDir),
          args.pattern,
          args.glob || ''
        );
        return { success: true, result: results || 'No matches found' };
      }
      case 'run_command': {
        const result = await runShellCommand(args.command, workspacePath);
        return { success: result.code === 0, result: result.output };
      }
      case 'create_file': {
        const filePath = resolveFilePath(args.path, workspacePath);
        if (!filePath) return formatError('Invalid file path');
        const fullPath = path.join(workspacePath, filePath);
        if (fs.existsSync(fullPath)) return formatError(`File already exists: ${args.path}`);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content || '', 'utf-8');
        return { success: true, result: `File created: ${args.path}` };
      }
      case 'delete_file': {
        const filePath = resolveFilePath(args.path, workspacePath);
        if (!filePath) return formatError('Invalid file path');
        const fullPath = path.join(workspacePath, filePath);
        if (!fs.existsSync(fullPath)) return formatError(`File not found: ${args.path}`);
        fs.unlinkSync(fullPath);
        return { success: true, result: `File deleted: ${args.path}` };
      }
      case 'get_workspace_info': {
        if (!workspacePath) return formatError('No workspace open');
        const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
        const topFiles = entries
          .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
          .join('\n');
        return { success: true, result: `Workspace: ${path.basename(workspacePath)}\nPath: ${workspacePath}\n\nTop-level:\n${topFiles}` };
      }
      default:
        return formatError(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    return formatError(err.message || String(err));
  }
}

function resolveFilePath(inputPath, workspacePath) {
  if (!inputPath) return '';
  const p = String(inputPath).replace(/\\/g, '/');
  if (path.isAbsolute(p)) {
    try {
      const resolved = path.resolve(p);
      resolveInsideWorkspace(workspacePath, resolved);
      return path.relative(workspacePath, resolved);
    } catch {
      return '';
    }
  }
  return p.replace(/^\.\//, '');
}

function formatError(message) {
  return { success: false, error: message };
}

async function grepRecursive(dirPath, pattern, glob) {
  const regex = new RegExp(pattern, 'i');
  const results = [];
  const maxResults = 100;
  let count = 0;

  function search(dir) {
    if (count >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= maxResults) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        search(fullPath);
      } else if (entry.isFile()) {
        if (glob && !matchGlob(entry.name, glob)) continue;
        if (!isTextFile(entry.name)) continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const relPath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
              count++;
              if (count >= maxResults) break;
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
  }

  search(dirPath);
  if (results.length === 0) return '';
  return results.join('\n') + (count >= maxResults ? '\n... (truncated at 100 results)' : '');
}

function matchGlob(filename, pattern) {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`, 'i').test(filename);
}

function isTextFile(filename) {
  const textExts = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.json', '.jsonc', '.md', '.mdx',
    '.html', '.htm', '.css', '.scss', '.less', '.yml', '.yaml', '.txt', '.xml',
    '.cjs', '.mjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.cfg', '.conf', '.env'];
  const ext = path.extname(filename).toLowerCase();
  return textExts.includes(ext) || !ext;
}

function runShellCommand(command, cwd) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ code: 124, output: 'Command timed out after 30s' });
    }, TOOL_TIMEOUT_MS);

    exec(command, { cwd, maxBuffer: 1024 * 1024 * 5, timeout: TOOL_TIMEOUT_MS }, (error, stdout, stderr) => {
      clearTimeout(timer);
      const output = [stdout, stderr].filter(Boolean).join('\n') || '(no output)';
      resolve({
        code: error ? (error.code || 1) : 0,
        output: output
      });
    });
  });
}

/**
 * Build layered system prompt:
 *   Layer 1: Base role definition
 *   Layer 2: Mode-specific guidance
 *   Layer 3: Project context (AGENTS.md/.cursorrules/package.json)
 *   Layer 4: Skills (from skills/ directory)
 *   Layer 5: Tool schemas
 *   Layer 6: Task-specific instructions
 */
function buildSystemPrompt(mode, workspacePath, workspaceName) {
  // Layer 1: Base
  let prompt = SYSTEM_PROMPT_BASE;

  // Layer 2: Mode
  if (mode && MODE_PROMPTS[mode]) {
    prompt += '\n\n' + MODE_PROMPTS[mode];
  }

  // Layer 3: Project context
  if (workspacePath) {
    prompt += `\n\nCurrent workspace: ${workspaceName || path.basename(workspacePath)}`;
    prompt += `\nWorkspace path: ${workspacePath}`;

    const contextFiles = ['AGENTS.md', '.cursorrules', 'CLAUDE.md'];
    for (const cf of contextFiles) {
      const cfPath = path.join(workspacePath, cf);
      if (fs.existsSync(cfPath)) {
        try {
          const content = fs.readFileSync(cfPath, 'utf-8');
          prompt += `\n\nProject context from ${cf}:\n${content}`;
          break;
        } catch { /* skip */ }
      }
    }

    const pkgPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        prompt += `\n\nProject: ${pkg.name || 'unnamed'}`;
        if (pkg.description) prompt += `\nDescription: ${pkg.description}`;
        if (pkg.type) prompt += `\nModule type: ${pkg.type}`;
        if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
          prompt += `\nScripts: ${Object.keys(pkg.scripts).join(', ')}`;
        }
        if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
          const deps = Object.keys(pkg.dependencies).slice(0, 20);
          prompt += `\nDependencies: ${deps.join(', ')}`;
        }
      } catch { /* skip */ }
    }
  }

  // Layer 4: Skills
  const skills = loadSkills(workspacePath);
  if (skills.length > 0) {
    prompt += '\n\n--- Skills ---';
    for (const skill of skills) {
      prompt += `\n\n## Skill: ${skill.name}\n${skill.content}`;
    }
  }

  // Layer 5: Tool schemas
  prompt += '\n\nAvailable tools: read_file, write_file, list_files, search_files, run_command, create_file, delete_file, get_workspace_info';

  // Layer 6: Task-specific
  if (mode === 'multitask') {
    prompt += '\n\nFor complex tasks, break them into subtasks. Complete each subtask before moving to the next. Summarize what you did after all subtasks are done.';
  } else if (mode === 'debug') {
    prompt += '\n\nWhen debugging: 1) Read the error message carefully, 2) Find the relevant code, 3) Identify the root cause, 4) Propose a targeted fix, 5) Verify the fix would work.';
  }

  return prompt;
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
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call OpenAI-compatible chat completions streaming API
 */
async function callOpenAIStream(model, messages, tools, signal) {
  const baseUrl = (model.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = model.endpoint || '/v1/chat/completions';
  const url = `${baseUrl}${endpoint}`;

  const body = {
    model: model.modelId,
    messages,
    stream: true,
    max_tokens: Number(model.maxOutputTokens) || 4096
  };

  const extraParams = model.extraParamsEnabled ? safeParseJSON(model.extraParams) : {};
  if (model.provider === 'openai' && model.reasoningStrength && model.reasoningStrength !== 'none') {
    // For reasoning models, map reasoningStrength to effort if supported
    body.reasoning_effort = model.reasoningStrength;
  }
  Object.assign(body, extraParams);

  if (tools && tools.length > 0 && endpoint.includes('chat/completions')) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${model.apiKey || ''}`
  };
  const customHeaders = model.customHeadersEnabled ? safeParseJSON(model.customHeaders) : {};
  Object.assign(headers, customHeaders);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal
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
async function callAnthropicStream(model, messages, tools, signal) {
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

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal
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
    this.config = {
      selectedModelId: '',
      models: []
    };
    this.sessions = new Map();
    this.activeController = null;
    this.workspacePath = '';
    this.workspaceName = '';

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
  }

  // ===== Diagnostics =====

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
    return [...this.diagnostics];
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
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      const data = {
        id: session.id,
        mode: session.mode,
        messages: session.messages,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        title: session.title || (session.messages[0]?.content?.slice(0, 60) || 'New Session')
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      this.log('error', `Failed to persist session ${sessionId}: ${err.message}`);
    }
  }

  loadPersistedSession(sessionId) {
    if (!this.sessionsDir) return null;
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      if (!fs.existsSync(filePath)) return null;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const session = {
        id: data.id,
        mode: data.mode || 'agent',
        messages: data.messages || [],
        status: 'idle',
        createdAt: data.createdAt || Date.now(),
        title: data.title || 'Restored Session'
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
      const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
      const sessions = [];
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8'));
          sessions.push({
            id: data.id,
            mode: data.mode,
            title: data.title || 'Untitled',
            messageCount: (data.messages || []).length,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt || data.createdAt
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
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  // ===== Config =====

  setWorkspace(wsPath, wsName) {
    this.workspacePath = wsPath || '';
    this.workspaceName = wsName || '';
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  // ===== Session Management =====

  createSession(mode = 'agent') {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(id, {
      id,
      mode,
      messages: [],
      status: SESSION_STATUS.IDLE,
      createdAt: Date.now(),
      title: 'New Session'
    });
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

  async sendMessage(sessionId, content, onEvent) {
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
    session.messages.push({ role: 'user', content });
    if (!session.title || session.title === 'New Session') {
      session.title = content.slice(0, 60);
    }
    session.status = SESSION_STATUS.PROCESSING;
    this.log('info', `sendMessage start`, { sessionId, mode: session.mode, round: 0 });

    const tools = getToolDefinitions();
    const contextWindow = Number(model.contextWindow) || 128000;
    let round = 0;

    try {
      while (round < MAX_TOOL_ROUNDS) {
        round++;

        if (signal.aborted) break;

        // ===== Context window management =====
        const systemPrompt = buildSystemPrompt(session.mode, this.workspacePath, this.workspaceName);
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
        const rawStream = provider === 'anthropic'
          ? await callAnthropicStream(model, apiMessages, tools, signal)
          : await callOpenAIStream(model, apiMessages, tools, signal);

        let assistantContent = '';
        const toolCalls = [];

        for await (const event of normalizeStream(parseSSEStream(rawStream, signal), provider)) {
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

        // No tool calls → turn ended
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
          const writeTools = ['write_file', 'create_file', 'delete_file', 'run_command'];
          if (readOnly && writeTools.includes(tc.function.name)) {
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
          const result = await executeTool(tc.function.name, parsedArgs, this.workspacePath);
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
        onEvent({ type: 'done', aborted: true });
        this.log('info', `sendMessage aborted`, { sessionId, round });
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
