import { runShellCommand, formatError } from './utils.js';

export const name = 'run_command';

export const definition = {
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
};

export async function execute(args, context) {
  const workspacePath = context?.workspacePath || '';
  try {
    const result = await runShellCommand(args.command, workspacePath);
    return { success: result.code === 0, result: result.output };
  } catch (err) {
    return formatError(err.message || String(err));
  }
}
