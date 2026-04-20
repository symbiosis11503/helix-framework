/**
 * Trace Lite — Lightweight observability for B version
 *
 * Provides run/span-based tracing compatible with db.js (PG + SQLite).
 * Simplified version of A's trace.js — no EventEmitter, no prompt bindings,
 * but covers the core: runs, spans, metrics, query.
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Init ==========

export async function initTraceTables() {
  const isPg = getType() === 'pg';

  await query(`
    CREATE TABLE IF NOT EXISTS trace_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      session_id TEXT,
      source TEXT DEFAULT 'helix',
      status TEXT DEFAULT 'running',
      metadata TEXT,
      started_at TEXT,
      ended_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS trace_spans (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_span_id TEXT,
      span_type TEXT NOT NULL,
      name TEXT,
      agent_id TEXT,
      tool_name TEXT,
      model TEXT,
      status TEXT DEFAULT 'running',
      input_text TEXT,
      output_text TEXT,
      error_text TEXT,
      duration_ms INTEGER,
      started_at TEXT,
      ended_at TEXT
    )
  `);

  if (isPg) {
    await query(`
      CREATE TABLE IF NOT EXISTS trace_metrics (
        id SERIAL PRIMARY KEY,
        span_id TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        latency_ms INTEGER DEFAULT 0
      )
    `);
  } else {
    await query(`
      CREATE TABLE IF NOT EXISTS trace_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        span_id TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        latency_ms INTEGER DEFAULT 0
      )
    `);
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_trace_runs_agent ON trace_runs(agent_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_trace_spans_run ON trace_spans(run_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_trace_runs_started ON trace_runs(started_at DESC)`);

  // 2026-04-20 D1: additive eval_score columns (per spec docs/reports/14_*)
  // Wrap each ALTER in try/catch — IF NOT EXISTS isn't supported on SQLite ADD COLUMN,
  // and PG already-existing column would just be a no-op.
  if (isPg) {
    try { await query(`ALTER TABLE trace_runs ADD COLUMN IF NOT EXISTS eval_score JSONB`); } catch {}
    try { await query(`ALTER TABLE trace_runs ADD COLUMN IF NOT EXISTS eval_scored_at TIMESTAMPTZ`); } catch {}
    try { await query(`ALTER TABLE trace_runs ADD COLUMN IF NOT EXISTS eval_version TEXT`); } catch {}
  } else {
    // SQLite: probe info_schema then conditional add
    try {
      const cols = await query(`PRAGMA table_info(trace_runs)`);
      const has = (n) => (cols.rows || cols).some(r => (r.name || r.NAME) === n);
      if (!has('eval_score')) await query(`ALTER TABLE trace_runs ADD COLUMN eval_score TEXT`);
      if (!has('eval_scored_at')) await query(`ALTER TABLE trace_runs ADD COLUMN eval_scored_at TEXT`);
      if (!has('eval_version')) await query(`ALTER TABLE trace_runs ADD COLUMN eval_version TEXT`);
    } catch {}
  }
  await query(`CREATE INDEX IF NOT EXISTS idx_trace_runs_eval_scored ON trace_runs(eval_scored_at DESC)`);
}

// ========== Helpers ==========

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nowExpr() {
  return getType() === 'pg' ? 'now()' : "datetime('now')";
}

function truncate(str, max = 2000) {
  if (!str) return null;
  const s = typeof str === 'string' ? str : JSON.stringify(str);
  return s.length > max ? s.slice(0, max) : s;
}

// ========== Run Lifecycle ==========

/**
 * Start a new trace run
 */
export async function startRun({ agentId = null, sessionId = null, source = 'helix', metadata = {} } = {}) {
  const id = genId('run');
  await query(
    `INSERT INTO trace_runs (id, agent_id, session_id, source, status, metadata, started_at)
     VALUES ($1, $2, $3, $4, 'running', $5, ${nowExpr()})`,
    [id, agentId, sessionId, source, JSON.stringify(metadata)]
  );
  return { id };
}

/**
 * End a trace run
 */
export async function endRun(runId, { status = 'completed', metadata = null } = {}) {
  const sets = [`status = $1`, `ended_at = ${nowExpr()}`];
  const params = [status];
  let idx = 2;

  if (metadata) {
    sets.push(`metadata = $${idx++}`);
    params.push(JSON.stringify(metadata));
  }

  params.push(runId);
  await query(`UPDATE trace_runs SET ${sets.join(', ')} WHERE id = $${idx}`, params);
}

