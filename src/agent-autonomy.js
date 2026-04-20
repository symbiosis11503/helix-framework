/**
 * Agent Autonomy — Long Task Management, Self-Optimization, Autonomous Discovery
 *
 * Three capabilities:
 *   (6-1) Long task management — checkpoint/resume, progress tracking, timeout recovery
 *   (6-2) Self-optimization — reflect on execution paths, store optimized procedures
 *   (6-3) Autonomous discovery — discover and propose work when idle
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Helpers ==========

/** @returns {string} Current timestamp expression for SQL */
function now() {
  return getType() === 'pg' ? 'now()' : "datetime('now')";
}

/** @returns {string} Unique ID with prefix */
function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Safely parse JSON, returning fallback on failure */
function safeParse(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ========== Init ==========

/**
 * Create autonomy tables (long_tasks, optimizations, discovery_rules).
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export async function initAutonomyTables() {
  const isPg = getType() === 'pg';
  const ts = isPg ? 'TIMESTAMPTZ' : 'TEXT';
  const defaultNow = isPg ? 'DEFAULT now()' : "DEFAULT (datetime('now'))";

  await query(`
    CREATE TABLE IF NOT EXISTS long_tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      total_steps INTEGER DEFAULT 0,
      completed_steps INTEGER DEFAULT 0,
      current_checkpoint TEXT,
      result TEXT,
      error TEXT,
      started_at ${ts},
      updated_at ${ts} ${defaultNow},
      completed_at ${ts},
      timeout_ms INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS optimizations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_pattern TEXT NOT NULL,
      original_steps TEXT,
      optimized_steps TEXT,
      improvement_score REAL DEFAULT 0,
      times_applied INTEGER DEFAULT 0,
      created_at ${ts} ${defaultNow},
      updated_at ${ts} ${defaultNow}
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS discovery_rules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      condition TEXT,
      action TEXT,
      enabled INTEGER DEFAULT 1,
      last_triggered_at ${ts},
      trigger_count INTEGER DEFAULT 0,
      cooldown_ms INTEGER DEFAULT 300000,
      created_at ${ts} ${defaultNow}
    )
  `);

  // Indexes for common queries
  await query('CREATE INDEX IF NOT EXISTS idx_long_tasks_agent_status ON long_tasks(agent_id, status)');
  await query('CREATE INDEX IF NOT EXISTS idx_optimizations_agent ON optimizations(agent_id, task_pattern)');
  await query('CREATE INDEX IF NOT EXISTS idx_discovery_rules_agent ON discovery_rules(agent_id, enabled)');
}

// ========== (6-1) Long Task Management ==========

/**
 * Create a long-running task with step breakdown.
 *
 * @param {object} opts
 * @param {string} opts.agentId - Owner agent ID
 * @param {string} opts.title - Human-readable task title
 * @param {string} [opts.description] - Detailed description
 * @param {Array<{name: string, description?: string}>} opts.steps - Step definitions
 * @param {number} [opts.timeoutMs=0] - Timeout in ms (0 = no timeout)
 * @returns {Promise<{id: string, totalSteps: number}>}
 */
export async function createLongTask({ agentId, title, description = '', steps = [], timeoutMs = 0 }) {
  const id = genId('ltask');
  const stepsWithStatus = steps.map(s => ({ ...s, status: 'pending' }));
  const checkpoint = JSON.stringify(stepsWithStatus);

  await query(
    `INSERT INTO long_tasks (id, agent_id, title, description, status, total_steps, completed_steps, current_checkpoint, timeout_ms, started_at, updated_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, 0, $6, $7, ${now()}, ${now()})`,
    [id, agentId, title, description, steps.length, checkpoint, timeoutMs]
  );

  return { id, totalSteps: steps.length };
}

/**
 * Mark current step complete and advance to the next.
 * When all steps complete, the task status becomes 'completed'.
 *
 * @param {string} taskId
 * @param {object} [opts]
 * @param {*} [opts.stepResult] - Result data for the completed step
 * @param {object} [opts.checkpoint] - JSON-serializable state for resume
 * @returns {Promise<{completedSteps: number, totalSteps: number, finished: boolean, nextStep: object|null}>}
 */
export async function advanceTask(taskId, { stepResult = null, checkpoint = null } = {}) {
  const r = await query('SELECT * FROM long_tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task) throw new Error(`Task ${taskId} not found`);

  const steps = safeParse(task.current_checkpoint, []);
  const stepList = Array.isArray(steps) ? steps : (steps.steps || []);
  const completedSteps = task.completed_steps || 0;

  // Mark current step complete
  if (completedSteps < stepList.length) {
    stepList[completedSteps].status = 'completed';
    stepList[completedSteps].result = stepResult;
  }

  const newCompleted = completedSteps + 1;
  const finished = newCompleted >= task.total_steps;

  // Build checkpoint payload
  const checkpointPayload = checkpoint
    ? { steps: stepList, userCheckpoint: checkpoint }
    : stepList;
  const checkpointJson = JSON.stringify(checkpointPayload);

  if (finished) {
    await query(
      `UPDATE long_tasks SET completed_steps = $1, current_checkpoint = $2, status = 'completed', completed_at = ${now()}, updated_at = ${now()} WHERE id = $3`,
      [newCompleted, checkpointJson, taskId]
    );
    return { completedSteps: newCompleted, totalSteps: task.total_steps, finished: true, nextStep: null };
  }

  // Mark next step as running
  if (newCompleted < stepList.length) {
    stepList[newCompleted].status = 'running';
  }
  const updatedPayload = checkpoint
    ? { steps: stepList, userCheckpoint: checkpoint }
    : stepList;

  await query(
    `UPDATE long_tasks SET completed_steps = $1, current_checkpoint = $2, status = 'running', updated_at = ${now()} WHERE id = $3`,
    [newCompleted, JSON.stringify(updatedPayload), taskId]
  );

  const nextStep = newCompleted < stepList.length ? stepList[newCompleted] : null;
  return { completedSteps: newCompleted, totalSteps: task.total_steps, finished: false, nextStep };
}

/**
 * Pause a running task, saving checkpoint for later resume.
 *
 * @param {string} taskId
 * @param {object} [opts]
 * @param {string} [opts.reason] - Why the task was paused
 * @param {object} [opts.checkpoint] - Serializable state for resume
 * @returns {Promise<{paused: boolean, reason: string}>}
 */
export async function pauseTask(taskId, { reason = '', checkpoint = null } = {}) {
  const r = await query('SELECT current_checkpoint FROM long_tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task) throw new Error(`Task ${taskId} not found`);

  const existing = safeParse(task.current_checkpoint, {});
  const base = typeof existing === 'object' && !Array.isArray(existing) ? existing : { steps: existing };
  const merged = { ...base, pauseReason: reason };
  if (checkpoint) merged.userCheckpoint = checkpoint;

  await query(
    `UPDATE long_tasks SET status = 'paused', current_checkpoint = $1, updated_at = ${now()} WHERE id = $2`,
    [JSON.stringify(merged), taskId]
  );

  return { paused: true, reason };
}

/**
 * Resume a paused task from its last checkpoint.
 *
 * @param {string} taskId
 * @returns {Promise<{checkpoint: object, completedSteps: number, totalSteps: number}>}
 */
export async function resumeTask(taskId) {
  const r = await query('SELECT * FROM long_tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'paused') throw new Error(`Task ${taskId} is ${task.status}, not paused`);

  await query(
    `UPDATE long_tasks SET status = 'running', updated_at = ${now()} WHERE id = $1`,
    [taskId]
  );

  const checkpoint = safeParse(task.current_checkpoint, {});
  return {
    checkpoint: checkpoint.userCheckpoint || checkpoint,
    completedSteps: task.completed_steps,
    totalSteps: task.total_steps,
  };
}

/**
 * Mark a task as failed. If retryable and retry_count < 3, requeue as pending.
 *
 * @param {string} taskId
 * @param {object} opts
 * @param {string} opts.error - Error description
 * @param {boolean} [opts.retryable=false] - Whether the task can be retried
 * @returns {Promise<{failed: boolean, willRetry: boolean, retryCount: number}>}
 */
export async function failTask(taskId, { error, retryable = false }) {
  const r = await query('SELECT retry_count FROM long_tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task) throw new Error(`Task ${taskId} not found`);

  const retryCount = (task.retry_count || 0) + 1;
  const willRetry = retryable && retryCount <= 3;
  const newStatus = willRetry ? 'pending' : 'failed';

  if (willRetry) {
    await query(
      `UPDATE long_tasks SET status = $1, error = $2, retry_count = $3, updated_at = ${now()} WHERE id = $4`,
      [newStatus, error, retryCount, taskId]
    );
  } else {
    await query(
      `UPDATE long_tasks SET status = $1, error = $2, retry_count = $3, completed_at = ${now()}, updated_at = ${now()} WHERE id = $4`,
      [newStatus, error, retryCount, taskId]
    );
  }

  return { failed: !willRetry, willRetry, retryCount };
}

/**
 * Get detailed task progress.
 *
 * @param {string} taskId
 * @returns {Promise<{id, title, status, totalSteps, completedSteps, currentStep, checkpoint, progress, error, retryCount, startedAt, updatedAt, completedAt}|null>}
 */
export async function getTaskProgress(taskId) {
  const r = await query('SELECT * FROM long_tasks WHERE id = $1', [taskId]);
  const task = r.rows[0];
  if (!task) return null;

  const raw = safeParse(task.current_checkpoint, []);
  const stepList = Array.isArray(raw) ? raw : (raw.steps || []);
  const currentStepIdx = task.completed_steps || 0;
  const currentStep = currentStepIdx < stepList.length ? stepList[currentStepIdx] : null;
  const progress = task.total_steps > 0
    ? Math.round((task.completed_steps / task.total_steps) * 100)
    : 0;

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    totalSteps: task.total_steps,
    completedSteps: task.completed_steps,
    currentStep,
    checkpoint: safeParse(task.current_checkpoint, {}),
    progress,
    error: task.error,
    retryCount: task.retry_count,
    startedAt: task.started_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  };
}

/**
 * List long tasks for an agent with optional status filter.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {string} [opts.status] - Filter by status (pending/running/paused/completed/failed)
 * @param {number} [opts.limit=50] - Max results
 * @returns {Promise<Array>}
 */
export async function listLongTasks(agentId, { status = null, limit = 50 } = {}) {
  let sql = 'SELECT id, agent_id, title, status, total_steps, completed_steps, error, retry_count, started_at, updated_at, completed_at FROM long_tasks WHERE agent_id = $1';
  const params = [agentId];

  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }

  sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  return (await query(sql, params)).rows;
}

/**
 * Find running tasks that exceeded their timeout and auto-pause them.
 *
 * @param {string} agentId
 * @returns {Promise<Array<{id: string, title: string}>>} Timed-out tasks
 */
export async function checkTimeouts(agentId) {
  const isPg = getType() === 'pg';

  // Elapsed time since last update > timeout_ms (only tasks with timeout_ms > 0)
  const sql = isPg
    ? `SELECT id, title FROM long_tasks
       WHERE agent_id = $1 AND status = 'running' AND timeout_ms > 0
       AND (EXTRACT(EPOCH FROM (now() - updated_at)) * 1000) > timeout_ms`
    : `SELECT id, title FROM long_tasks
       WHERE agent_id = $1 AND status = 'running' AND timeout_ms > 0
       AND ((julianday('now') - julianday(updated_at)) * 86400000) > timeout_ms`;

  const r = await query(sql, [agentId]);
  const timedOut = [];

  for (const task of r.rows) {
    await pauseTask(task.id, { reason: 'timeout' });
    timedOut.push({ id: task.id, title: task.title });
  }

  return timedOut;
}

// ========== (6-2) Self-Optimization ==========

/**
 * Record a task execution for pattern learning.
 * If a matching pattern exists, compare and potentially update the optimization.
 * If no match, store as baseline.
 *
 * @param {string} agentId
 * @param {object} opts
 * @param {string} opts.taskPattern - Pattern identifier (e.g. "deploy-service", "run-tests")
 * @param {Array<{name: string, duration?: number, success: boolean, error?: string}>} opts.steps
 * @param {number} opts.duration - Total duration in ms
 * @param {boolean} opts.success - Overall success
 */
export async function recordExecution(agentId, { taskPattern, steps, duration, success }) {
  const isPg = getType() === 'pg';
  const likeOp = isPg ? 'ILIKE' : 'LIKE';

  // Look for existing optimization with similar pattern
  const existing = await query(
    `SELECT id, original_steps, optimized_steps, improvement_score FROM optimizations
     WHERE agent_id = $1 AND task_pattern ${likeOp} $2 LIMIT 1`,
    [agentId, `%${taskPattern}%`]
  );

  if (existing.rows.length > 0) {
    const opt = existing.rows[0];
    const origSteps = safeParse(opt.original_steps, []);

    // If current execution succeeded with fewer steps, update optimized path
    const successSteps = steps.filter(s => s.success);
    if (success && origSteps.length > 0 && successSteps.length < origSteps.length) {
      const newScore = 1 - (successSteps.length / origSteps.length);
      const finalScore = Math.max(newScore, opt.improvement_score);
      await query(
        `UPDATE optimizations SET optimized_steps = $1, improvement_score = $2, updated_at = ${now()} WHERE id = $3`,
        [JSON.stringify(steps), finalScore, opt.id]
      );
    }
  } else {
    // First recording for this pattern — store as baseline
    const id = genId('opt');
    await query(
      `INSERT INTO optimizations (id, agent_id, task_pattern, original_steps, optimized_steps, improvement_score, times_applied, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, ${now()}, ${now()})`,
      [id, agentId, taskPattern, JSON.stringify(steps), JSON.stringify(steps)]
    );
  }
}

/**
 * Look up optimized steps for a task pattern using fuzzy text match.
 * Only returns results with improvement_score > 0.2.
 *
 * @param {string} agentId
 * @param {string} taskPattern - Pattern to search for
 * @returns {Promise<Array|null>} Optimized steps or null
 */
export async function getOptimizedSteps(agentId, taskPattern) {
  const isPg = getType() === 'pg';
  const likeOp = isPg ? 'ILIKE' : 'LIKE';

  const r = await query(
    `SELECT id, optimized_steps, improvement_score FROM optimizations
     WHERE agent_id = $1 AND task_pattern ${likeOp} $2 AND improvement_score > 0.2
     ORDER BY improvement_score DESC LIMIT 1`,
    [agentId, `%${taskPattern}%`]
  );

  if (r.rows.length === 0) return null;
  return safeParse(r.rows[0].optimized_steps, null);
}

/**
 * Store a suggested optimization with auto-calculated improvement score.
 * Score = 60% step reduction + 40% error avoidance.
 *
 * @param {string} agentId
 * @param {object} opts
 * @param {string} opts.taskPattern
 * @param {Array<{name: string, success?: boolean, error?: string}>} opts.originalSteps
 * @param {Array<{name: string, success?: boolean, error?: string}>} opts.optimizedSteps
 * @param {string} [opts.reason] - Why this is an improvement
 * @returns {Promise<{id: string, improvementScore: number}>}
 */
export async function suggestOptimization(agentId, { taskPattern, originalSteps, optimizedSteps, reason = '' }) {
  const id = genId('opt');

  // Compute improvement score
  const origCount = originalSteps.length;
  const optCount = optimizedSteps.length;
  const stepReduction = origCount > 0 ? Math.max(0, (origCount - optCount) / origCount) : 0;
  const origErrors = originalSteps.filter(s => s.error || s.success === false).length;
  const optErrors = optimizedSteps.filter(s => s.error || s.success === false).length;
  const errorAvoidance = origErrors > 0 ? Math.max(0, (origErrors - optErrors) / origErrors) : 0;
  const improvementScore = Math.min(1, stepReduction * 0.6 + errorAvoidance * 0.4);

  await query(
    `INSERT INTO optimizations (id, agent_id, task_pattern, original_steps, optimized_steps, improvement_score, times_applied, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, ${now()}, ${now()})`,
    [id, agentId, taskPattern, JSON.stringify(originalSteps), JSON.stringify(optimizedSteps), improvementScore]
  );

  return { id, improvementScore };
}

/**
 * Apply an optimization — increment times_applied and return the optimized steps.
 *
 * @param {string} optimizationId
 * @returns {Promise<Array>} The optimized steps
 */
export async function applyOptimization(optimizationId) {
  const r = await query('SELECT optimized_steps FROM optimizations WHERE id = $1', [optimizationId]);
  if (r.rows.length === 0) throw new Error(`Optimization ${optimizationId} not found`);

  await query(
    `UPDATE optimizations SET times_applied = times_applied + 1, updated_at = ${now()} WHERE id = $1`,
    [optimizationId]
  );

  return safeParse(r.rows[0].optimized_steps, []);
}

/**
 * List optimizations for an agent, sorted by improvement score descending.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.minScore=0] - Minimum improvement score
 * @param {number} [opts.limit=50]
 * @returns {Promise<Array>}
 */
export async function listOptimizations(agentId, { minScore = 0, limit = 50 } = {}) {
  const r = await query(
    `SELECT id, task_pattern, improvement_score, times_applied, created_at, updated_at
     FROM optimizations WHERE agent_id = $1 AND improvement_score >= $2
     ORDER BY improvement_score DESC LIMIT $3`,
    [agentId, minScore, limit]
  );
  return r.rows;
}

// ========== (6-3) Autonomous Discovery ==========

/**
 * Add a discovery rule that triggers agent actions on conditions.
 *
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} opts.name - Human-readable rule name
 * @param {object} opts.condition - Trigger condition
 * @param {'idle'|'schedule'|'event'|'threshold'} opts.condition.type
 * @param {number} [opts.condition.idle_minutes] - For idle type
 * @param {string} [opts.condition.cron] - For schedule type
 * @param {string} [opts.condition.event_type] - For event type
 * @param {string} [opts.condition.metric] - For threshold type
 * @param {number} [opts.condition.threshold] - For threshold type
 * @param {string} opts.action - Description of what to do when triggered
 * @param {number} [opts.cooldownMs=300000] - Min ms between triggers (default 5 min)
 * @returns {Promise<{id: string}>}
 */
export async function addDiscoveryRule({ agentId, name, condition, action, cooldownMs = 300000 }) {
  const id = genId('disc');
  await query(
    `INSERT INTO discovery_rules (id, agent_id, name, condition, action, enabled, trigger_count, cooldown_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, 0, $6, ${now()})`,
    [id, agentId, name, JSON.stringify(condition), action, cooldownMs]
  );
  return { id };
}

/**
 * Remove a discovery rule by ID.
 *
 * @param {string} ruleId
 */
export async function removeDiscoveryRule(ruleId) {
  await query('DELETE FROM discovery_rules WHERE id = $1', [ruleId]);
}

/**
 * Evaluate all enabled discovery rules for an agent against current context.
 * Respects per-rule cooldown — skips rules triggered too recently.
 *
 * @param {string} agentId
 * @param {object} [context]
 * @param {number} [context.idleMinutes] - How long the agent has been idle
 * @param {object} [context.currentMetrics] - Current metric values keyed by name
 * @param {object} [context.lastEvent] - Most recent event { type, ts }
 * @returns {Promise<Array<{id, name, action, condition}>>} Triggered rules
 */
export async function evaluateDiscoveryRules(agentId, context = {}) {
  const r = await query(
    'SELECT * FROM discovery_rules WHERE agent_id = $1 AND enabled = 1',
    [agentId]
  );

  const triggered = [];
  const nowMs = Date.now();

  for (const rule of r.rows) {
    const condition = safeParse(rule.condition, {});

    // Check cooldown
    if (rule.last_triggered_at) {
      const lastTriggered = new Date(rule.last_triggered_at).getTime();
      if (nowMs - lastTriggered < (rule.cooldown_ms || 300000)) {
        continue;
      }
    }

    let matches = false;

    switch (condition.type) {
      case 'idle':
        matches = context.idleMinutes != null && context.idleMinutes >= (condition.idle_minutes || 5);
        break;

      case 'schedule':
        // Cron evaluation is delegated to the caller's scheduling system.
        // Here we only verify the rule is past its cooldown (checked above).
        matches = true;
        break;

      case 'event':
        matches = context.lastEvent?.type === condition.event_type;
        break;

      case 'threshold':
        if (context.currentMetrics && condition.metric && condition.threshold != null) {
          const val = context.currentMetrics[condition.metric];
          matches = val != null && val >= condition.threshold;
        }
        break;

      default:
        break;
    }

    if (matches) {
      triggered.push({
        id: rule.id,
        name: rule.name,
        action: rule.action,
        condition,
      });
    }
  }

  return triggered;
}

/**
 * Mark a discovery rule as triggered — updates last_triggered_at and increments trigger_count.
 *
 * @param {string} ruleId
 */
export async function triggerDiscovery(ruleId) {
  await query(
    `UPDATE discovery_rules SET last_triggered_at = ${now()}, trigger_count = trigger_count + 1 WHERE id = $1`,
    [ruleId]
  );
}

/**
 * List discovery rules for an agent.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {boolean} [opts.enabledOnly=false] - Only return enabled rules
 * @returns {Promise<Array>}
 */
export async function listDiscoveryRules(agentId, { enabledOnly = false } = {}) {
  let sql = 'SELECT * FROM discovery_rules WHERE agent_id = $1';
  const params = [agentId];

  if (enabledOnly) {
    sql += ' AND enabled = 1';
  }

  sql += ' ORDER BY created_at DESC';
  return (await query(sql, params)).rows;
}

/**
 * Master switch — enable or disable ALL discovery rules for an agent.
 *
 * @param {string} agentId
 * @param {boolean} enabled
 * @returns {Promise<{updated: number}>}
 */
export async function setDiscoveryEnabled(agentId, enabled) {
  const r = await query(
    'UPDATE discovery_rules SET enabled = $1 WHERE agent_id = $2',
    [enabled ? 1 : 0, agentId]
  );
  return { updated: r.rowCount };
}

// ========== Autonomous Loop Integration ==========

/**
 * Combined autonomous check — run all autonomy subsystems in one call.
 *
 * 1. Check for timed-out long tasks and auto-pause them
 * 2. Evaluate discovery rules against current context
 * 3. Surface optimization suggestions when idle
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.idleMinutes=0] - How long the agent has been idle
 * @param {object} [opts.metrics={}] - Current metric values
 * @returns {Promise<{timedOutTasks: Array, triggeredRules: Array, suggestions: Array}>}
 */
export async function autonomousCheck(agentId, { idleMinutes = 0, metrics = {} } = {}) {
  // 1. Check for timed-out long tasks
  const timedOutTasks = await checkTimeouts(agentId);

  // 2. Evaluate discovery rules
  const triggeredRules = await evaluateDiscoveryRules(agentId, {
    idleMinutes,
    currentMetrics: metrics,
  });

  // Mark triggered rules as fired
  for (const rule of triggeredRules) {
    await triggerDiscovery(rule.id);
  }

  // 3. Build optimization suggestions when idle
  const suggestions = [];
  if (idleMinutes >= 5) {
    const opts = await listOptimizations(agentId, { minScore: 0.3, limit: 3 });
    for (const opt of opts) {
      suggestions.push({
        type: 'optimization',
        pattern: opt.task_pattern,
        score: opt.improvement_score,
        message: `Optimization available for "${opt.task_pattern}" (score: ${opt.improvement_score.toFixed(2)})`,
      });
    }
  }

  return { timedOutTasks, triggeredRules, suggestions };
}

// ========== Stats ==========

/**
 * Get autonomy statistics for an agent across all three subsystems.
 *
 * @param {string} agentId
 * @returns {Promise<{longTasks: object, optimizations: object, discoveryRules: object}>}
 */
export async function autonomyStats(agentId) {
  const [total, running, completed, failed] = await Promise.all([
    query('SELECT COUNT(*) as count FROM long_tasks WHERE agent_id = $1', [agentId]),
    query("SELECT COUNT(*) as count FROM long_tasks WHERE agent_id = $1 AND status = 'running'", [agentId]),
    query("SELECT COUNT(*) as count FROM long_tasks WHERE agent_id = $1 AND status = 'completed'", [agentId]),
    query("SELECT COUNT(*) as count FROM long_tasks WHERE agent_id = $1 AND status = 'failed'", [agentId]),
  ]);

  const [optTotal, optAvg] = await Promise.all([
    query('SELECT COUNT(*) as count FROM optimizations WHERE agent_id = $1', [agentId]),
    query('SELECT COALESCE(AVG(improvement_score), 0) as avg FROM optimizations WHERE agent_id = $1', [agentId]),
  ]);

  const [ruleTotal, ruleEnabled, ruleTriggers] = await Promise.all([
    query('SELECT COUNT(*) as count FROM discovery_rules WHERE agent_id = $1', [agentId]),
    query('SELECT COUNT(*) as count FROM discovery_rules WHERE agent_id = $1 AND enabled = 1', [agentId]),
    query('SELECT COALESCE(SUM(trigger_count), 0) as total FROM discovery_rules WHERE agent_id = $1', [agentId]),
  ]);

  return {
    longTasks: {
      total: total.rows[0]?.count || 0,
      running: running.rows[0]?.count || 0,
      completed: completed.rows[0]?.count || 0,
      failed: failed.rows[0]?.count || 0,
    },
    optimizations: {
      total: optTotal.rows[0]?.count || 0,
      avgScore: parseFloat(optAvg.rows[0]?.avg || 0),
    },
    discoveryRules: {
      total: ruleTotal.rows[0]?.count || 0,
      enabled: ruleEnabled.rows[0]?.count || 0,
      totalTriggers: ruleTriggers.rows[0]?.total || 0,
    },
  };
}

export default {
  initAutonomyTables,
  // Long tasks
  createLongTask, advanceTask, pauseTask, resumeTask, failTask, getTaskProgress, listLongTasks, checkTimeouts,
  // Optimization
  recordExecution, getOptimizedSteps, suggestOptimization, applyOptimization, listOptimizations,
  // Discovery
  addDiscoveryRule, removeDiscoveryRule, evaluateDiscoveryRules, triggerDiscovery, listDiscoveryRules, setDiscoveryEnabled,
  // Combined
  autonomousCheck, autonomyStats,
};
