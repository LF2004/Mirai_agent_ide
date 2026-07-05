import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IDE_SETTINGS_DEFAULTS } from '../../type/themes.js';

export class DatabaseService {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.dbFilePath = path.join(userDataPath, 'mirai-agent-ide.db');
    this.agentConfigFilePath = path.join(userDataPath, 'agent-config.json');
    this.database = null;
  }

  async initialize() {
    fs.mkdirSync(this.userDataPath, { recursive: true });
    this.database = new DatabaseSync(this.dbFilePath);

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        last_opened_at TEXT NOT NULL
      );
    `);

    this.ensureDefaultSettings();
  }

  ensureDefaultSettings() {
    const insertSetting = this.database.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `);

    for (const [key, value] of Object.entries({
      lastMode: 'agent',
      lastModel: 'gpt-4.1',
      ...IDE_SETTINGS_DEFAULTS
    })) {
      insertSetting.run(key, JSON.stringify(value));
    }
  }

  getBootstrapState() {
    const recentProjects = this.database
      .prepare(`
        SELECT name, path, last_opened_at AS lastOpenedAt
        FROM recent_projects
        ORDER BY datetime(last_opened_at) DESC
        LIMIT 8
      `)
      .all();

    const settingsRows = this.database.prepare(`SELECT key, value FROM settings`).all();
    const settings = settingsRows.reduce((result, row) => {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
      return result;
    }, {});

    return { recentProjects, settings };
  }

  getSetting(key, fallbackValue = null) {
    const row = this.database
      .prepare(`
        SELECT value
        FROM settings
        WHERE key = ?
      `)
      .get(key);

    if (!row) {
      return fallbackValue;
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value ?? fallbackValue;
    }
  }

  saveSetting(key, value) {
    this.database
      .prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, JSON.stringify(value));

    return {
      success: true,
      key,
      value
    };
  }

  // ===== Agent config =====

  getAgentConfig() {
    const row = this.database
      .prepare(`SELECT value FROM settings WHERE key = 'agentConfig'`)
      .get();
    if (!row) {
      if (fs.existsSync(this.agentConfigFilePath)) {
        try {
          return JSON.parse(fs.readFileSync(this.agentConfigFilePath, 'utf-8'));
        } catch {
          return null;
        }
      }
      return null;
    }
    try {
      return JSON.parse(row.value);
    } catch {
      try {
        if (fs.existsSync(this.agentConfigFilePath)) {
          return JSON.parse(fs.readFileSync(this.agentConfigFilePath, 'utf-8'));
        }
      } catch {
        return null;
      }
      return null;
    }
  }

  saveAgentConfig(config) {
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true });
      fs.writeFileSync(this.agentConfigFilePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch {
      // ignore file backup failures if SQLite write succeeds
    }
    return this.saveSetting('agentConfig', config);
  }

  // ===== Layout state =====

  getLayoutState() {
    const row = this.database
      .prepare(`SELECT value FROM settings WHERE key = 'layoutState'`)
      .get();
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  saveLayoutState(state) {
    return this.saveSetting('layoutState', state);
  }

  saveRecentProject(project) {
    this.database
      .prepare(`
        INSERT INTO recent_projects (name, path, last_opened_at)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          last_opened_at = excluded.last_opened_at
      `)
      .run(project.name, project.path, new Date().toISOString());
  }
}
