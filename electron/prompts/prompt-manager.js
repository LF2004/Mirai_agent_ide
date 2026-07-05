import fs from 'node:fs';
import path from 'node:path';

const SYSTEM_PROMPT_BASE = `You are Mirai Agent, an expert AI coding assistant integrated into the Mirai Agent IDE.
You help users with software development tasks: writing code, debugging, refactoring, explaining, and more.

You have access to tools for reading and modifying files in the user's workspace.
Always use tools to inspect the codebase before making changes.
When making file changes, always read the file first, then write the complete modified content.

Be concise and direct. Use markdown formatting for code blocks.
When you encounter errors, explain what went wrong and suggest fixes.`;

const MODE_PROMPTS = {
  agent: 'You are in Agent mode. You can read, write, and modify files, run commands, and make changes to the codebase autonomously. Plan before editing, verify after editing, and prefer small safe steps.',
  plan: 'You are in Plan mode. Only read files and analyze the codebase. Do not make changes. Produce a concrete execution plan with risks, dependencies, and next steps.',
  ask: 'You are in Ask mode. Answer questions about the codebase by reading files. Do not make changes. Explain clearly and keep answers grounded in the repository.',
  debug: 'You are in Debug mode. Focus on finding and fixing bugs. Read error messages, trace code paths, identify root cause, and verify the fix path before editing.',
  multitask: 'You are in Multitask mode. Break complex work into subtasks, order them by dependency, execute one subtask at a time, and summarize progress after each stage.'
};

export const MODES = Object.keys(MODE_PROMPTS);

/**
 * Load skill prompts from the workspace skills/ directory.
 * Each .md file becomes a skill prompt.
 */
export function loadSkills(workspacePath) {
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
          skills.push({ name, content: content.slice(0, 2000) });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return skills;
}

function loadProjectContext(workspacePath) {
  if (!workspacePath) return '';

  let context = `\n\nCurrent workspace: ${path.basename(workspacePath)}`;
  context += `\nWorkspace path: ${workspacePath}`;

  const contextFiles = ['AGENTS.md', '.cursorrules', 'CLAUDE.md'];
  for (const cf of contextFiles) {
    const cfPath = path.join(workspacePath, cf);
    if (fs.existsSync(cfPath)) {
      try {
        const content = fs.readFileSync(cfPath, 'utf-8');
        context += `\n\nProject context from ${cf}:\n${content}`;
        break;
      } catch { /* skip */ }
    }
  }

  const pkgPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      context += `\n\nProject: ${pkg.name || 'unnamed'}`;
      if (pkg.description) context += `\nDescription: ${pkg.description}`;
      if (pkg.type) context += `\nModule type: ${pkg.type}`;
      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        context += `\nScripts: ${Object.keys(pkg.scripts).join(', ')}`;
      }
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        const deps = Object.keys(pkg.dependencies).slice(0, 20);
        context += `\nDependencies: ${deps.join(', ')}`;
      }
    } catch { /* skip */ }
  }

  return context;
}

function loadSkillsContext(workspacePath) {
  const skills = loadSkills(workspacePath);
  if (skills.length === 0) return '';

  let context = '\n\n--- Skills ---';
  for (const skill of skills) {
    context += `\n\n## Skill: ${skill.name}\n${skill.content}`;
  }
  return context;
}

function buildToolContext(toolNames) {
  return `\n\nAvailable tools: ${toolNames.join(', ')}`;
}

function buildTaskContext(mode) {
  if (mode === 'plan') {
    return '\n\nPlanning rules: inspect the minimum necessary files, identify the safest implementation path, and return JSON with title, steps, risks, and verification checkpoints.';
  }
  if (mode === 'ask') {
    return '\n\nAnswering rules: prefer precise explanations, mention relevant files or functions, and avoid speculation when the repository already has the answer.';
  }
  if (mode === 'multitask') {
    return '\n\nExecution rules: create a small task graph, work in dependency order, keep subtask outputs short, and emit JSON workflow updates so the UI can render subtasks.';
  }
  if (mode === 'debug') {
    return '\n\nDebugging rules: 1) read the exact error or symptom, 2) isolate the likely code path, 3) identify the root cause, 4) patch the smallest correct fix, 5) verify the impact.';
  }
  return '';
}

/**
 * Build a layered system prompt:
 *   Layer 1: Base role definition
 *   Layer 2: Mode-specific guidance
 *   Layer 3: Project context
 *   Layer 4: Skills
 *   Layer 5: Tool schemas (tool names only)
 *   Layer 6: Task-specific instructions
 */
export function buildSystemPrompt(mode, workspacePath, toolNames = []) {
  let prompt = SYSTEM_PROMPT_BASE;

  if (mode && MODE_PROMPTS[mode]) {
    prompt += '\n\n' + MODE_PROMPTS[mode];
  }

  prompt += loadProjectContext(workspacePath);
  prompt += loadSkillsContext(workspacePath);
  prompt += buildToolContext(toolNames);
  prompt += buildTaskContext(mode);

  return prompt;
}
