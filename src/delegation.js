/**
 * Delegation OS — Child Agent Isolation Runtime
 *
 * Provides isolated subagent execution:
 * - Fresh conversation scope per child
 * - Blocked tool boundaries (prevent recursion/escalation)
 * - Recursion depth limiting
 * - Progress relay to parent
 * - Concurrent child execution with cap
 *
 * Shared core: works with both PG and SQLite.
 *
 * Design reference: Hermes delegate_tool.py + Claude Code Fork/Worktree
 */

import * as sessionStore from './session-store.js';

// ========== Configuration ==========

const MAX_DELEGATION_DEPTH = 3;
const MAX_CONCURRENT_CHILDREN = 4;
const DEFAULT_CHILD_TIMEOUT_MS = 300000; // 5 minutes

// Tools that children CANNOT use (prevent escalation)
const BLOCKED_TOOLS_FOR_CHILDREN = new Set([
  'delegate',       // No recursive delegation by default
  'deploy',         // No production deployments
  'external_msg',   // No external messaging
  'payment',        // No financial ops
  'config_change',  // No system config
  'user_data',      // No PII access
]);

// ========== Active Delegations Tracking ==========

const _activeDelegations = new Map(); // parentAgentId → Set<childId>

// ========== Delegation ==========

/**
 * Delegate a task to a child agent
 *
 * @param {object} opts
 * @param {string} opts.parentAgentId - who is delegating
 * @param {string} opts.task - what the child should do
 * @param {string} [opts.childRole] - role template for child (default: same as parent)
 * @param {string[]} [opts.allowedTools] - explicit tool whitelist (overrides default)
 * @param {string[]} [opts.blockedTools] - additional tools to block
 * @param {number} [opts.depth] - current delegation depth (0 = top level)
 * @param {number} [opts.timeoutMs] - max execution time
 * @param {function} [opts.onProgress] - callback(progress) for relay
 * @param {function} [opts.executeFn] - async (agentId, prompt, session) => result
 * @returns {{ childId, result, sessionId, duration }}
 */
