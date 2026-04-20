/**
 * Session Store — Context OS Layer 1
 *
 * Provides session-grade conversation persistence:
 * - sessions table: per-agent conversation containers
 * - messages table: per-message storage with role/content/tool metadata
 * - parent_session_id: compression-aware session chaining
 * - FTS search over conversation history (tsvector PG / FTS5 SQLite)
 * - summary_snapshot: compressed context carry-forward
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Session CRUD ==========

/**
 * Create a new session for an agent
 * @param {object} opts
 * @param {string} opts.agentId - owner agent
 * @param {string} [opts.parentSessionId] - previous compressed session
 * @param {string} [opts.systemPrompt] - frozen system prompt for cache
 * @param {object} [opts.metadata] - extra context
 * @returns {{ id: string }}
 */
export async function createSession({ agentId, parentSessionId = null, systemPrompt = null, metadata = {} }) {
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await query(
    `INSERT INTO sessions (id, agent_id, parent_session_id, system_prompt, metadata, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'active', ${getType() === 'pg' ? 'now()' : "datetime('now')"})`,
    [id, agentId, parentSessionId, systemPrompt, JSON.stringify(metadata)]
  );
  return { id };
}

/**
 * Get session by ID
 */
export async function getSession(sessionId) {
  const r = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  return r.rows[0] || null;
}

/**
 * List sessions for an agent (most recent first)
 */
export async function listSessions(agentId, { limit = 20, status = null } = {}) {
  let sql = 'SELECT id, agent_id, parent_session_id, status, message_count, total_tokens, summary_snapshot, created_at, updated_at FROM sessions WHERE agent_id = $1';
  const params = [agentId];
  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  return (await query(sql, params)).rows;
}

/**
 * Update session metadata (token count, summary, status)
 */
export async function updateSession(sessionId, updates = {}) {
  const sets = [];
  const params = [];
  let idx = 1;

  if (updates.status !== undefined) { sets.push(`status = $${idx++}`); params.push(updates.status); }
  if (updates.message_count !== undefined) { sets.push(`message_count = $${idx++}`); params.push(updates.message_count); }
  if (updates.total_tokens !== undefined) { sets.push(`total_tokens = $${idx++}`); params.push(updates.total_tokens); }
  if (updates.summary_snapshot !== undefined) { sets.push(`summary_snapshot = $${idx++}`); params.push(updates.summary_snapshot); }

  sets.push(`updated_at = ${getType() === 'pg' ? 'now()' : "datetime('now')"}`);

  if (sets.length === 1) return; // only updated_at, skip
  params.push(sessionId);
  await query(`UPDATE sessions SET ${sets.join(', ')} WHERE id = $${idx}`, params);
}

/**
 * Get session chain — walk parent_session_id to reconstruct history
 */
export async function getSessionChain(sessionId, { maxDepth = 10 } = {}) {
  const chain = [];
  let currentId = sessionId;
  let depth = 0;

  while (currentId && depth < maxDepth) {
    const sess = await getSession(currentId);
    if (!sess) break;
    chain.unshift(sess); // oldest first
    currentId = sess.parent_session_id;
    depth++;
  }

  return chain;
}

// ========== Message CRUD ==========

/**
 * Append a message to a session
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.role - 'system' | 'user' | 'assistant' | 'tool'
 * @param {string} opts.content - message text
 * @param {string} [opts.toolCallId] - for tool results
 * @param {string} [opts.toolName] - tool that was called
 * @param {object} [opts.metadata] - extra data (token count, model, etc.)
 * @returns {{ id: number, seq: number }}
 */
export async function appendMessage({ sessionId, role, content, toolCallId = null, toolName = null, metadata = {} }) {
  const isPg = getType() === 'pg';
  const now = isPg ? 'now()' : "datetime('now')";
  const tokenEstimate = estimateTokens(content || '');

  // Get next seq — single-writer per session in practice (agent runtime is sequential)
  const countResult = await query(
    'SELECT COALESCE(MAX(seq), 0) as max_seq FROM messages WHERE session_id = $1',
    [sessionId]
  );
  const seq = (countResult.rows[0]?.max_seq || 0) + 1;

  const r = await query(
    `INSERT INTO messages (session_id, seq, role, content, tool_call_id, tool_name, token_estimate, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${now})${isPg ? ' RETURNING id' : ''}`,
    [sessionId, seq, role, content, toolCallId, toolName, tokenEstimate, JSON.stringify(metadata)]
  );

  // Update session counters
  await query(
    `UPDATE sessions SET message_count = message_count + 1, total_tokens = total_tokens + $1, updated_at = ${now} WHERE id = $2`,
    [tokenEstimate, sessionId]
  );

  return { id: isPg ? r.rows[0]?.id : (r.rows[0]?.id || r.rowCount), seq };
}