// ========== Span Lifecycle ==========

/**
 * Start a span within a run
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} opts.spanType - 'tool' | 'llm' | 'reasoning' | 'agent' | 'skill' | 'memory'
 * @param {string} [opts.name]
 * @param {string} [opts.parentSpanId]
 * @param {string} [opts.agentId]
 * @param {string} [opts.toolName]
 * @param {string} [opts.model]
 * @param {*} [opts.input]
 */
export async function startSpan({
  runId, spanType, name = null, parentSpanId = null,
  agentId = null, toolName = null, model = null, input = null,
}) {
  const id = genId('span');
  await query(
    `INSERT INTO trace_spans (id, run_id, parent_span_id, span_type, name, agent_id, tool_name, model, status, input_text, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', $9, ${nowExpr()})`,
    [id, runId, parentSpanId, spanType, name, agentId, toolName, model, truncate(input, 4000)]
  );
  return { id, startTime: Date.now() };
}

/**
 * End a span
 */
export async function endSpan(spanId, { status = 'ok', output = null, error = null, durationMs = null } = {}) {
  await query(
    `UPDATE trace_spans SET status = $1, output_text = $2, error_text = $3, duration_ms = $4, ended_at = ${nowExpr()} WHERE id = $5`,
    [status, truncate(output), truncate(error, 500), durationMs, spanId]
  );
}

/**
 * Convenience: wrap an async function in a span
 */
export async function withSpan(opts, fn) {
  const span = await startSpan(opts);
  const start = Date.now();
  try {
    const result = await fn(span);
    await endSpan(span.id, { status: 'ok', output: result, durationMs: Date.now() - start });
    return result;
  } catch (e) {
    await endSpan(span.id, { status: 'error', error: e.message, durationMs: Date.now() - start });
    throw e;
  }
}

// ========== Metrics ==========

/**
 * Record LLM metrics for a span
 */
