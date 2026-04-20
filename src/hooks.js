/**
 * Hook Lifecycle — Interceptable Event Hooks
 *
 * Unlike event-bus.js (fire-and-forget, observe only), hooks can:
 * - Run before/after tool calls, agent spawns, approvals
 * - ABORT operations by returning { abort: true, reason: '...' }
 * - Modify parameters before execution
 * - Chain multiple hooks (first abort wins)
 *
 * Shared core: works with both A and B versions.
 *
 * Design reference: Claude Code 25+ hook events, Hermes approval chain.
 *
 * Hook events:
 *   tool.before    — before tool execution (can abort)
 *   tool.after     — after tool execution (observe + modify result)
 *   agent.before_spawn — before agent creation (can abort)
 *   agent.after_spawn  — after agent creation
 *   session.before_compress — before session compression (can abort)
 *   session.after_compress  — after session compression
 *   delegation.before — before child delegation (can abort)
 *   delegation.after  — after child delegation
 *   approval.requested — L3 approval queued
 *   approval.resolved  — L3 approval resolved
 *   command.inspect    — shell command inspected (can abort)
 */

const _hooks = new Map(); // event → [{ id, fn, priority }]
let _hookIdCounter = 0;

// ========== Registration ==========

/**
 * Register a hook
 * @param {string} event - hook event name (e.g. 'tool.before')
 * @param {function} fn - async (context) => { abort?, reason?, modified? }
 * @param {object} [opts]
 * @param {number} [opts.priority=100] - lower runs first
 * @param {string} [opts.id] - unique identifier for removal
 * @returns {string} hook ID
 */
export function registerHook(event, fn, opts = {}) {
  const id = opts.id || `hook-${++_hookIdCounter}`;
  const priority = opts.priority ?? 100;

  if (!_hooks.has(event)) _hooks.set(event, []);
  const hooks = _hooks.get(event);

  // Remove existing hook with same ID (replace)
  const existingIdx = hooks.findIndex(h => h.id === id);
  if (existingIdx !== -1) hooks.splice(existingIdx, 1);

  hooks.push({ id, fn, priority });
  // Sort by priority (lower first)
  hooks.sort((a, b) => a.priority - b.priority);

  return id;
}

/**
 * Remove a hook by ID
 */
export function removeHook(hookId) {
  for (const [event, hooks] of _hooks) {
    const idx = hooks.findIndex(h => h.id === hookId);
    if (idx !== -1) {
      hooks.splice(idx, 1);
      return true;
    }
  }
  return false;
}

/**
 * Remove all hooks for an event
 */
export function clearHooks(event) {
  if (event) {
    _hooks.delete(event);
  } else {
    _hooks.clear();
  }
}

// ========== Execution ==========

/**
 * Run "before" hooks — can abort the operation
 *
 * @param {string} event - e.g. 'tool.before'
 * @param {object} context - { toolName, args, agentId, ... }
 * @returns {{ allowed: boolean, reason?: string, context: object }}
 */
export async function runBeforeHooks(event, context) {
  const hooks = _hooks.get(event) || [];
  let currentContext = { ...context };

  for (const hook of hooks) {
    try {
      const result = await hook.fn(currentContext);
      if (!result) continue;

      // Abort?
      if (result.abort) {
        return {
          allowed: false,
          reason: result.reason || `Blocked by hook ${hook.id}`,
          hookId: hook.id,
          context: currentContext,
        };
      }

      // Modify context?
      if (result.modified) {
        currentContext = { ...currentContext, ...result.modified };
      }
    } catch (e) {
      // Hook errors don't block — log and continue
      console.warn(`[hooks] ${event} hook ${hook.id} error:`, e.message);
    }
  }

  return { allowed: true, context: currentContext };
}

/**
 * Run "after" hooks — observe and optionally transform result
 *
 * @param {string} event - e.g. 'tool.after'
 * @param {object} context - { toolName, args, result, agentId, ... }
 * @returns {object} possibly modified context
 */
export async function runAfterHooks(event, context) {
  const hooks = _hooks.get(event) || [];
  let currentContext = { ...context };

  for (const hook of hooks) {
    try {
      const result = await hook.fn(currentContext);
      if (result?.modified) {
        currentContext = { ...currentContext, ...result.modified };
      }
    } catch (e) {
      console.warn(`[hooks] ${event} hook ${hook.id} error:`, e.message);
    }
  }

  return currentContext;
}

// ========== Status ==========

/**
 * List all registered hooks
 */
export function listHooks() {
  const result = {};
  for (const [event, hooks] of _hooks) {
    result[event] = hooks.map(h => ({ id: h.id, priority: h.priority }));
  }
  return result;
}

/**
 * Get hook count
 */
export function hookCount() {
  let total = 0;
  for (const hooks of _hooks.values()) total += hooks.length;
  return { total, events: _hooks.size };
}

// ========== Built-in Hooks ==========

/**
 * Register the command safety hook (integrates command-safety.js into hook lifecycle)
 */
export function registerCommandSafetyHook() {
  return registerHook('tool.before', async (ctx) => {
    // Check any tool with a 'command' arg, not just tools named 'shell_exec'
    if (!ctx.args?.command) return null;
    const isShellLike = ctx.toolName === 'shell_exec' || ctx.category === 'execute' || ctx.toolName?.includes('shell') || ctx.toolName?.includes('exec');
    if (!isShellLike) return null;

    const { inspectCommand } = await import('./command-safety.js');
    const inspection = inspectCommand(ctx.args.command);

    if (inspection.level === 'block') {
      return {
        abort: true,
        reason: `Dangerous command blocked: ${inspection.matches.map(m => m.description).join('; ')}`,
      };
    }

    if (inspection.level === 'warn') {
      // Attach warnings to context for downstream (approval queue sees it)
      return {
        modified: {
          _commandWarnings: inspection.matches.map(m => m.description),
          _commandSeverity: 'warn',
        },
      };
    }

    return null;
  }, { id: 'builtin-command-safety', priority: 10 });
}

/**
 * Register a prompt injection defense hook
 * Scans tool args for common injection patterns
 */
export function registerInjectionDefenseHook() {
  const INJECTION_PATTERNS = [
    /ignore\s+(previous|above|all)\s+(\w+\s+)?(instructions|prompts|rules)/i,
    /you\s+are\s+now\s+(a|an|the)\s+/i,
    /system\s*:\s*you\s+are/i,
    /\bDAN\b.*\bjailbreak\b/i,
    /pretend\s+you\s+(are|have)\s+no\s+(restrictions|rules|limits)/i,
    /override\s+(safety|security|restrictions)/i,
    /\bact\s+as\b.*\bunrestricted\b/i,
  ];

  return registerHook('tool.before', async (ctx) => {
    const argsStr = JSON.stringify(ctx.args || {});
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(argsStr)) {
        return {
          abort: true,
          reason: `Potential prompt injection detected in tool args`,
        };
      }
    }
    return null;
  }, { id: 'builtin-injection-defense', priority: 5 });
}

export default {
  registerHook, removeHook, clearHooks,
  runBeforeHooks, runAfterHooks,
  listHooks, hookCount,
  registerCommandSafetyHook, registerInjectionDefenseHook,
};