/**
 * Get all messages in a session (ordered by seq)
 */
export async function getMessages(sessionId, { limit = 500, offset = 0 } = {}) {
  const r = await query(
    `SELECT id, seq, role, content, tool_call_id, tool_name, token_estimate, metadata, status, created_at
     FROM messages WHERE session_id = $1 AND status != 'pruned'
     ORDER BY seq ASC LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset]
  );
  return r.rows;
}

/**
 * Get recent messages (tail) — for context building
 */
export async function getRecentMessages(sessionId, { tokenBudget = 8000 } = {}) {
  // Get all messages and walk backward until budget exhausted
  const all = await getMessages(sessionId, { limit: 1000 });
  const result = [];
  let tokens = 0;

  for (let i = all.length - 1; i >= 0; i--) {
    const est = all[i].token_estimate || estimateTokens(all[i].content || '');
    if (tokens + est > tokenBudget && result.length > 0) break;
    result.unshift(all[i]);
    tokens += est;
  }

  return result;
}

/**
 * Mark messages as pruned (soft delete for compression)
 */
export async function pruneMessages(sessionId, { beforeSeq }) {
  const r = await query(
    `UPDATE messages SET status = 'pruned' WHERE session_id = $1 AND seq < $2 AND status = 'active'`,
    [sessionId, beforeSeq]
  );
  return { pruned: r.rowCount };
}

// ========== FTS Search ==========

/**
 * Search conversation history by text
 * @param {string} agentId
 * @param {string} queryText
 * @param {object} [opts]
 * @returns {Array<{session_id, seq, role, content, snippet}>}
 */
export async function searchMessages(agentId, queryText, { limit = 20, sessionId = null } = {}) {
  if (getType() === 'pg') {
    // PG: use ILIKE fallback (no search_vector on messages table)
    // CJK and mixed-language content works better with ILIKE than tsvector
    let sql = `
      SELECT m.session_id, m.seq, m.role,
             substring(m.content from 1 for 500) as content,
             m.created_at,
             substring(m.content from greatest(1, position($1 in m.content) - 30) for 80) as snippet
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.agent_id = $2
        AND m.content ILIKE '%' || $1 || '%'
        AND m.status = 'active'`;
    const params = [queryText, agentId];

    if (sessionId) {
      sql += ` AND m.session_id = $3`;
      params.push(sessionId);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    return (await query(sql, params)).rows;
  } else {
    // SQLite: use FTS5
    let sql = `
      SELECT m.session_id, m.seq, m.role, m.content, m.created_at,
             snippet(messages_fts, 0, '<b>', '</b>', '...', 30) as snippet
      FROM messages_fts fts
      JOIN messages m ON m.id = fts.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE s.agent_id = $1
        AND messages_fts MATCH $2
        AND m.status = 'active'`;
    const params = [agentId, queryText];

    if (sessionId) {
      sql += ` AND m.session_id = $3`;
      params.push(sessionId);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    return (await query(sql, params)).rows;
  }
}

// ========== Context Building ==========

/**
 * Build session context for prompt injection
 * Combines: summary from parent chain + recent messages
 */
export async function buildSessionContext(sessionId, { maxTokens = 12000 } = {}) {
  const session = await getSession(sessionId);
  if (!session) return { text: '', tokens: 0 };

  const parts = [];
  let tokenCount = 0;

  // 1. Include summary from parent chain (if compressed)
  if (session.parent_session_id) {
    const chain = await getSessionChain(session.parent_session_id, { maxDepth: 3 });
    for (const parent of chain) {
      if (parent.summary_snapshot) {
        const summary = parent.summary_snapshot;
        const est = estimateTokens(summary);
        if (tokenCount + est < maxTokens * 0.3) { // Reserve 30% budget for summaries
          parts.push(`[Session ${parent.id} summary]\n${summary}`);
          tokenCount += est;
        }
      }
    }
  }

  // 2. Include current session's summary if exists
  if (session.summary_snapshot) {
    const est = estimateTokens(session.summary_snapshot);
    parts.push(`[Current session summary]\n${session.summary_snapshot}`);
    tokenCount += est;
  }

  // 3. Recent messages (fill remaining budget)
  const remainingBudget = maxTokens - tokenCount;
  const recent = await getRecentMessages(sessionId, { tokenBudget: remainingBudget });
  for (const msg of recent) {
    const est = msg.token_estimate || estimateTokens(msg.content || '');
    parts.push(`[${msg.role}] ${msg.content}`);
    tokenCount += est;
  }

  return {
    text: parts.join('\n\n'),
    tokens: tokenCount,
    messageCount: recent.length,
    hasParentChain: !!session.parent_session_id,
  };
}

// ========== Session Compression (Checkpoint) ==========

/**
 * Structured summary template — stable format for downstream consumption.
 * Used by compression, workflow continuation, review/trace.
 */
const SUMMARY_TEMPLATE = `## Goal
{goal}

## Progress
{progress}

## Decisions
{decisions}

## Files / Artifacts
{artifacts}

## Open State
{open_state}`;

/**
 * Build a structured summary prompt for LLM compression
 */
function buildSummaryPrompt(messages) {
  const formatted = messages.map(m => {
    const role = m.role || 'unknown';
    const content = (m.content || '').slice(0, 500);
    const toolInfo = m.tool_name ? ` [tool: ${m.tool_name}]` : '';
    return `[${role}${toolInfo}] ${content}`;
  }).join('\n');

  return `Summarize the following conversation segment into a structured summary.
Use this exact format:

## Goal
- What was the session trying to accomplish

## Progress
- What was completed

## Decisions
- Key decisions made

## Files / Artifacts
- Important files, endpoints, or resources mentioned

## Open State
- What remains unfinished and needs continuation

Conversation:
${formatted}

Respond with the structured summary only, no extra text.`;
}

/**
 * Compress a session — create summary, chain to new session
 *
 * Head/tail protection + middle summary + carry-forward.
 * Summary uses structured template for stable downstream parsing.
 *
 * @param {string} sessionId - session to compress
 * @param {function} summarizeFn - async (messages, prompt) => summary string
 *   If summarizeFn accepts 2 args: (messages, structuredPrompt)
 *   If summarizeFn accepts 1 arg: (messages) — raw messages only
 * @param {object} [opts]
 * @param {number} [opts.headCount=2] - messages to protect at start
 * @param {number} [opts.tailCount=4] - messages to protect at end
 * @param {boolean} [opts.pruneToolOutput=false] - v2: truncate old tool outputs
 * @returns {{ compressed, oldSessionId, newSessionId, summaryLength, prunedMessages, carriedMessages }}
 */
export async function compressSession(sessionId, summarizeFn, opts = {}) {
  const { headCount = 2, tailCount = 4, pruneToolOutput = false } = opts;

  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  const messages = await getMessages(sessionId);
  if (messages.length < headCount + tailCount + 2) {
    return { compressed: false, reason: 'too few messages to compress' };
  }

  // Protect head and tail
  const head = messages.slice(0, headCount);
  const middle = messages.slice(headCount, -tailCount);
  const tail = messages.slice(-tailCount);

  if (middle.length === 0) {
    return { compressed: false, reason: 'nothing to compress' };
  }

  // v2: Prune oversized tool outputs in middle before summarizing
  const middleForSummary = pruneToolOutput
    ? middle.map(m => {
        if (m.role === 'tool' && m.content && m.content.length > 500) {
          return { ...m, content: m.content.slice(0, 200) + '\n... [tool output truncated] ...\n' + m.content.slice(-100) };
        }
        return m;
      })
    : middle;

  // Generate summary
  const structuredPrompt = buildSummaryPrompt(middleForSummary);
  let summary;
  try {
    // Try passing both messages and prompt (LLM-based)
    summary = summarizeFn.length >= 2
      ? await summarizeFn(middleForSummary, structuredPrompt)
      : await summarizeFn(middleForSummary);
  } catch (e) {
    // Fallback: build basic structured summary from messages
    const goals = middleForSummary.filter(m => m.role === 'user').map(m => `- ${(m.content || '').slice(0, 80)}`).slice(0, 3);
    const progress = middleForSummary.filter(m => m.role === 'assistant').map(m => `- ${(m.content || '').slice(0, 80)}`).slice(0, 3);
    const tools = middleForSummary.filter(m => m.tool_name).map(m => `- ${m.tool_name}`);
    const uniqueTools = [...new Set(tools)].slice(0, 5);

    summary = SUMMARY_TEMPLATE
      .replace('{goal}', goals.join('\n') || '- (not captured)')
      .replace('{progress}', progress.join('\n') || '- (not captured)')
      .replace('{decisions}', '- (see parent chain)')
      .replace('{artifacts}', uniqueTools.join('\n') || '- (none)')
      .replace('{open_state}', '- (see recent messages)');
  }

  // Carry forward: iterative summary update (v2 pattern)
  // If session already has a summary, merge rather than replace
  const fullSummary = session.summary_snapshot
    ? `${session.summary_snapshot}\n\n---\n[Continuation ${new Date().toISOString()}]\n\n${summary}`
    : summary;

  // Update current session: mark as compressed, store summary
  await updateSession(sessionId, {
    status: 'compressed',
    summary_snapshot: fullSummary,
  });

  // Prune middle messages (soft delete)
  if (middle.length > 0) {
    await pruneMessages(sessionId, { beforeSeq: tail[0].seq });
  }

  // Create new session chained to this one
  const newSession = await createSession({
    agentId: session.agent_id,
    parentSessionId: sessionId,
    systemPrompt: session.system_prompt,
    metadata: {
      compressed_from: sessionId,
      compressed_at: new Date().toISOString(),
      compression_stats: {
        pruned: middle.length,
        carried: tail.length,
        summary_chars: fullSummary.length,
      },
    },
  });

  // Copy protected tail messages to new session
  for (const msg of tail) {
    await appendMessage({
      sessionId: newSession.id,
      role: msg.role,
      content: msg.content,
      toolCallId: msg.tool_call_id,
      toolName: msg.tool_name,
      metadata: typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {}),
    });
  }

  return {
    compressed: true,
    oldSessionId: sessionId,
    newSessionId: newSession.id,
    summaryLength: fullSummary.length,
    prunedMessages: middle.length,
    carriedMessages: tail.length,
  };
}

// ========== Stats ==========

export async function sessionStats(agentId) {
  const total = await query(
    'SELECT COUNT(*) as count FROM sessions WHERE agent_id = $1', [agentId]
  );
  const active = await query(
    "SELECT COUNT(*) as count FROM sessions WHERE agent_id = $1 AND status = 'active'", [agentId]
  );
  const compressed = await query(
    "SELECT COUNT(*) as count FROM sessions WHERE agent_id = $1 AND status = 'compressed'", [agentId]
  );
  const totalMessages = await query(
    `SELECT COALESCE(SUM(s.message_count), 0) as count FROM sessions s WHERE s.agent_id = $1`, [agentId]
  );
  const totalTokens = await query(
    `SELECT COALESCE(SUM(s.total_tokens), 0) as count FROM sessions s WHERE s.agent_id = $1`, [agentId]
  );

  return {
    sessions: {
      total: total.rows[0]?.count || 0,
      active: active.rows[0]?.count || 0,
      compressed: compressed.rows[0]?.count || 0,
    },
    messages: totalMessages.rows[0]?.count || 0,
    tokens: totalTokens.rows[0]?.count || 0,
  };
}

// ========== Utilities ==========

/**
 * Estimate token count — rough heuristic
 * ~4 chars/token English, ~2 chars/token CJK
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Count CJK characters
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const nonCjk = text.length - cjk;
  return Math.ceil(nonCjk / 4 + cjk / 2);
}

// ========== LLM Summarizer Factory ==========

/**
 * Create an LLM-powered summarizer for compressSession()
 * Uses Gemini API by default. Falls back to simple concatenation.
 *
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - Gemini API key (or from env GEMINI_API_KEY)
 * @param {string} [opts.model] - model name (default: gemini-2.5-flash)
 * @returns {function} async (messages, structuredPrompt) => summary string
 */
export function createLLMSummarizer(opts = {}) {
  const apiKey = opts.apiKey || process.env.GEMINI_API_KEY;
  const model = opts.model || 'gemini-2.5-flash';

  return async function llmSummarizer(messages, structuredPrompt) {
    if (!apiKey) {
      // Fallback: structured summary from messages without LLM
      return fallbackSummary(messages);
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: structuredPrompt }] }],
            generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
          }),
        }
      );

      if (!res.ok) throw new Error(`Gemini API ${res.status}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      throw new Error('empty response');
    } catch (e) {
      console.warn(`[session-store] LLM summarizer failed: ${e.message}, using fallback`);
      return fallbackSummary(messages);
    }
  };
}

function fallbackSummary(messages) {
  const goals = messages.filter(m => m.role === 'user').map(m => `- ${(m.content || '').slice(0, 80)}`).slice(0, 3);
  const progress = messages.filter(m => m.role === 'assistant').map(m => `- ${(m.content || '').slice(0, 80)}`).slice(0, 3);
  const tools = [...new Set(messages.filter(m => m.tool_name).map(m => `- ${m.tool_name}`))].slice(0, 5);

  return `## Goal\n${goals.join('\n') || '- (not captured)'}\n\n## Progress\n${progress.join('\n') || '- (not captured)'}\n\n## Decisions\n- (see parent chain)\n\n## Files / Artifacts\n${tools.join('\n') || '- (none)'}\n\n## Open State\n- (see recent messages)`;
}

export default {
  createSession, getSession, listSessions, updateSession, getSessionChain,
  appendMessage, getMessages, getRecentMessages, pruneMessages,
  searchMessages,
  buildSessionContext,
  compressSession,
  sessionStats,
  createLLMSummarizer,
};