export async function recordMetrics(spanId, { provider, model, promptTokens = 0, completionTokens = 0, costUsd = 0, latencyMs = 0 }) {
  await query(
    `INSERT INTO trace_metrics (span_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [spanId, provider, model, promptTokens, completionTokens, promptTokens + completionTokens, costUsd, latencyMs]
  );
}

// ========== Query ==========

/**
 * List completed runs that need eval scoring
 *
 * Returns runs where status='completed' AND (eval_score IS NULL OR eval_version != current).
 * Used by nightly backfill cron + admin /trace/eval/backfill endpoint (per spec 14_*).
 */
export async function listRunsNeedingEval({ limit = 100, evalVersion = null } = {}) {
  let sql = `SELECT * FROM trace_runs WHERE status = 'completed' AND (eval_score IS NULL`;
  const params = [];
  let idx = 1;
  if (evalVersion) { sql += ` OR eval_version IS NULL OR eval_version <> $${idx++}`; params.push(evalVersion); }
  sql += `) ORDER BY started_at DESC LIMIT $${idx}`;
  params.push(limit);
  return (await query(sql, params)).rows;
}

/**
 * List recent runs
 */
export async function listRuns({ agentId = null, limit = 50, status = null } = {}) {
  let sql = 'SELECT * FROM trace_runs WHERE 1=1';
  const params = [];
  let idx = 1;

  if (agentId) { sql += ` AND agent_id = $${idx++}`; params.push(agentId); }
  if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

  sql += ` ORDER BY started_at DESC LIMIT $${idx}`;
  params.push(limit);

  return (await query(sql, params)).rows;
}

/**
 * Get a run with all its spans (eval_score parsed if present)
 */
export async function getRun(runId) {
  const runR = await query('SELECT * FROM trace_runs WHERE id = $1', [runId]);
  if (!runR.rows[0]) return null;

  const run = { ...runR.rows[0] };
  // SQLite stores JSONB as TEXT — parse on read for caller convenience
  if (typeof run.eval_score === 'string' && run.eval_score) {
    try { run.eval_score = JSON.parse(run.eval_score); } catch {}
  }

  const spansR = await query(
    `SELECT s.*, m.prompt_tokens, m.completion_tokens, m.total_tokens, m.cost_usd, m.latency_ms
     FROM trace_spans s
     LEFT JOIN trace_metrics m ON m.span_id = s.id
     WHERE s.run_id = $1
     ORDER BY s.started_at ASC`,
    [runId]
  );

  return { ...run, spans: spansR.rows };
}

/**
 * Attach eval score to a completed trace run (additive, doesn't touch trace truth)
 * Per spec docs/reports/14_trace_eval_persistence_nightly_spec.md
 *
 * @param {string} runId
 * @param {object} scoreObj — { suites: { command_safety: {...}, prompt_injection: {...} }, ... }
 * @param {string} version — eval pipeline version tag, e.g. "eval-lite@2026-04-20"
 */
export async function attachEvalScore(runId, scoreObj, version = 'eval-lite@unknown') {
  const isPg = getType() === 'pg';
  const payload = isPg ? scoreObj : JSON.stringify(scoreObj); // pg JSONB takes obj; sqlite TEXT
  const now = new Date().toISOString();
  const r = await query(
    `UPDATE trace_runs
       SET eval_score = $1, eval_scored_at = $2, eval_version = $3
     WHERE id = $4
     RETURNING id`,
    [payload, now, version, runId]
  );
  return (r.rows && r.rows[0]) ? { id: r.rows[0].id, eval_scored_at: now, eval_version: version } : null;
}

/**
 * Get trace stats
 */
export async function traceStats({ agentId = null, hours = 24 } = {}) {
  const timeFilter = getType() === 'pg'
    ? `started_at >= now() - interval '${parseInt(hours)} hours'`
    : `started_at >= datetime('now', '-${parseInt(hours)} hours')`;

  let whereClause = timeFilter;
  const params = [];
  if (agentId) {
    params.push(agentId);
    whereClause = `agent_id = $1 AND ${timeFilter}`;
  }

  const total = await query(`SELECT COUNT(*) as count FROM trace_runs WHERE ${whereClause}`, params);

  const byStatus = await query(
    `SELECT status, COUNT(*) as count FROM trace_runs WHERE ${whereClause} GROUP BY status`,
    params
  );

  const spanCount = await query(
    `SELECT COUNT(*) as count FROM trace_spans s JOIN trace_runs r ON r.id = s.run_id WHERE ${whereClause.replace(/started_at/g, 'r.started_at').replace(/agent_id/g, 'r.agent_id')}`,
    params
  );

  const costR = await query(
    `SELECT COALESCE(SUM(m.total_tokens), 0) as tokens, COALESCE(SUM(m.cost_usd), 0) as cost
     FROM trace_metrics m
     JOIN trace_spans s ON s.id = m.span_id
     JOIN trace_runs r ON r.id = s.run_id
     WHERE ${whereClause.replace(/started_at/g, 'r.started_at').replace(/agent_id/g, 'r.agent_id')}`,
    params
  );

  return {
    runs: total.rows[0]?.count || 0,
    byStatus: Object.fromEntries((byStatus.rows || []).map(r => [r.status, r.count])),
    spans: spanCount.rows[0]?.count || 0,
    totalTokens: costR.rows[0]?.tokens || 0,
    totalCost: costR.rows[0]?.cost || 0,
    hours,
  };
}

// ========== Cleanup ==========

export async function pruneTraces(daysOld = 30) {
  const timeFilter = getType() === 'pg'
    ? `started_at < now() - interval '${parseInt(daysOld)} days'`
    : `started_at < datetime('now', '-${parseInt(daysOld)} days')`;

  // Delete metrics for old spans
  await query(`DELETE FROM trace_metrics WHERE span_id IN (SELECT s.id FROM trace_spans s JOIN trace_runs r ON r.id = s.run_id WHERE r.${timeFilter})`);
  // Delete old spans
  await query(`DELETE FROM trace_spans WHERE run_id IN (SELECT id FROM trace_runs WHERE ${timeFilter})`);
  // Delete old runs
  const r = await query(`DELETE FROM trace_runs WHERE ${timeFilter}`);
  return { pruned: r.rowCount };
}

export default {
  initTraceTables,
  startRun, endRun,
  startSpan, endSpan, withSpan,
  recordMetrics,
  listRuns, getRun, traceStats,
  pruneTraces,
};
