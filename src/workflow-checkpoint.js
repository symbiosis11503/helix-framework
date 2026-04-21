/**
 * Workflow Checkpoint — persist intermediate state of long-running workflows
 * and resume from the last successful step.
 *
 * Used by workstation tasks and other multi-step flows where re-running
 * completed steps wastes metered LLM calls.
 *
 * Storage: filesystem JSON (default) or caller-provided adapter.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULT_DIR = process.env.HELIX_CHECKPOINT_DIR || join(process.cwd(), '.helix', 'checkpoints');

/**
 * @typedef {object} CheckpointState
 * @property {string} flowId       - unique id for this workflow instance
 * @property {string} stepId       - last completed step
 * @property {number} stepIndex    - 0-based index of last completed step
 * @property {any}    stepOutput   - output of the last completed step
 * @property {object} context      - shared context accumulated across steps
 * @property {number} updatedAt    - ms epoch
 * @property {string} [status]     - 'in_progress' | 'succeeded' | 'failed'
 */

/** Ensure dir exists. */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** File path for a flow. */
function flowPath(flowId, dir = DEFAULT_DIR) {
  return join(dir, `${encodeURIComponent(flowId)}.json`);
}

/**
 * Save checkpoint after a step completes.
 */
export function saveCheckpoint(state, { dir = DEFAULT_DIR } = {}) {
  if (!state || !state.flowId) throw new Error('state.flowId required');
  ensureDir(dir);
  const full = { ...state, updatedAt: Date.now() };
  writeFileSync(flowPath(state.flowId, dir), JSON.stringify(full, null, 2), 'utf8');
  return full;
}

/**
 * Load the latest checkpoint for a flow, or null if not found.
 */
export function loadCheckpoint(flowId, { dir = DEFAULT_DIR } = {}) {
  const p = flowPath(flowId, dir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Delete a checkpoint (e.g. after successful terminal state).
 */
export function clearCheckpoint(flowId, { dir = DEFAULT_DIR } = {}) {
  const p = flowPath(flowId, dir);
  if (existsSync(p)) unlinkSync(p);
  return { ok: true };
}

/**
 * List all active checkpoints.
 */
export function listCheckpoints({ dir = DEFAULT_DIR } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Run a sequence of steps with checkpointing.
 * Each step is `{ id: string, run: async (context) => output }`.
 * If a prior checkpoint exists for this flowId, steps up through the
 * recorded stepIndex are skipped and their outputs restored into context.
 *
 * @returns {Promise<{ ok, flowId, completed: string[], output, error? }>}
 */
export async function runWithCheckpoint({ flowId, steps, context = {}, dir = DEFAULT_DIR, onStep = null }) {
  if (!flowId) throw new Error('flowId required');
  if (!Array.isArray(steps) || !steps.length) throw new Error('steps[] required');

  const prior = loadCheckpoint(flowId, { dir });
  let resumeIndex = -1;
  let runtimeContext = { ...context };
  const completed = [];

  if (prior && Array.isArray(prior.completedSteps)) {
    resumeIndex = prior.stepIndex;
    runtimeContext = { ...(prior.context || {}), ...runtimeContext };
    completed.push(...prior.completedSteps);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.id || typeof step.run !== 'function') {
      return { ok: false, flowId, completed, error: `steps[${i}] missing id or run` };
    }
    if (i <= resumeIndex) continue;

    if (onStep) onStep({ stepId: step.id, stepIndex: i, phase: 'start' });

    let output;
    try {
      output = await step.run(runtimeContext);
    } catch (e) {
      saveCheckpoint({
        flowId,
        stepId: step.id,
        stepIndex: i - 1,
        completedSteps: completed,
        context: runtimeContext,
        status: 'failed',
        lastError: e.message,
      }, { dir });
      if (onStep) onStep({ stepId: step.id, stepIndex: i, phase: 'error', error: e.message });
      return { ok: false, flowId, completed, error: e.message };
    }

    runtimeContext[step.id] = output;
    completed.push(step.id);

    saveCheckpoint({
      flowId,
      stepId: step.id,
      stepIndex: i,
      completedSteps: completed,
      context: runtimeContext,
      status: i === steps.length - 1 ? 'succeeded' : 'in_progress',
    }, { dir });

    if (onStep) onStep({ stepId: step.id, stepIndex: i, phase: 'done', output });
  }

  // Terminal success — caller may choose to clearCheckpoint(flowId).
  return { ok: true, flowId, completed, output: runtimeContext };
}

export default { saveCheckpoint, loadCheckpoint, clearCheckpoint, listCheckpoints, runWithCheckpoint };
