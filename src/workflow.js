/**
 * Workflow — DAG-based Task Orchestration
 *
 * Provides:
 * - Workflow definition (steps with dependencies)
 * - DAG validation (cycle detection)
 * - Sequential and parallel step execution
 * - Conditional branching
 * - Workflow templates (save/reuse)
 * - Execution state tracking
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Init ==========

export async function initWorkflowTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS workflow_defs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      agent_id TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      agent_id TEXT,
      status TEXT DEFAULT 'running',
      current_step TEXT,
      state TEXT,
      result TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_workflow_defs_agent ON workflow_defs(agent_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_workflow_executions_wf ON workflow_executions(workflow_id)`);
}

// ========== Helpers ==========

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nowExpr() {
  return getType() === 'pg' ? 'now()' : "datetime('now')";
}

function safeParse(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ========== Workflow CRUD ==========

/**
 * Create a workflow definition
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.description]
 * @param {Array} opts.steps - [{ id, name, action, depends_on?, condition?, params? }]
 * @param {string} [opts.agentId]
 * @returns {{ id, name }}
 *
 * Step format:
 *   { id: 'step1', name: 'Fetch data', action: 'tool:web-search', params: {query:'...'}, depends_on: [] }
 *   { id: 'step2', name: 'Analyze', action: 'reason', params: {task:'...'}, depends_on: ['step1'] }
 *   { id: 'step3', name: 'Report', action: 'tool:summarize', depends_on: ['step2'], condition: 'step2.status === "ok"' }
 */
export async function createWorkflow({ name, description = '', steps, agentId = null }) {
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('steps array required');
  }

  // Validate DAG (no cycles)
  const cycleCheck = detectCycle(steps);
  if (cycleCheck) {
    throw new Error(`Workflow has cycle: ${cycleCheck}`);
  }

  const id = genId('wf');
  await query(
    `INSERT INTO workflow_defs (id, name, description, steps, agent_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', ${nowExpr()}, ${nowExpr()})`,
    [id, name, description, JSON.stringify(steps), agentId]
  );

  return { id, name, stepCount: steps.length };
}

/**
 * List workflow_defs
 */
export async function listWorkflows({ agentId = null, status = null, limit = 50 } = {}) {
  let sql = 'SELECT id, name, description, agent_id, status, created_at, updated_at FROM workflow_defs WHERE 1=1';
  const params = [];
  let idx = 1;

  if (agentId) { sql += ` AND agent_id = $${idx++}`; params.push(agentId); }
  if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

  sql += ` ORDER BY updated_at DESC LIMIT $${idx}`;
  params.push(limit);

  return (await query(sql, params)).rows;
}

/**
 * Get workflow with steps
 */
export async function getWorkflow(workflowId) {
  const r = await query('SELECT * FROM workflow_defs WHERE id = $1', [workflowId]);
  const wf = r.rows[0];
  if (!wf) return null;
  wf.steps = safeParse(wf.steps, []);
  return wf;
}

/**
 * Delete a workflow
 */
export async function deleteWorkflow(workflowId) {
  await query('DELETE FROM workflow_executions WHERE workflow_id = $1', [workflowId]);
  const r = await query('DELETE FROM workflow_defs WHERE id = $1', [workflowId]);
  return { deleted: r.rowCount > 0 };
}

// ========== Workflow Execution ==========

/**
 * Execute a workflow
 * @param {string} workflowId
 * @param {object} [opts]
 * @param {string} [opts.agentId]
 * @param {function} [opts.executeFn] - async (step, context) => result
 * @param {function} [opts.onStep] - callback(stepId, status, result)
 * @returns {{ runId, status, results, duration }}
 */
