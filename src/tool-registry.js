/**
 * Tool Registry — Dynamic Tool Registration & Execution Pipeline
 *
 * Replaces hardcoded tool catalogs with:
 * - Dynamic register/unregister
 * - Capability binding (role → tools)
 * - Hook/safety pipeline integration
 * - Manifest/snapshot for introspection
 *
 * Shared core: works with both A and B versions.
 *
 * Design reference: Hermes registry.py + HELIX_TOOL_REGISTRY_PATTERN_SPEC.
 */

import { runBeforeHooks, runAfterHooks } from './hooks.js';

// ========== Registry Store ==========

const _tools = new Map(); // name → ToolDefinition
const _capabilityBindings = new Map(); // roleId → Set<toolName>

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {string} level - 'L1' | 'L2' | 'L3'
 * @property {string} category - 'read' | 'write' | 'execute' | 'communicate' | 'manage'
 * @property {object} inputSchema - { required: string[], optional: string[] }
 * @property {function} handler - async (args, context) => result
 * @property {object} [metadata] - extra info
 */

// ========== Registration ==========

/**
 * Register a tool
 * @param {ToolDefinition} def
 */
export function register(def) {
  if (!def.name) throw new Error('Tool name required');
  if (!/^[\w\-.:]+$/.test(def.name)) throw new Error(`Tool name '${def.name}' contains invalid characters (allowed: a-z, 0-9, -, _, ., :)`);
  if (!def.handler || typeof def.handler !== 'function') throw new Error(`Tool ${def.name}: handler must be a function`);

  _tools.set(def.name, {
    name: def.name,
    description: def.description || '',
    level: def.level || 'L2',
    category: def.category || 'execute',
    inputSchema: def.inputSchema || { required: [], optional: [] },
    handler: def.handler,
    metadata: def.metadata || {},
    registeredAt: Date.now(),
  });

  return { ok: true, name: def.name };
}

/**
 * Register multiple tools at once
 */
export function registerBatch(tools) {
  return tools.map(t => {
    try { return register(t); }
    catch (e) { return { ok: false, name: t.name, error: e.message }; }
  });
}

/**
 * Unregister a tool
 */
export function unregister(name) {
  if (!_tools.has(name)) return { ok: false, error: 'tool not found' };
  _tools.delete(name);
  return { ok: true, name };
}

// ========== Capability Binding ==========

/**
 * Bind tools to a role
 */
export function bindCapabilities(roleId, toolNames) {
  const existing = _capabilityBindings.get(roleId);
  if (existing) {
    for (const t of toolNames) existing.add(t);
  } else {
    _capabilityBindings.set(roleId, new Set(toolNames));
  }
}

/**
 * Check if a role can use a tool
 */
export function hasCapability(roleId, toolName) {
  const bindings = _capabilityBindings.get(roleId);
  if (!bindings) return true; // No binding = unrestricted
  return bindings.has(toolName) || bindings.has('*');
}

/**
 * Get tools available for a role
 */
export function getToolsForRole(roleId) {
  const bindings = _capabilityBindings.get(roleId);
  if (!bindings) return [..._tools.values()]; // No binding = all tools
  if (bindings.has('*')) return [..._tools.values()];
  return [..._tools.values()].filter(t => bindings.has(t.name));
}

// ========== Execution Pipeline ==========

/**
 * Execute a tool through the full pipeline:
 * 1. Check existence
 * 2. Check capability
 * 3. Run before hooks (can abort)
 * 4. Validate input
 * 5. Execute handler
 * 6. Run after hooks (can modify result)
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} context - { agentId, roleId, taskId, traceId }
 * @returns {{ ok, result?, error?, blocked?, hookId? }}
 */
export async function execute(toolName, args = {}, context = {}) {
  // 1. Check existence
  const tool = _tools.get(toolName);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${toolName}` };
  }

  // 2. Check capability
  if (context.roleId && !hasCapability(context.roleId, toolName)) {
    return { ok: false, error: `Role ${context.roleId} lacks capability for tool ${toolName}` };
  }

  // 3. Before hooks
  const hookCtx = {
    toolName,
    args,
    agentId: context.agentId || 'unknown',
    roleId: context.roleId,
    taskId: context.taskId,
    level: tool.level,
    category: tool.category,
  };

  const beforeResult = await runBeforeHooks('tool.before', hookCtx);
  if (!beforeResult.allowed) {
    return {
      ok: false,
      blocked: true,
      error: beforeResult.reason,
      hookId: beforeResult.hookId,
    };
  }

  // Use potentially modified args from hooks
  const finalArgs = beforeResult.context.args || args;

  // 4. Validate input
  if (tool.inputSchema.required?.length) {
    for (const field of tool.inputSchema.required) {
      if (finalArgs[field] === undefined || finalArgs[field] === null) {
        return { ok: false, error: `Missing required argument: ${field}` };
      }
    }
  }

  // 5. Execute
  const startTime = Date.now();
  let result;
  try {
    result = await tool.handler(finalArgs, context);
  } catch (e) {
    // After hooks even on error
    await runAfterHooks('tool.after', { ...hookCtx, error: e.message, duration: Date.now() - startTime });
    return { ok: false, error: e.message, duration: Date.now() - startTime };
  }

  const duration = Date.now() - startTime;

  // 6. After hooks
  const afterCtx = await runAfterHooks('tool.after', {
    ...hookCtx,
    result,
    duration,
  });

  return {
    ok: true,
    result: afterCtx.result !== undefined ? afterCtx.result : result,
    duration,
    tool: toolName,
    level: tool.level,
  };
}

// ========== Introspection ==========

/**
 * Get tool manifest (for LLM system prompt or MCP)
 */
export function getManifest({ roleId = null, format = 'list' } = {}) {
  const tools = roleId ? getToolsForRole(roleId) : [..._tools.values()];

  if (format === 'openai') {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            [...(t.inputSchema.required || []), ...(t.inputSchema.optional || [])].map(f => [f, { type: 'string' }])
          ),
          required: t.inputSchema.required || [],
        },
      },
    }));
  }

  return tools.map(t => ({
    name: t.name,
    description: t.description,
    level: t.level,
    category: t.category,
    inputSchema: t.inputSchema,
  }));
}

/**
 * Get prompt-ready tool catalog text
 */
export function getCatalogText(roleId = null) {
  const tools = roleId ? getToolsForRole(roleId) : [..._tools.values()];
  return tools.map(t => {
    const args = [...(t.inputSchema.required || []).map(a => `${a} (必填)`), ...(t.inputSchema.optional || []).map(a => `${a} (選填)`)].join(', ');
    return `- ${t.name}: ${t.description}${args ? ` [${args}]` : ''}`;
  }).join('\n');
}

/**
 * Get registry snapshot
 */
export function snapshot() {
  return {
    totalTools: _tools.size,
    totalBindings: _capabilityBindings.size,
    tools: [..._tools.values()].map(t => ({
      name: t.name,
      level: t.level,
      category: t.category,
      registeredAt: t.registeredAt,
    })),
    bindings: Object.fromEntries(
      [..._capabilityBindings.entries()].map(([role, tools]) => [role, [...tools]])
    ),
  };
}

/**
 * Get a single tool definition
 */
export function getTool(name) {
  return _tools.get(name) || null;
}

/**
 * Check if a tool is registered
 */
export function has(name) {
  return _tools.has(name);
}

/**
 * Get tool count
 */
export function count() {
  return _tools.size;
}

export default {
  register, registerBatch, unregister,
  bindCapabilities, hasCapability, getToolsForRole,
  execute,
  getManifest, getCatalogText, snapshot, getTool, has, count,
};
