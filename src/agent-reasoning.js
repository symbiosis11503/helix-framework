/**
 * Agent Reasoning — Plan-Act-Observe Loop
 *
 * Inspired by Firecrawl's Deep Agents pattern.
 * Provides structured reasoning cycles for complex tasks:
 *   1. PLAN  — Break task into steps, select tools
 *   2. ACT   — Execute selected tool/action
 *   3. OBSERVE — Evaluate result, update context
 *   4. DECIDE — Continue, adjust plan, or complete
 *
 * Integrates with:
 *   - tool-registry.js for tool execution
 *   - session-store.js for context persistence
 *   - memory-manager.js for long-term knowledge recall
 *   - hooks.js for lifecycle interception
 *   - llm-provider.js for LLM reasoning calls
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

// ========== Constants ==========

const MAX_ITERATIONS = 20;
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes per iteration

// ========== Reasoning Loop ==========

/**
 * Execute a reasoning loop for a complex task
 *
 * @param {object} opts
 * @param {string} opts.task - What to accomplish
 * @param {string} opts.agentId - Agent executing the task
 * @param {object} opts.llm - { model, apiKey } for reasoning calls
 * @param {string} [opts.systemPrompt] - Base system prompt
 * @param {object} [opts.tools] - Available tools (from tool-registry)
 * @param {number} [opts.maxIterations=20] - Max reasoning cycles
 * @param {function} [opts.onStep] - Callback: (step) => void
 * @param {string} [opts.sessionId] - Existing session for context
 * @returns {{ ok, result, steps, iterations, duration }}
 */
