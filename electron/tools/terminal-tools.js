import * as pty from 'node-pty';

let nextTerminalId = 1;

export class TerminalTools {
  constructor() {
    this.terminals = new Map();
  }

  createTerminal({ cwd, name } = {}) {
    const terminalId = `terminal-${nextTerminalId++}`;
    const terminalCwd = cwd || process.cwd();

    const shell = process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const child = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 120,
      rows: 32,
      cwd: terminalCwd,
      env: process.env
    });

    const terminal = {
      id: terminalId,
      name: name || `Terminal ${this.terminals.size + 1}`,
      cwd: terminalCwd,
      createdAt: new Date().toISOString(),
      process: child,
      buffer: [],
      alive: true
    };

    child.onData((chunk) => {
      terminal.buffer.push(chunk);
    });

    child.onExit(({ exitCode }) => {
      terminal.alive = false;
      terminal.buffer.push(`\r\n[process exited with code ${exitCode ?? 0}]\r\n`);
    });

    this.terminals.set(terminalId, terminal);
    return this.serializeTerminal(terminal);
  }

  listTerminals() {
    return Array.from(this.terminals.values()).map((terminal) => this.serializeTerminal(terminal));
  }

  focusTerminal(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error('Terminal does not exist.');
    }

    return this.serializeTerminal(terminal);
  }

  write(terminalId, value) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal?.process?.write) {
      throw new Error('Terminal is not available.');
    }

    terminal.process.write(value);
    return { success: true };
  }

  kill(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { success: true };
    }

    terminal.process.kill();
    this.terminals.delete(terminalId);
    return { success: true };
  }

  read(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { id: terminalId, buffer: '' };
    }

    const buffer = terminal.buffer.join('');
    terminal.buffer = [];
    return {
      ...this.serializeTerminal(terminal),
      buffer
    };
  }

  serializeTerminal(terminal) {
    return {
      id: terminal.id,
      name: terminal.name,
      cwd: terminal.cwd,
      createdAt: terminal.createdAt,
      exited: !terminal.alive
    };
  }
}