export async function executeWorkflow(workflowId, opts = {}) {
  const wf = await getWorkflow(workflowId);
  if (!wf) throw new Error('Workflow not found');

  const runId = genId('wfrun');
  const startTime = Date.now();

  await query(
    `INSERT INTO workflow_executions (id, workflow_id, agent_id, status, state, started_at)
     VALUES ($1, $2, $3, 'running', $4, ${nowExpr()})`,
    [runId, workflowId, opts.agentId || wf.agent_id, JSON.stringify({})]
  );

  const steps = wf.steps;
  const results = {};
  const stepStatus = {};
  let overallStatus = 'completed';

  try {
    // Topological sort for execution order
    const order = topoSort(steps);

    for (const stepId of order) {
      const step = steps.find(s => s.id === stepId);
      if (!step) continue;

      // Check dependencies
      const depsOk = (step.depends_on || []).every(dep => stepStatus[dep] === 'ok');
      if (!depsOk) {
        stepStatus[stepId] = 'skipped';
        results[stepId] = { status: 'skipped', reason: 'dependency failed' };
        if (opts.onStep) opts.onStep(stepId, 'skipped', results[stepId]);
        continue;
      }

      // Check condition
      if (step.condition) {
        const conditionMet = evaluateCondition(step.condition, results);
        if (!conditionMet) {
          stepStatus[stepId] = 'skipped';
          results[stepId] = { status: 'skipped', reason: 'condition not met' };
          if (opts.onStep) opts.onStep(stepId, 'skipped', results[stepId]);
          continue;
        }
      }

      // Update current step
      await query(
        `UPDATE workflow_executions SET current_step = $1, state = $2 WHERE id = $3`,
        [stepId, JSON.stringify(results), runId]
      );

      // Execute step
      try {
        let result;
        if (opts.executeFn) {
          result = await opts.executeFn(step, { results, stepStatus });
        } else {
          result = { status: 'ok', note: 'No executeFn provided — step recorded but not executed' };
        }

        stepStatus[stepId] = 'ok';
        results[stepId] = { status: 'ok', result };
        if (opts.onStep) opts.onStep(stepId, 'ok', result);
      } catch (e) {
        stepStatus[stepId] = 'error';
        results[stepId] = { status: 'error', error: e.message };
        overallStatus = 'failed';
        if (opts.onStep) opts.onStep(stepId, 'error', e.message);

        // Check if step is critical (stop workflow) or optional (continue)
        if (step.critical !== false) break;
      }
    }
  } catch (e) {
    overallStatus = 'failed';
    await query(
      `UPDATE workflow_executions SET status = 'failed', error = $1, completed_at = ${nowExpr()} WHERE id = $2`,
      [e.message, runId]
    );
    return { runId, status: 'failed', error: e.message, duration: Date.now() - startTime };
  }

  // Finalize
  await query(
    `UPDATE workflow_executions SET status = $1, result = $2, state = $3, completed_at = ${nowExpr()} WHERE id = $4`,
    [overallStatus, JSON.stringify(results), JSON.stringify(stepStatus), runId]
  );

  return {
    runId,
    status: overallStatus,
    results,
    stepStatus,
    duration: Date.now() - startTime,
  };
}

/**
 * Get workflow run details
 */
export async function getWorkflowRun(runId) {
  const r = await query('SELECT * FROM workflow_executions WHERE id = $1', [runId]);
  const run = r.rows[0];
  if (!run) return null;
  run.state = safeParse(run.state, {});
  run.result = safeParse(run.result, {});
  return run;
}

/**
 * List workflow runs
 */
export async function listWorkflowRuns(workflowId, { limit = 20 } = {}) {
  const r = await query(
    'SELECT id, workflow_id, agent_id, status, current_step, started_at, completed_at FROM workflow_executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2',
    [workflowId, limit]
  );
  return r.rows;
}

// ========== DAG Utilities ==========

/**
 * Detect cycles in step dependencies
 * @returns {string|null} cycle description or null if no cycle
 */
function detectCycle(steps) {
  const visited = new Set();
  const inStack = new Set();

  function dfs(stepId) {
    if (inStack.has(stepId)) return stepId;
    if (visited.has(stepId)) return null;

    visited.add(stepId);
    inStack.add(stepId);

    const step = steps.find(s => s.id === stepId);
    if (step?.depends_on) {
      for (const dep of step.depends_on) {
        const cycle = dfs(dep);
        if (cycle) return `${stepId} → ${cycle}`;
      }
    }

    inStack.delete(stepId);
    return null;
  }

  for (const step of steps) {
    const cycle = dfs(step.id);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Topological sort of steps
 */
function topoSort(steps) {
  const result = [];
  const visited = new Set();

  function visit(stepId) {
    if (visited.has(stepId)) return;
    visited.add(stepId);

    const step = steps.find(s => s.id === stepId);
    if (step?.depends_on) {
      for (const dep of step.depends_on) visit(dep);
    }
    result.push(stepId);
  }

  for (const step of steps) visit(step.id);
  return result;
}

/**
 * Simple condition evaluator
 * Supports: "stepId.status === 'ok'"
 */
function evaluateCondition(condition, results) {
  try {
    // Replace step references with actual values
    const evaluated = condition.replace(/(\w+)\.status/g, (_, stepId) => {
      return `"${results[stepId]?.status || 'unknown'}"`;
    });
    return new Function(`return ${evaluated}`)();
  } catch {
    return true; // If condition can't be evaluated, proceed
  }
}

export default {
  initWorkflowTables,
  createWorkflow, listWorkflows, getWorkflow, deleteWorkflow,
  executeWorkflow, getWorkflowRun, listWorkflowRuns,
};
