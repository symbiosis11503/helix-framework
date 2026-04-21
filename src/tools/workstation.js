/**
 * Workstation Tool — submit a task spec to the VPS-OC workstation.
 *
 * Contract: docs/contracts/workstation-api.md
 *
 * Env:
 *   WORKSTATION_URL   — e.g. https://workstation.vps-oc.internal
 *   WORKSTATION_TOKEN — bearer token
 */

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Submit a task spec and wait for terminal state.
 *
 * @param {object} spec - task spec matching workstation-api.md section 3.3
 * @param {object} [opts]
 * @param {number} [opts.pollIntervalMs]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.url]    - override WORKSTATION_URL
 * @param {string} [opts.token]  - override WORKSTATION_TOKEN
 * @returns {Promise<{ok, task_id, status, result?, error?, duration_ms}>}
 */
export async function callWorkstation(spec, opts = {}) {
  const url = opts.url || process.env.WORKSTATION_URL;
  const token = opts.token || process.env.WORKSTATION_TOKEN;
  if (!url) throw new Error('WORKSTATION_URL not set');
  if (!token) throw new Error('WORKSTATION_TOKEN not set');
  if (!spec || !spec.goal) throw new Error('spec.goal required');

  const pollIntervalMs = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const submit = await fetch(`${url}/api/workstation/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(spec),
  });

  if (submit.status === 429) {
    return { ok: false, error: { code: 'ws_rate_limited', message: 'workstation is busy' }, duration_ms: 0 };
  }
  if (!submit.ok) {
    const body = await safeText(submit);
    return { ok: false, error: { code: `http_${submit.status}`, message: body.slice(0, 200) }, duration_ms: 0 };
  }

  const submitJson = await submit.json();
  const taskId = submitJson.task_id || submitJson.id;
  if (!taskId) return { ok: false, error: { code: 'ws_invalid_response', message: 'no task_id/id in response' }, duration_ms: 0 };

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      return { ok: false, task_id: taskId, status: 'timeout', error: { code: 'client_timeout', message: `exceeded ${timeoutMs}ms` }, duration_ms: Date.now() - startedAt };
    }

    await sleep(pollIntervalMs);

    const poll = await fetch(`${url}/api/workstation/task/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!poll.ok) {
      const body = await safeText(poll);
      return { ok: false, task_id: taskId, error: { code: `http_${poll.status}`, message: body.slice(0, 200) }, duration_ms: Date.now() - startedAt };
    }

    const state = await poll.json();
    // Accept both `succeeded` (contract) and `completed` (CCOC runtime convention)
    if (state.status === 'succeeded' || state.status === 'completed') {
      return { ok: true, task_id: taskId, status: state.status, result: state.result, duration_ms: Date.now() - startedAt };
    }
    if (state.status === 'failed' || state.status === 'cancelled') {
      return { ok: false, task_id: taskId, status: state.status, error: state.error, result: state.result, duration_ms: Date.now() - startedAt };
    }
  }
}

/**
 * Cancel an in-flight task.
 */
export async function cancelWorkstationTask(taskId, opts = {}) {
  const url = opts.url || process.env.WORKSTATION_URL;
  const token = opts.token || process.env.WORKSTATION_TOKEN;
  if (!url || !token) throw new Error('WORKSTATION_URL / WORKSTATION_TOKEN not set');

  const res = await fetch(`${url}/api/workstation/task/${taskId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: `cancel http ${res.status}` };
  return { ok: true, ...(await res.json()) };
}

/**
 * Check workstation liveness + brain bridge reachability.
 */
export async function workstationHealth(opts = {}) {
  const url = opts.url || process.env.WORKSTATION_URL;
  if (!url) throw new Error('WORKSTATION_URL not set');
  const res = await fetch(`${url}/api/workstation/health`);
  if (!res.ok) return { ok: false, status: `http_${res.status}` };
  return { ok: true, ...(await res.json()) };
}

/**
 * Discover what this workstation can do (tools, brain_models, limits).
 */
export async function workstationCapabilities(opts = {}) {
  const url = opts.url || process.env.WORKSTATION_URL;
  const token = opts.token || process.env.WORKSTATION_TOKEN;
  if (!url || !token) throw new Error('WORKSTATION_URL / WORKSTATION_TOKEN not set');
  const res = await fetch(`${url}/api/workstation/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, status: `http_${res.status}` };
  return { ok: true, ...(await res.json()) };
}

/**
 * Register the tool into Helix's tool-registry.
 * Call this once at startup.
 */
export async function registerWorkstationTool(registry) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('registry with register() required');
  }

  registry.register({
    name: 'workstation.call',
    description: 'Submit a task spec to the VPS-OC workstation and wait for the terminal result. Fields: goal (required), success_criteria, allowed_paths, forbidden, steps, decision_policy, output_format, brain_model, timeout_sec.',
    level: 'L3',
    category: 'execute',
    inputSchema: {
      required: ['goal'],
      optional: ['success_criteria', 'allowed_paths', 'forbidden', 'steps', 'decision_policy', 'output_format', 'brain_model', 'timeout_sec', 'callback_url'],
    },
    handler: async (args) => {
      return await callWorkstation(args);
    },
    metadata: { contract: 'docs/contracts/workstation-api.md' },
  });

  registry.register({
    name: 'workstation.health',
    description: 'Check VPS-OC workstation liveness and brain-bridge reachability. No arguments.',
    level: 'L1',
    category: 'read',
    inputSchema: { required: [], optional: [] },
    handler: async () => await workstationHealth(),
    metadata: { contract: 'docs/contracts/workstation-api.md' },
  });

  registry.register({
    name: 'workstation.capabilities',
    description: 'Discover what the VPS-OC workstation can do (tools, brain models, limits).',
    level: 'L1',
    category: 'read',
    inputSchema: { required: [], optional: [] },
    handler: async () => await workstationCapabilities(),
    metadata: { contract: 'docs/contracts/workstation-api.md' },
  });

  registry.register({
    name: 'workstation.cancel',
    description: 'Cancel an in-flight workstation task by task_id.',
    level: 'L2',
    category: 'execute',
    inputSchema: { required: ['task_id'], optional: [] },
    handler: async ({ task_id }) => await cancelWorkstationTask(task_id),
    metadata: { contract: 'docs/contracts/workstation-api.md' },
  });

  return { registered: ['workstation.call', 'workstation.health', 'workstation.capabilities', 'workstation.cancel'] };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

export default { callWorkstation, cancelWorkstationTask, workstationHealth, workstationCapabilities, registerWorkstationTool };
