/**
 * Database abstraction — PG or SQLite based on config
 *
 * Usage:
 *   import { getDb, query } from './db.js';
 *   const rows = await query('SELECT * FROM tasks WHERE status = $1', ['pending']);
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

let _db = null;
let _type = null; // 'pg' | 'sqlite'

/**
 * Initialize database connection based on config
 */
export async function initDb(config = {}) {
  const dbConfig = config.database || {};
  _type = dbConfig.type || (process.env.PG_PASSWORD ? 'pg' : 'sqlite');

  if (_type === 'pg') {
    const pg = await import('pg');
    const { Pool } = pg.default;
    _db = new Pool({
      host: dbConfig.pg?.host || process.env.PG_HOST || 'localhost',
      port: dbConfig.pg?.port || parseInt(process.env.PG_PORT || '5432'),
      user: dbConfig.pg?.user || process.env.PG_USER || 'helix',
      password: dbConfig.pg?.password || process.env.PG_PASSWORD,
      database: dbConfig.pg?.database || process.env.PG_DB || 'helix',
      max: dbConfig.pg?.max || 10,
    });
    console.log('[db] PostgreSQL connected');
  } else {
    // SQLite via better-sqlite3
    const sqlitePath = dbConfig.path || '.helix/helix.db';
    const dir = dirname(sqlitePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    try {
      const Database = (await import('better-sqlite3')).default;
      _db = new Database(sqlitePath);
      _db.pragma('journal_mode = WAL');
      _db.pragma('foreign_keys = ON');
      await initSqliteSchema(_db);
      console.log(`[db] SQLite connected: ${sqlitePath}`);
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
        console.error('[db] better-sqlite3 not installed. Run: npm install better-sqlite3');
        console.error('[db] Or switch to PostgreSQL in helix.config.js');
        process.exit(1);
      }
      throw e;
    }
  }

  return { type: _type, db: _db };
}

/**
 * Query abstraction — works with both PG and SQLite
 * Uses $1, $2... parameter style (PG native, converted for SQLite)
 */
export async function query(sql, params = []) {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');

  if (_type === 'pg') {
    const result = await _db.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  // SQLite: convert $1 $2 to ? ? and handle
  const sqliteSQL = sql.replace(/\$(\d+)/g, '?');
  const isSelect = /^\s*(SELECT|WITH)\b/i.test(sql);
  const isReturning = /RETURNING/i.test(sql);

  try {
    if (isSelect) {
      const rows = _db.prepare(sqliteSQL).all(...params);
      return { rows, rowCount: rows.length };
    } else if (isReturning) {
      // SQLite doesn't support RETURNING, simulate it
      const cleanSQL = sqliteSQL.replace(/\s+RETURNING\s+.*/i, '');
      const info = _db.prepare(cleanSQL).run(...params);
      // Try to get the inserted/updated row
      if (/^\s*INSERT/i.test(sql)) {
        const rows = [{ id: info.lastInsertRowid }];
        return { rows, rowCount: info.changes };
      }
      return { rows: [], rowCount: info.changes };
    } else {
      const info = _db.prepare(sqliteSQL).run(...params);
      return { rows: [], rowCount: info.changes };
    }
  } catch (e) {
    // Handle PG-specific SQL that SQLite doesn't support
    if (e.message?.includes('no such function: now')) {
      // Replace now() with datetime('now')
      const fixed = sqliteSQL.replace(/now\(\)/g, "datetime('now')");
      return query(sql.replace(/now\(\)/g, "datetime('now')"), params);
    }
    throw e;
  }
}

export function getType() { return _type; }
export function getPool() { return _db; }

/**
 * Initialize SQLite schema — core tables for agent framework
 */
async function initSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      owner TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      source_type TEXT,
      source_id TEXT,
      meta TEXT DEFAULT '{}',
      result TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY,
      role_id TEXT,
      name TEXT,
      key_env TEXT,
      model TEXT,
      system_prompt TEXT,
      status TEXT DEFAULT 'active',
      task TEXT,
      session TEXT DEFAULT '[]',
      memory TEXT DEFAULT '{}',
      token_total INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_active TEXT,
      terminated_at TEXT,
      exit_reason TEXT,
      last_heartbeat TEXT,
      restart_count INTEGER DEFAULT 0,
      capability_set TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cc_id TEXT,
      category TEXT,
      title TEXT,
      content TEXT,
      importance INTEGER DEFAULT 5,
      tags TEXT DEFAULT '[]',
      ref_msg_ids TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      expires_at TEXT,
      embedding TEXT,
      scope_type TEXT,
      scope_id TEXT,
      memory_type TEXT,
      source_ref TEXT,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wiki_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE,
      title TEXT,
      content TEXT,
      category TEXT,
      tags TEXT DEFAULT '[]',
      embedding TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      schedule TEXT,
      kind TEXT DEFAULT 'cron',
      spec TEXT DEFAULT '{}',
      task_template TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      repeat_max INTEGER,
      repeat_done INTEGER DEFAULT 0,
      last_run_at TEXT,
      next_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      risk_level TEXT DEFAULT 'info',
      path TEXT,
      actor TEXT,
      actor_context TEXT DEFAULT '{}',
      status TEXT,
      notes TEXT,
      ts TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      nodes TEXT DEFAULT '[]',
      agent_ids TEXT DEFAULT '[]',
      capability_ids TEXT DEFAULT '[]',
      risk_summary TEXT DEFAULT '{}',
      graph_summary TEXT DEFAULT '{}',
      execution_preview TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id INTEGER,
      status TEXT DEFAULT 'pending',
      triggered_by TEXT DEFAULT 'manual',
      input TEXT DEFAULT '{}',
      output TEXT DEFAULT '{}',
      node_states TEXT DEFAULT '{}',
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS step_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      run_id TEXT,
      step_index INTEGER,
      tool_name TEXT,
      agent_id TEXT,
      params TEXT DEFAULT '{}',
      result TEXT DEFAULT '{}',
      status TEXT DEFAULT 'completed',
      duration_ms INTEGER,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Context OS: Session Store
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      parent_session_id TEXT,
      system_prompt TEXT,
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      message_count INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      summary_snapshot TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      token_estimate INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, created_at);

    -- FTS5 for message content search (SQLite)
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='id'
    );

    -- Trigger to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
}

export default { initDb, query, getType, getPool };