export async function delegate({
  parentAgentId,
  task,
  childRole = null,
  allowedTools = null,
  blockedTools = [],
  depth = 0,
  timeoutMs = DEFAULT_CHILD_TIMEOUT_MS,
  onProgress = null,
  executeFn = null,
}) {
  // Depth guard
  if (depth >= MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      error: `Delegation depth limit reached (max ${MAX_DELEGATION_DEPTH})`,
      childId: null,
    };
  }

  // Concurrency guard
  const parentChildren = _activeDelegations.get(parentAgentId) || new Set();
  if (parentChildren.size >= MAX_CONCURRENT_CHILDREN) {
    return {
      ok: false,
      error: `Too many concurrent children (max ${MAX_CONCURRENT_CHILDREN})`,
      childId: null,
    };
  }

  // Create child ID
  const childId = `child-${parentAgentId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

  // Track active delegation
  parentChildren.add(childId);
  _activeDelegations.set(parentAgentId, parentChildren);

  // Build blocked tool set
  const effectiveBlocked = new Set([...BLOCKED_TOOLS_FOR_CHILDREN, ...blockedTools]);
  // If depth > 0, also block delegate (prevent grandchild spawning beyond depth 1)
  if (depth > 0) effectiveBlocked.add('delegate');

  // Create isolated session for child
  const session = await sessionStore.createSession({
    agentId: childId,
    metadata: {
      parent: parentAgentId,
      depth: depth + 1,
      delegated_at: new Date().toISOString(),
      blocked_tools: [...effectiveBlocked],
      allowed_tools: allowedTools || null,
    },
  });

  // Build child prompt with workspace hint
  const childPrompt = buildChildPrompt(task, {
    parentAgentId,
    blockedTools: effectiveBlocked,
    allowedTools,
    depth: depth + 1,
  });

  // Persist the task as user message
  await sessionStore.appendMessage({
    sessionId: session.id,
    role: 'user',
    content: childPrompt,
    metadata: { delegation: true, parent: parentAgentId },
  });

  // Report progress: started
  if (onProgress) {
    try { onProgress({ childId, status: 'started', task: task.slice(0, 200) }); } catch {}
  }

  const startTime = Date.now();

  try {
    // Execute with timeout
    const result = await Promise.race([
      executeChild(childId, childPrompt, session.id, executeFn),
      timeout(timeoutMs).then(() => {
        throw new Error(`Child agent timeout after ${timeoutMs}ms`);
      }),
    ]);

    const duration = Date.now() - startTime;

    // Persist result
    await sessionStore.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      metadata: { delegation_result: true, duration },
    });

    // Report progress: completed
    if (onProgress) {
      try { onProgress({ childId, status: 'completed', duration, resultPreview: (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 300) }); } catch {}
    }

    return {
      ok: true,
      childId,
      sessionId: session.id,
      result,
      duration,
      depth: depth + 1,
    };
  } catch (e) {
    const duration = Date.now() - startTime;

    // Persist error
    await sessionStore.appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: `[delegation error] ${e.message}`,
      metadata: { error: true, duration },
    });

    // Report progress: failed
    if (onProgress) {
      try { onProgress({ childId, status: 'failed', error: e.message, duration }); } catch {}
    }

    return {
      ok: false,
      childId,
      sessionId: session.id,
      error: e.message,
      duration,
      depth: depth + 1,
    };
  } finally {
    // Cleanup tracking
    const children = _activeDelegations.get(parentAgentId);
    if (children) {
      children.delete(childId);
      if (children.size === 0) _activeDelegations.delete(parentAgentId);
    }
  }
}

/**
 * Delegate multiple tasks in parallel (with concurrency cap)
 */
export async function delegateBatch({
  parentAgentId,
  tasks,
  depth = 0,
  onProgress = null,
  executeFn = null,
}) {
  if (tasks.length === 0) return [];

  // Cap at MAX_CONCURRENT_CHILDREN
  const batchSize = Math.min(tasks.length, MAX_CONCURRENT_CHILDREN);
  const results = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(task => delegate({
        parentAgentId,
        task: typeof task === 'string' ? task : task.task,
        childRole: task.childRole || null,
        allowedTools: task.allowedTools || null,
        blockedTools: task.blockedTools || [],
        depth,
        onProgress,
        executeFn,
      }))
    );

    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message });
    }
  }

  return results;
}

// ========== Tool Filtering ==========

/**
 * Check if a tool is allowed for a child at given depth
 */
export function isToolAllowed(toolName, { allowedTools = null, blockedTools = new Set(), depth = 1 } = {}) {
  // If explicit whitelist, only those are allowed
  if (allowedTools && Array.isArray(allowedTools)) {
    return allowedTools.includes(toolName) && !blockedTools.has(toolName);
  }
  // Otherwise, everything except blocked
  return !blockedTools.has(toolName);
}

/**
 * Filter a tool catalog for child use
 */
export function filterToolsForChild(toolCatalog, { allowedTools = null, blockedTools = [], depth = 1 } = {}) {
  const blocked = new Set([...BLOCKED_TOOLS_FOR_CHILDREN, ...blockedTools]);
  if (depth > 1) blocked.add('delegate');

  return Object.fromEntries(
    Object.entries(toolCatalog).filter(([name]) => {
      if (blocked.has(name)) return false;
      if (allowedTools && !allowedTools.includes(name)) return false;
      return true;
    })
  );
}

// ========== Status ==========

/**
 * Get active delegations status
 */
export function getDelegationStatus() {
  const status = {};
  for (const [parentId, children] of _activeDelegations) {
    status[parentId] = {
      activeChildren: children.size,
      childIds: [...children],
    };
  }
  return {
    totalParents: _activeDelegations.size,
    totalChildren: [..._activeDelegations.values()].reduce((sum, s) => sum + s.size, 0),
    parents: status,
    limits: {
      maxDepth: MAX_DELEGATION_DEPTH,
      maxConcurrent: MAX_CONCURRENT_CHILDREN,
      defaultTimeout: DEFAULT_CHILD_TIMEOUT_MS,
    },
  };
}

// ========== Internals ==========

function buildChildPrompt(task, { parentAgentId, blockedTools, allowedTools, depth }) {
  const lines = [
    `你是一個被委派的子代理 (depth=${depth})，由 ${parentAgentId} 委託執行以下任務。`,
    '',
    '## 任務',
    task,
    '',
    '## 限制',
    `- 你不可以使用以下工具: ${[...blockedTools].join(', ')}`,
  ];

  if (allowedTools) {
    lines.push(`- 你只能使用以下工具: ${allowedTools.join(', ')}`);
  }

  lines.push(
    `- 委派深度: ${depth}/${MAX_DELEGATION_DEPTH}`,
    '- 完成任務後直接回報結果，不要自行委派其他子任務',
    '',
    '## 回報格式',
    '直接說明你的執行結果。如果失敗，說明原因。',
  );

  return lines.join('\n');
}

async function executeChild(childId, prompt, sessionId, executeFn) {
  if (executeFn) {
    return await executeFn(childId, prompt, sessionId);
  }

  // Default: try A-version full server endpoint first, fallback to lite
  const port = process.env.PORT || 18860;
  const endpoints = [
    { url: `http://127.0.0.1:${port}/api/agent/chat`, body: { agent: childId, message: prompt } },
    { url: `http://127.0.0.1:${port}/api/agents/chat`, body: { agent_id: childId, message: prompt } },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body),
      });
      if (res.status === 404) continue; // endpoint doesn't exist, try next
      const data = await res.json();
      if (data.error && data.error.includes('not_found')) continue;
      return data.reply || data.response || JSON.stringify(data);
    } catch (e) {
      // Network error, try next endpoint
      continue;
    }
  }

  // No chat endpoint available — return structured error
  throw new Error(`No agent chat endpoint available at port ${port}. Provide executeFn parameter or ensure server has /api/agent/chat or /api/agents/chat endpoint.`);
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  delegate, delegateBatch, isToolAllowed, filterToolsForChild, getDelegationStatus,
};