export async function reason({
  task,
  agentId,
  llm,
  systemPrompt = '',
  tools = null,
  maxIterations = MAX_ITERATIONS,
  onStep = null,
  sessionId = null,
}) {
  const startTime = Date.now();
  const steps = [];
  let context = '';
  let completed = false;
  let finalResult = null;

  // Pre-load modules once (avoid repeated dynamic imports in loop)
  const llmMod = await import('./llm-provider.js');
  const trMod = await safeImport('./tool-registry.js');
  const mmMod = await safeImport('./memory-manager.js');
  const ss = sessionId ? await safeImport('./session-store.js') : null;

  // Load available tools
  let toolCatalog = '';
  if (tools) {
    toolCatalog = typeof tools === 'string' ? tools : formatToolCatalog(tools);
  } else if (trMod) {
    try { toolCatalog = trMod.getCatalogText(); } catch {}
  }

  // Load memory context
  let memoryContext = '';
  if (mmMod) {
    try {
      const memCtx = await mmMod.buildMemoryContext(agentId, task, { maxTokens: 1500 });
      if (memCtx.text) memoryContext = memCtx.text;
    } catch (e) { console.warn('[reasoning] memory context load failed:', e.message); }
  }

  // Build reasoning system prompt
  const reasoningPrompt = buildReasoningPrompt(systemPrompt, toolCatalog, memoryContext);

  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now();

    // ===== PLAN =====
    const planPrompt = buildPlanPrompt(task, context, steps, i);

    let llmResponse;
    try {
      llmResponse = await llmMod.chat({
        model: llm.model,
        apiKey: llm.apiKey,
        systemPrompt: reasoningPrompt,
        message: planPrompt,
        options: { responseFormat: 'json', temperature: 0.3 },
      });
    } catch (e) {
      steps.push({ iteration: i, phase: 'plan', error: e.message });
      break;
    }

    // Parse the LLM's decision
    const decision = parseDecision(llmResponse.reply);

    if (!decision) {
      steps.push({ iteration: i, phase: 'plan', error: 'Failed to parse LLM decision', raw: llmResponse.reply?.slice(0, 300) });
      break;
    }

    // ===== CHECK COMPLETION =====
    if (decision.status === 'complete') {
      finalResult = decision.result || decision.summary;
      completed = true;
      steps.push({ iteration: i, phase: 'complete', result: finalResult });
      if (onStep) onStep({ iteration: i, phase: 'complete', result: finalResult });
      break;
    }

    // ===== ACT =====
    const step = {
      iteration: i,
      phase: 'act',
      action: decision.action,
      tool: decision.tool,
      params: decision.params,
      reasoning: decision.reasoning,
    };

    let actionResult;
    if (decision.tool && decision.tool !== 'none' && trMod) {
      // Execute tool via registry with timeout
      try {
        const toolPromise = trMod.execute(decision.tool, decision.params || {});
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool timeout after ${DEFAULT_TIMEOUT_MS}ms`)), DEFAULT_TIMEOUT_MS));
        actionResult = await Promise.race([toolPromise, timeoutPromise]);
        step.toolResult = typeof actionResult === 'string' ? actionResult : JSON.stringify(actionResult);
      } catch (e) {
        step.toolError = e.message;
        actionResult = `[tool error] ${e.message}`;
      }
    } else if (decision.action) {
      // Direct action (no tool needed — LLM reasoning step)
      actionResult = decision.action;
    }

    step.result = typeof actionResult === 'string' ? actionResult?.slice(0, 2000) : JSON.stringify(actionResult)?.slice(0, 2000);
    step.durationMs = Date.now() - iterStart;
    steps.push(step);

    if (onStep) onStep(step);

    // Persist step to session
    if (ss) {
      try {
        await ss.appendMessage({
          sessionId,
          role: 'assistant',
          content: `[reasoning step ${i}] ${decision.reasoning || ''}\nAction: ${decision.tool || decision.action}\nResult: ${step.result?.slice(0, 500)}`,
          metadata: { reasoning: true, iteration: i },
        });
      } catch (e) { console.warn('[reasoning] session persist failed:', e.message); }
    }

    // ===== OBSERVE =====
    // Update context with the result of this action
    context += `\n\n[Step ${i}] ${decision.reasoning || ''}\nAction: ${decision.tool || decision.action || 'think'}\nResult: ${step.result?.slice(0, 800)}`;

    // Trim context if too long (keep last 6000 chars)
    if (context.length > 8000) {
      context = '...[earlier steps truncated]...\n' + context.slice(-6000);
    }
  }

  const duration = Date.now() - startTime;

  // Store final result as memory if significant
  if (completed && finalResult && mmMod) {
    try {
      await mmMod.remember({
        agentId,
        type: 'procedural',
        content: `Task: ${task}\nResult: ${finalResult.slice(0, 500)}`,
        summary: `Completed: ${task.slice(0, 100)}`,
        importance: 0.6,
        tags: ['reasoning', 'completed'],
      });
    } catch (e) { console.warn('[reasoning] memory store failed:', e.message); }
  }

  return {
    ok: completed,
    result: finalResult,
    steps,
    iterations: steps.length,
    duration,
    completed,
  };
}

// ========== Prompt Builders ==========

function buildReasoningPrompt(systemPrompt, toolCatalog, memoryContext) {
  const parts = [
    systemPrompt || 'You are an AI agent that reasons step-by-step to accomplish tasks.',
    '',
    '## Reasoning Protocol',
    'You operate in a plan-act-observe loop. Each iteration, respond with a JSON decision:',
    '',
    '### If you need to take an action:',
    '```json',
    '{',
    '  "status": "continue",',
    '  "reasoning": "Why I\'m taking this step",',
    '  "tool": "tool_name",',
    '  "params": { "key": "value" },',
    '  "action": "description of what I\'m doing"',
    '}',
    '```',
    '',
    '### If the task is complete:',
    '```json',
    '{',
    '  "status": "complete",',
    '  "result": "Final answer or output",',
    '  "summary": "Brief summary of what was accomplished"',
    '}',
    '```',
    '',
    '### If you just need to think (no tool):',
    '```json',
    '{',
    '  "status": "continue",',
    '  "reasoning": "My analysis...",',
    '  "tool": "none",',
    '  "action": "thinking/analyzing"',
    '}',
    '```',
  ];

  if (toolCatalog) {
    parts.push('', '## Available Tools', toolCatalog);
  }

  if (memoryContext) {
    parts.push('', memoryContext);
  }

  return parts.join('\n');
}

function buildPlanPrompt(task, context, steps, iteration) {
  const parts = [`## Task\n${task}`];

  if (context) {
    parts.push(`\n## Previous Steps & Results\n${context}`);
  }

  if (iteration === 0) {
    parts.push('\n## Instructions\nAnalyze the task and decide your first action. Respond with JSON.');
  } else {
    parts.push(`\n## Instructions\nIteration ${iteration}. Based on previous results, decide next action or complete. Respond with JSON.`);
  }

  return parts.join('\n');
}

// ========== Decision Parser ==========

function parseDecision(reply) {
  if (!reply) return null;

  // Try 1: extract from markdown code block (most reliable)
  try {
    const codeMatch = reply.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeMatch) {
      const parsed = JSON.parse(codeMatch[1]);
      if (parsed.status) return parsed;
    }
  } catch {}

  // Try 2: direct JSON parse of full reply
  try {
    const parsed = JSON.parse(reply.trim());
    if (parsed.status) return parsed;
  } catch {}

  // Try 3: find JSON object with balanced braces
  try {
    const start = reply.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      let end = start;
      for (let i = start; i < reply.length; i++) {
        if (reply[i] === '{') depth++;
        else if (reply[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      const parsed = JSON.parse(reply.slice(start, end));
      if (parsed.status) return parsed;
    }
  } catch {}

  return null;
}

// ========== Tool Catalog Formatter ==========

function formatToolCatalog(tools) {
  if (Array.isArray(tools)) {
    return tools.map(t => `- **${t.name}**: ${t.description || ''}`).join('\n');
  }
  if (typeof tools === 'object') {
    return Object.entries(tools).map(([name, t]) => `- **${name}**: ${t.description || ''}`).join('\n');
  }
  return String(tools);
}

// ========== Safe Import ==========

async function safeImport(path) {
  try { return await import(path); } catch { return null; }
}

// ========== Convenience: Single-step reasoning ==========

/**
 * Ask the LLM a single reasoning question (no loop)
 * Useful for quick analysis or classification tasks
 */
export async function analyze({ question, context, llm, responseFormat = 'text' }) {
  const llmMod = await import('./llm-provider.js');
  const result = await llmMod.chat({
    model: llm.model,
    apiKey: llm.apiKey,
    systemPrompt: 'You are an analytical AI. Answer precisely and concisely.',
    message: context ? `${context}\n\n${question}` : question,
    options: { responseFormat, temperature: 0.2 },
  });
  return result;
}

export default { reason, analyze };
