import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { readWorkspaceFile, writeWorkspaceFile, resolveInsideWorkspace } from '../tools/file-tools.js';

/**
 * AgentService — Core Agent engine for Mirai Agent IDE
 *
 * Architecture:
 *   - LLM Client: OpenAI-compatible streaming API (SSE)
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

/**
 * Built-in tool definitions (OpenAI function-calling format)
 */
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

/**
 * Execute a single tool call
 */
async function executeTool(toolName, args, workspacePath) {
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
  // If absolute and inside workspace, use it
  if (path.isAbsolute(p)) {
    try {
      const resolved = path.resolve(p);
      resolveInsideWorkspace(workspacePath, resolved);
      return path.relative(workspacePath, resolved);
    } catch {
      return '';
    }
  }
  // Relative path — strip leading ./
  return p.replace(/^\.\//, '');
}

function formatError(message) {
  return { success: false, error: message };
}

/**
 * Recursive grep using simple regex matching
 */
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

/**
 * Run a shell command with timeout
 */
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
 * Build the system prompt with project context
 */
function buildSystemPrompt(mode, workspacePath, workspaceName) {
  let prompt = SYSTEM_PROMPT_BASE;

  if (mode && MODE_PROMPTS[mode]) {
    prompt += '\n\n' + MODE_PROMPTS[mode];
  }

  if (workspacePath) {
    prompt += `\n\nCurrent workspace: ${workspaceName || path.basename(workspacePath)}`;
    prompt += `\nWorkspace path: ${workspacePath}`;

    // Try to read AGENTS.md or .cursorrules for project context
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

    // Try to read package.json for project info
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

  prompt += '\n\nAvailable tools: read_file, write_file, list_files, search_files, run_command, create_file, delete_file, get_workspace_info';
  return prompt;
}

/**
 * Call LLM API with streaming (OpenAI-compatible)
 */
async function callLLMStream(config, messages, tools, signal) {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model: config.model,
    messages: messages,
    stream: true,
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 4096
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
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
 * Parse SSE stream from OpenAI-compatible API
 */
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
 * AgentService class
 */
export class AgentService {
  constructor(databaseService) {
    this.db = databaseService;
    this.config = {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096
    };
    this.sessions = new Map();
    this.activeController = null;
    this.workspacePath = '';
    this.workspaceName = '';
  }

  setWorkspace(wsPath, wsName) {
    this.workspacePath = wsPath || '';
    this.workspaceName = wsName || '';
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  getConfig() {
    return { ...this.config };
  }

  createSession(mode = 'agent') {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(id, {
      id,
      mode,
      messages: [],
      status: 'idle',
      createdAt: Date.now()
    });
    return id;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getMessages(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.messages : [];
  }

  clearSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.status = 'idle';
    }
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  abort() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  /**
   * Send a message to the agent and stream responses via callback
   * @param {string} sessionId - Session ID
   * @param {string} content - User message content
   * @param {function} onEvent - Callback for events: { type: 'text'|'tool_call'|'tool_result'|'error'|'done', ... }
   */
  async sendMessage(sessionId, content, onEvent) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      onEvent({ type: 'error', error: 'Session not found' });
      return;
    }

    if (!this.config.apiKey) {
      onEvent({ type: 'error', error: 'API key not configured. Click the settings icon to configure.' });
      return;
    }

    // Abort any existing request
    this.abort();
    this.activeController = new AbortController();
    const { signal } = this.activeController;

    // Add user message to session
    session.messages.push({ role: 'user', content });
    session.status = 'processing';

    const tools = getToolDefinitions();
    let round = 0;

    try {
      while (round < MAX_TOOL_ROUNDS) {
        round++;

        if (signal.aborted) break;

        // Build messages for this round
        const systemPrompt = buildSystemPrompt(session.mode, this.workspacePath, this.workspaceName);
        const apiMessages = [
          { role: 'system', content: systemPrompt },
          ...session.messages
        ];

        // Call LLM
        const stream = await callLLMStream(this.config, apiMessages, tools, signal);

        // Parse streaming response
        let assistantContent = '';
        const toolCalls = [];
        let currentToolCall = null;

        for await (const chunk of parseSSEStream(stream, signal)) {
          if (signal.aborted) break;

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            assistantContent += delta.content;
            onEvent({ type: 'text', content: delta.content });
          }

          // Tool calls (streaming)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        }

        if (signal.aborted) break;

        // Build assistant message for session
        const assistantMessage = { role: 'assistant' };
        if (assistantContent) {
          assistantMessage.content = assistantContent;
        }
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls.filter(tc => tc && tc.function.name);
        }

        session.messages.push(assistantMessage);

        // If no tool calls, we're done
        if (toolCalls.length === 0 || toolCalls.every(tc => !tc?.function?.name)) {
          session.status = 'idle';
          onEvent({ type: 'done' });
          return;
        }

        // Execute tool calls
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

          // In plan/ask mode, only allow read-only tools
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

          const result = await executeTool(tc.function.name, parsedArgs, this.workspacePath);
          const resultStr = result.success ? result.result : `Error: ${result.error}`;

          session.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultStr
          });

          onEvent({ type: 'tool_result', id: tc.id, result });
        }

        if (signal.aborted) break;

        // Loop continues — LLM will process tool results
        onEvent({ type: 'round_end', round });
      }

      if (round >= MAX_TOOL_ROUNDS) {
        onEvent({ type: 'text', content: '\n\n[Agent reached maximum tool call rounds (' + MAX_TOOL_ROUNDS + '). Stopping.]' });
      }

      session.status = 'idle';
      onEvent({ type: 'done' });
    } catch (err) {
      session.status = 'idle';
      if (err.name === 'AbortError') {
        onEvent({ type: 'done', aborted: true });
      } else {
        onEvent({ type: 'error', error: err.message || String(err) });
      }
    } finally {
      this.activeController = null;
    }
  }
}
