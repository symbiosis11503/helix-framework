/**
 * Memory Manager — Context OS Layer 2
 *
 * Tiered long-term memory system for the Helix AI agent framework.
 * Enhances session-store.js (working memory / Layer 1) with:
 * - Episodic Memory: important facts extracted from conversations
 * - Semantic Memory: structured knowledge, skills, preferences
 * - Procedural Memory: learned workflows and procedures
 *
 * Features:
 * - Importance scoring with time-based decay
 * - Text search (ILIKE PG / LIKE SQLite)
 * - Tag-based retrieval (JSON array in tags column)
 * - Auto-extraction from session conversations
 * - Memory consolidation (merge related low-importance memories)
 * - Context injection for LLM prompts
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';
import * as sessionStore from './session-store.js';

// ========== Constants ==========

const VALID_TYPES = ['episodic', 'semantic', 'procedural'];
const DEFAULT_DECAY_RATE = 0.02;
const DEFAULT_MIN_IMPORTANCE = 0.1;
const DEFAULT_MAX_AGE_DAYS = 90;
const DEFAULT_RECALL_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_TOKENS = 2000;

// ========== Init ==========

/**
 * Create the memories table if it does not exist.
 * Safe to call multiple times (IF NOT EXISTS).
 * For SQLite the schema is already in db.js initSqliteSchema — this handles
 * both PG (which skips initSqliteSchema) and late-init scenarios.
 */
export async function initMemoryTables() {
  const isPg = getType() === 'pg';

  await query(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      last_accessed_at TEXT,
      decay_factor REAL DEFAULT 1.0,
      tags TEXT,
      embedding TEXT,
      source_session_id TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(agent_id, type)');

  try {
    await query('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(agent_id, importance DESC)');
  } catch {
    await query('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(agent_id, importance)');
  }

  // PG: enable pgvector extension + add vector column + HNSW index
  if (isPg) {
    try {
      await query('CREATE EXTENSION IF NOT EXISTS vector');
      // Add vector column if not exists
      await query(`
        DO $$ BEGIN
          ALTER TABLE memories ADD COLUMN embedding_vec vector(1536);
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
      `);
      await query('CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding_vec vector_cosine_ops)');
      console.log('[memory] pgvector enabled with HNSW index');
    } catch (e) {
      console.warn('[memory] pgvector not available:', e.message, '— falling back to text embeddings');
    }
  }
}

// ========== Store ==========

/**
 * Store a new memory.
 *
 * @param {object} opts
 * @param {string} opts.agentId - owning agent
 * @param {'episodic'|'semantic'|'procedural'} opts.type - memory tier
 * @param {string} opts.content - full memory content
 * @param {string} [opts.summary] - one-line summary for fast retrieval
 * @param {number} [opts.importance=0.5] - 0.0–1.0
 * @param {string[]} [opts.tags=[]] - categorisation tags
 * @param {string} [opts.sourceSessionId] - originating session
 * @returns {{ id: string }}
 */
export async function remember({ agentId, type, content, summary = null, importance = 0.5, tags = [], sourceSessionId = null, embedding = null }) {
  if (!agentId) throw new Error('agentId is required');
  if (!VALID_TYPES.includes(type)) throw new Error(`Invalid memory type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
  if (!content) throw new Error('content is required');

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isPg = getType() === 'pg';
  const now = isPg ? 'now()' : "datetime('now')";
  const tagsJson = JSON.stringify(tags);
  const embeddingJson = embedding ? JSON.stringify(embedding) : null;

  await query(
    `INSERT INTO memories (id, agent_id, type, content, summary, importance, access_count, last_accessed_at, decay_factor, tags, embedding, source_session_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, 1.0, $7, $8, $9, ${now}, ${now})`,
    [id, agentId, type, content, summary, importance, tagsJson, embeddingJson, sourceSessionId]
  );

  // If PG has pgvector and embedding provided, also store as vector
  if (isPg && embedding && embedding.length > 0) {
    try {
      await query(
        `UPDATE memories SET embedding_vec = $1::vector WHERE id = $2`,
        [`[${embedding.join(',')}]`, id]
      );
    } catch (e) {
      console.warn('[memory] pgvector store failed:', e.message);
    }
  }

  return { id };
}

// ========== Recall ==========

/**
 * Search memories by text content.
 * Updates access_count and last_accessed_at on each accessed memory.
 * Sorts by effective importance (importance * decay_factor) descending.
 *
 * @param {string} agentId
 * @param {string} queryText - text to search for
 * @param {object} [opts]
 * @param {'episodic'|'semantic'|'procedural'} [opts.type] - filter by type
 * @param {number} [opts.limit=20] - max results
 * @param {number} [opts.minImportance=0] - minimum effective importance
 * @param {number} [opts.maxAge] - maximum age in days
 * @returns {Array<object>} matching memories sorted by effective importance
 */
export async function recall(agentId, queryText, { type = null, limit = DEFAULT_RECALL_LIMIT, minImportance = 0, maxAge = null } = {}) {
  if (!agentId) throw new Error('agentId is required');

  const isPg = getType() === 'pg';
  const likeOp = isPg ? 'ILIKE' : 'LIKE';
  const params = [agentId];
  let idx = 2;

  // Split query into words and search each (OR logic for better recall)
  const words = queryText.trim().split(/\s+/).filter(w => w.length >= 2);
  let searchClause;
  if (words.length <= 1) {
    const likeTerm = `%${queryText}%`;
    params.push(likeTerm, likeTerm);
    searchClause = `(content ${likeOp} $2 OR summary ${likeOp} $3)`;
    idx = 4;
  } else {
    // Multi-word: match ANY word in content or summary, rank by match count
    const conditions = [];
    for (const w of words) {
      const likeTerm = `%${w}%`;
      params.push(likeTerm, likeTerm);
      conditions.push(`(content ${likeOp} $${idx} OR summary ${likeOp} $${idx + 1})`);
      idx += 2;
    }
    searchClause = `(${conditions.join(' OR ')})`;
  }

  let sql = `
    SELECT *, (importance * decay_factor) AS effective_importance
    FROM memories
    WHERE agent_id = $1
      AND ${searchClause}`;

  if (type) {
    sql += ` AND type = $${idx}`;
    params.push(type);
    idx++;
  }

  if (minImportance > 0) {
    sql += ` AND (importance * decay_factor) >= $${idx}`;
    params.push(minImportance);
    idx++;
  }

  if (maxAge != null) {
    if (isPg) {
      sql += ` AND created_at >= now() - interval '${parseInt(maxAge, 10)} days'`;
    } else {
      sql += ` AND created_at >= datetime('now', '-${parseInt(maxAge, 10)} days')`;
    }
  }

  sql += ` ORDER BY effective_importance DESC LIMIT $${idx}`;
  params.push(limit);

  const result = await query(sql, params);
  const rows = result.rows;

  // Update access metadata for returned memories
  if (rows.length > 0) {
    const now = isPg ? 'now()' : "datetime('now')";
    const ids = rows.map(r => r.id);
    // Batch update — build IN clause
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await query(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ${now} WHERE id IN (${placeholders})`,
      ids
    );
  }

  return rows;
}

/**
 * Find memories matching any of the given tags.
 * Tags are stored as a JSON array string in the tags column.
 *
 * @param {string} agentId
 * @param {string[]} tags - tags to match (OR logic)
 * @param {object} [opts]
 * @param {number} [opts.limit=20] - max results
 * @returns {Array<object>} matching memories
 */
export async function recallByTags(agentId, tags, { limit = DEFAULT_RECALL_LIMIT } = {}) {
  if (!agentId) throw new Error('agentId is required');
  if (!tags || tags.length === 0) return [];

  const isPg = getType() === 'pg';
  const likeOp = isPg ? 'ILIKE' : 'LIKE';

  // Build OR conditions for each tag — search inside JSON array string
  const conditions = tags.map((_, i) => `tags ${likeOp} $${i + 2}`);
  const params = [agentId, ...tags.map(t => `%"${t}"%`), limit];

  const sql = `
    SELECT *, (importance * decay_factor) AS effective_importance
    FROM memories
    WHERE agent_id = $1
      AND (${conditions.join(' OR ')})
    ORDER BY effective_importance DESC
    LIMIT $${tags.length + 2}`;

  const result = await query(sql, params);

  // Update access metadata
  if (result.rows.length > 0) {
    const now = isPg ? 'now()' : "datetime('now')";
    const ids = result.rows.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await query(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ${now} WHERE id IN (${placeholders})`,
      ids
    );
  }

  return result.rows;
}

// ========== Importance ==========

/**
 * Update the importance score of a memory.
 *
 * @param {string} memoryId
 * @param {number} newImportance - 0.0–1.0
 */
export async function updateImportance(memoryId, newImportance) {
  if (newImportance < 0 || newImportance > 1) throw new Error('importance must be between 0.0 and 1.0');
  const now = getType() === 'pg' ? 'now()' : "datetime('now')";
  await query(
    `UPDATE memories SET importance = $1, updated_at = ${now} WHERE id = $2`,
    [newImportance, memoryId]
  );
}

/**
 * Apply time-based decay to all memories for an agent.
 * decay_factor *= (1 - decayRate) for each call.
 * Memories with decay_factor below 0.1 are candidates for archival.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.decayRate=0.02] - how much to decay per cycle
 * @returns {{ decayed: number, belowThreshold: number }}
 */
export async function decayMemories(agentId, { decayRate = DEFAULT_DECAY_RATE } = {}) {
  if (!agentId) throw new Error('agentId is required');
  const now = getType() === 'pg' ? 'now()' : "datetime('now')";

  // Apply decay
  const result = await query(
    `UPDATE memories SET decay_factor = decay_factor * (1.0 - $1), updated_at = ${now} WHERE agent_id = $2`,
    [decayRate, agentId]
  );

  // Count memories below threshold
  const belowResult = await query(
    'SELECT COUNT(*) as count FROM memories WHERE agent_id = $1 AND decay_factor < 0.1',
    [agentId]
  );

  return {
    decayed: result.rowCount,
    belowThreshold: parseInt(belowResult.rows[0]?.count || 0, 10),
  };
}

// ========== Consolidation ==========

/**
 * Consolidate related low-importance memories.
 * Groups memories by overlapping tags, merges their content,
 * and creates a single higher-importance consolidated memory.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {function} [opts.summarizeFn] - async (texts: string[]) => string — LLM summarizer
 * @param {number} [opts.importanceThreshold=0.3] - only consolidate memories below this
 * @param {number} [opts.minGroupSize=2] - minimum memories to form a group
 * @returns {{ consolidated: number, groups: number }}
 */
export async function consolidate(agentId, { summarizeFn = null, importanceThreshold = 0.3, minGroupSize = 2 } = {}) {
  if (!agentId) throw new Error('agentId is required');

  // Fetch low-importance memories
  const result = await query(
    'SELECT * FROM memories WHERE agent_id = $1 AND (importance * decay_factor) < $2 ORDER BY created_at ASC',
    [agentId, importanceThreshold]
  );

  const memories = result.rows;
  if (memories.length < minGroupSize) return { consolidated: 0, groups: 0 };

  // Group by tag overlap
  const groups = groupByTagOverlap(memories, minGroupSize);
  let consolidated = 0;

  for (const group of groups) {
    // Merge content
    const contents = group.map(m => m.content);
    let mergedContent;

    if (summarizeFn) {
      try {
        const prompt = `Consolidate these ${contents.length} related memories into one concise summary:\n\n${contents.join('\n---\n')}`;
        mergedContent = await summarizeFn(prompt);
      } catch (e) {
        console.warn('[memory] consolidation summarize failed:', e.message);
        mergedContent = contents.join('\n---\n');
      }
    } else {
      mergedContent = contents.join('\n---\n');
    }

    // Collect all unique tags
    const allTags = new Set();
    for (const m of group) {
      try {
        const parsed = JSON.parse(m.tags || '[]');
        parsed.forEach(t => allTags.add(t));
      } catch { /* skip malformed */ }
    }

    // Boost importance: max of group + 0.1 (capped at 1.0)
    const maxImportance = Math.max(...group.map(m => m.importance || 0));
    const boostedImportance = Math.min(1.0, maxImportance + 0.1);

    // Create consolidated memory
    await remember({
      agentId,
      type: group[0].type || 'episodic',
      content: mergedContent,
      summary: `Consolidated from ${group.length} memories`,
      importance: boostedImportance,
      tags: [...allTags],
      sourceSessionId: null,
    });

    // Delete originals
    const ids = group.map(m => m.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await query(`DELETE FROM memories WHERE id IN (${placeholders})`, ids);

    consolidated += group.length;
  }

  return { consolidated, groups: groups.length };
}

/**
 * Group memories by tag overlap.
 * Two memories are related if they share at least one tag.
 * Uses union-find for efficient grouping.
 * @private
 */
function groupByTagOverlap(memories, minGroupSize) {
  const parent = memories.map((_, i) => i);

  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) { parent[find(a)] = find(b); }

  // Build tag → index map
  const tagIndex = {};
  for (let i = 0; i < memories.length; i++) {
    let tags;
    try { tags = JSON.parse(memories[i].tags || '[]'); } catch { continue; }
    for (const tag of tags) {
      if (tagIndex[tag] !== undefined) {
        union(i, tagIndex[tag]);
      } else {
        tagIndex[tag] = i;
      }
    }
  }

  // Collect groups
  const groupMap = {};
  for (let i = 0; i < memories.length; i++) {
    const root = find(i);
    if (!groupMap[root]) groupMap[root] = [];
    groupMap[root].push(memories[i]);
  }

  return Object.values(groupMap).filter(g => g.length >= minGroupSize);
}

// ========== Auto-Extract from Session ==========

/**
 * Extract important facts from a session's conversation history
 * and store them as episodic memories.
 *
 * Uses LLM (summarizeFn) if provided, otherwise falls back to
 * heuristic extraction (decisions, errors, preferences, learnings).
 *
 * @param {string} agentId
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {function} [opts.summarizeFn] - async (prompt: string) => string — LLM extractor
 * @param {number} [opts.maxMessages=100] - max messages to read
 * @returns {{ extracted: number, memories: string[] }}
 */
export async function extractFromSession(agentId, sessionId, { summarizeFn = null, maxMessages = 100 } = {}) {
  if (!agentId) throw new Error('agentId is required');
  if (!sessionId) throw new Error('sessionId is required');

  const messages = await sessionStore.getMessages(sessionId, { limit: maxMessages });
  if (messages.length === 0) return { extracted: 0, memories: [] };

  let facts;

  if (summarizeFn) {
    facts = await extractWithLLM(messages, summarizeFn);
  } else {
    facts = extractWithHeuristics(messages);
  }

  const memoryIds = [];
  for (const fact of facts) {
    const { id } = await remember({
      agentId,
      type: 'episodic',
      content: fact.content,
      summary: fact.summary,
      importance: fact.importance,
      tags: fact.tags,
      sourceSessionId: sessionId,
    });
    memoryIds.push(id);
  }

  return { extracted: facts.length, memories: memoryIds };
}

/**
 * Extract facts using LLM.
 * @private
 */
async function extractWithLLM(messages, summarizeFn) {
  const formatted = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}] ${(m.content || '').slice(0, 300)}`)
    .join('\n');

  const prompt = `Analyze the following conversation and extract important facts worth remembering long-term.
For each fact, provide JSON with: content, summary (one line), importance (0.0-1.0), tags (array).

Focus on:
- Decisions made
- User preferences revealed
- Errors encountered and solutions found
- Key learnings or insights
- Important names, dates, configurations

Conversation:
${formatted.slice(0, 6000)}

Respond with a JSON array of objects. Each object: { "content": "...", "summary": "...", "importance": 0.0-1.0, "tags": ["..."] }
Only output the JSON array, nothing else.`;

  try {
    const response = await summarizeFn(prompt);
    // Try to parse JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.filter(f => f.content && f.summary).map(f => ({
        content: String(f.content),
        summary: String(f.summary),
        importance: Math.max(0, Math.min(1, Number(f.importance) || 0.5)),
        tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      }));
    }
  } catch {
    // Fall through to heuristics
  }

  return extractWithHeuristics(messages);
}

/**
 * Extract facts using keyword heuristics (no LLM needed).
 * @private
 */
function extractWithHeuristics(messages) {
  const facts = [];
  const DECISION_PATTERNS = [
    /decided?\s+to\b/i, /we('ll|\s+will)\s+(use|go\s+with|implement)/i,
    /let's\s+(use|go|do|try)/i, /going\s+(with|to\s+use)/i,
    /approved|confirmed|finalized|agreed/i,
  ];
  const ERROR_PATTERNS = [
    /error[:\s]/i, /failed?\b/i, /bug[:\s]/i, /fix(ed)?\b/i,
    /issue[:\s]/i, /problem[:\s]/i, /broken/i, /crash/i,
  ];
  const PREFERENCE_PATTERNS = [
    /prefer/i, /always\s+use/i, /don't\s+(like|want|use)/i,
    /never\s+(use|do)/i, /important\s+to\s+me/i,
  ];
  const LEARNING_PATTERNS = [
    /learned?\b/i, /turns?\s+out/i, /note\s+to\s+self/i,
    /remember\s+that/i, /key\s+(takeaway|insight|finding)/i,
    /solution\s+(is|was)/i, /root\s+cause/i,
  ];

  for (const msg of messages) {
    const text = msg.content || '';
    if (text.length < 20) continue; // skip trivial messages

    for (const pattern of DECISION_PATTERNS) {
      if (pattern.test(text)) {
        facts.push({
          content: text.slice(0, 500),
          summary: `Decision: ${text.slice(0, 100)}`,
          importance: 0.7,
          tags: ['decision'],
        });
        break;
      }
    }

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(text)) {
        facts.push({
          content: text.slice(0, 500),
          summary: `Error/Fix: ${text.slice(0, 100)}`,
          importance: 0.6,
          tags: ['error', 'troubleshooting'],
        });
        break;
      }
    }

    for (const pattern of PREFERENCE_PATTERNS) {
      if (pattern.test(text)) {
        facts.push({
          content: text.slice(0, 500),
          summary: `Preference: ${text.slice(0, 100)}`,
          importance: 0.8,
          tags: ['preference'],
        });
        break;
      }
    }

    for (const pattern of LEARNING_PATTERNS) {
      if (pattern.test(text)) {
        facts.push({
          content: text.slice(0, 500),
          summary: `Learning: ${text.slice(0, 100)}`,
          importance: 0.65,
          tags: ['learning'],
        });
        break;
      }
    }
  }

  // Deduplicate by summary prefix (first 60 chars)
  const seen = new Set();
  return facts.filter(f => {
    const key = f.summary.slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ========== Context Injection ==========

/**
 * Build a memory context block for injecting into LLM prompts.
 * Recalls relevant memories based on the current query and formats
 * them as a structured text block.
 *
 * @param {string} agentId
 * @param {string} currentQuery - the current user query / topic
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=2000] - token budget for memory context
 * @param {string[]} [opts.types] - filter to specific memory types
 * @returns {{ text: string, tokens: number, memoryCount: number }}
 */
export async function buildMemoryContext(agentId, currentQuery, { maxTokens = DEFAULT_CONTEXT_MAX_TOKENS, types = null } = {}) {
  if (!agentId) return { text: '', tokens: 0, memoryCount: 0 };

  const memories = [];

  if (types) {
    for (const type of types) {
      const results = await recall(agentId, currentQuery, { type, limit: 10, minImportance: 0.1 });
      memories.push(...results);
    }
  } else {
    const results = await recall(agentId, currentQuery, { limit: 20, minImportance: 0.1 });
    memories.push(...results);
  }

  if (memories.length === 0) return { text: '', tokens: 0, memoryCount: 0 };

  // Sort by effective importance (already sorted from recall, but re-sort after merge)
  memories.sort((a, b) => (b.effective_importance || b.importance * b.decay_factor) - (a.effective_importance || a.importance * a.decay_factor));

  // Build text within token budget
  const lines = [];
  let tokenCount = 0;
  const headerTokens = estimateTokens('## Long-term Memory\n');
  tokenCount += headerTokens;

  for (const mem of memories) {
    const line = `- [${mem.type}] ${mem.summary || mem.content.slice(0, 120)}`;
    const lineTokens = estimateTokens(line);

    if (tokenCount + lineTokens > maxTokens) break;

    lines.push(line);
    tokenCount += lineTokens;
  }

  const text = lines.length > 0 ? `## Long-term Memory\n${lines.join('\n')}` : '';

  return {
    text,
    tokens: tokenCount,
    memoryCount: lines.length,
  };
}

// ========== Stats ==========

/**
 * Get memory statistics for an agent.
 *
 * @param {string} agentId
 * @returns {{ total: number, byType: object, avgImportance: number, avgDecay: number }}
 */
export async function memoryStats(agentId) {
  if (!agentId) throw new Error('agentId is required');

  const total = await query(
    'SELECT COUNT(*) as count FROM memories WHERE agent_id = $1',
    [agentId]
  );
  const byType = await query(
    'SELECT type, COUNT(*) as count FROM memories WHERE agent_id = $1 GROUP BY type',
    [agentId]
  );
  const avgImportance = await query(
    'SELECT COALESCE(AVG(importance * decay_factor), 0) as avg FROM memories WHERE agent_id = $1',
    [agentId]
  );
  const avgDecay = await query(
    'SELECT COALESCE(AVG(decay_factor), 0) as avg FROM memories WHERE agent_id = $1',
    [agentId]
  );

  const typeMap = {};
  for (const row of byType.rows) {
    typeMap[row.type] = parseInt(row.count, 10);
  }

  return {
    total: parseInt(total.rows[0]?.count || 0, 10),
    byType: typeMap,
    avgImportance: parseFloat(avgImportance.rows[0]?.avg || 0),
    avgDecay: parseFloat(avgDecay.rows[0]?.avg || 0),
  };
}

// ========== Cleanup ==========

/**
 * Delete old, decayed memories.
 * Removes memories older than maxAge days with decay_factor below minDecay.
 *
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.maxAge=90] - age threshold in days
 * @param {number} [opts.minDecay=0.1] - decay threshold
 * @returns {{ deleted: number }}
 */
export async function forgetOldMemories(agentId, { maxAge = DEFAULT_MAX_AGE_DAYS, minDecay = DEFAULT_MIN_IMPORTANCE } = {}) {
  if (!agentId) throw new Error('agentId is required');

  const isPg = getType() === 'pg';
  let sql;

  if (isPg) {
    sql = `DELETE FROM memories WHERE agent_id = $1 AND decay_factor < $2 AND created_at < now() - interval '${parseInt(maxAge, 10)} days'`;
  } else {
    sql = `DELETE FROM memories WHERE agent_id = $1 AND decay_factor < $2 AND created_at < datetime('now', '-${parseInt(maxAge, 10)} days')`;
  }

  const result = await query(sql, [agentId, minDecay]);
  return { deleted: result.rowCount };
}

// ========== Utilities ==========

/**
 * Estimate token count — same heuristic as session-store.js.
 * ~4 chars/token English, ~2 chars/token CJK.
 * @private
 */
function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const nonCjk = text.length - cjk;
  return Math.ceil(nonCjk / 4 + cjk / 2);
}

// ========== Semantic Search ==========

/**
 * Semantic recall — rank memories by term overlap + importance.
 * Lightweight zero-dependency alternative to vector search.
 * For production, provide embedFn that calls an embedding API.
 *
 * @param {string} agentId
 * @param {string} queryText
 * @param {object} [opts]
 * @param {function} [opts.embedFn] - async (text) => number[]
 * @param {number} [opts.limit=10]
 * @returns {Array<object>} memories ranked by relevance
 */
export async function semanticRecall(agentId, queryText, { embedFn = null, limit = 10 } = {}) {
  const isPg = getType() === 'pg';

  // Strategy 1: pgvector native similarity search (fastest, PG only)
  if (isPg && embedFn) {
    try {
      const queryEmbed = await embedFn(queryText);
      const vecStr = `[${queryEmbed.join(',')}]`;
      const r = await query(
        `SELECT *, (1 - (embedding_vec <=> $1::vector)) * importance * decay_factor AS relevance
         FROM memories
         WHERE agent_id = $2 AND embedding_vec IS NOT NULL AND decay_factor > 0.05
         ORDER BY relevance DESC LIMIT $3`,
        [vecStr, agentId, limit]
      );
      if (r.rows.length > 0) return r.rows;
    } catch (e) {
      console.warn('[memory] pgvector search failed, trying fallback:', e.message);
    }
  }

  // Strategy 2: In-memory embedding comparison (any DB, needs embedFn)
  const r = await query(
    'SELECT * FROM memories WHERE agent_id = $1 AND decay_factor > 0.05 ORDER BY importance DESC LIMIT 200',
    [agentId]
  );
  if (r.rows.length === 0) return [];

  if (embedFn) {
    try {
      const queryEmbed = await embedFn(queryText);
      const scored = [];
      for (const mem of r.rows) {
        // Use stored embedding if available, otherwise generate
        let memEmbed;
        if (mem.embedding) {
          memEmbed = JSON.parse(mem.embedding);
        } else {
          memEmbed = await embedFn(mem.content);
        }
        const sim = cosineSim(queryEmbed, memEmbed);
        scored.push({ ...mem, relevance: sim * (mem.importance || 0.5) * (mem.decay_factor || 1) });
      }
      scored.sort((a, b) => b.relevance - a.relevance);
      return scored.slice(0, limit);
    } catch (e) { console.warn('[memory] embedFn failed, falling back to keyword:', e.message); }
  }

  // Fallback: keyword overlap scoring
  const qTokens = tokenize(queryText);
  const scored = r.rows.map(mem => {
    const mTokens = tokenize(mem.content + ' ' + (mem.summary || ''));
    const overlap = qTokens.filter(t => mTokens.includes(t)).length;
    const coverage = qTokens.length > 0 ? overlap / qTokens.length : 0;
    const relevance = coverage * (mem.importance || 0.5) * (mem.decay_factor || 1);
    return { ...mem, relevance, termOverlap: overlap };
  });
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.filter(s => s.relevance > 0).slice(0, limit);
}

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').split(/\s+/).filter(t => t.length > 1);
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d === 0 ? 0 : dot / d;
}

// ========== Embedding Helpers ==========

/**
 * Create an embedding function using OpenAI-compatible API
 * Works with: OpenAI, Gemini, local Ollama, any OpenAI-compatible endpoint
 *
 * @param {object} opts
 * @param {string} [opts.provider='openai'] - 'openai' | 'gemini' | 'local'
 * @param {string} [opts.model] - embedding model name
 * @param {string} [opts.apiKey] - API key
 * @param {string} [opts.baseUrl] - custom endpoint URL
 * @returns {function} async (text) => number[]
 */
export function createEmbedder({ provider = 'openai', model = null, apiKey = null, baseUrl = null } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;

  return async function embed(text) {
    if (provider === 'gemini') {
      const m = model || 'text-embedding-004';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:embedContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!res.ok) throw new Error(`Gemini embedding ${res.status}`);
      const data = await res.json();
      return data?.embedding?.values || [];
    }

    // OpenAI-compatible (OpenAI, Ollama, etc.)
    const m = model || 'text-embedding-3-small';
    const url = baseUrl || 'https://api.openai.com/v1';
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(`${url}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: m, input: text }),
    });
    if (!res.ok) throw new Error(`Embedding ${res.status}`);
    const data = await res.json();
    return data?.data?.[0]?.embedding || [];
  };
}

/**
 * Batch embed all memories that don't have embeddings yet
 */
export async function backfillEmbeddings(agentId, embedFn, { batchSize = 50 } = {}) {
  const r = await query(
    'SELECT id, content FROM memories WHERE agent_id = $1 AND embedding IS NULL LIMIT $2',
    [agentId, batchSize]
  );

  let updated = 0;
  const isPg = getType() === 'pg';

  for (const mem of r.rows) {
    try {
      const embedding = await embedFn(mem.content);
      await query('UPDATE memories SET embedding = $1 WHERE id = $2', [JSON.stringify(embedding), mem.id]);

      if (isPg && embedding.length > 0) {
        try {
          await query('UPDATE memories SET embedding_vec = $1::vector WHERE id = $2', [`[${embedding.join(',')}]`, mem.id]);
        } catch {}
      }
      updated++;
    } catch (e) {
      console.warn(`[memory] backfill embedding failed for ${mem.id}:`, e.message);
    }
  }

  return { updated, total: r.rows.length };
}

/**
 * recallProjectMemory — FTS-based recall from L4 project_memory table (PG-only).
 *
 * Added in 0.10.1 to fix the L4 shared-truth recall gap: existing `recall()` only
 * queries the per-agent `memories` table (L2A), not the cross-agent `project_memory`
 * table (L4). External agents need this to discover shared governance rules like
 * 強制雙寫規則 without relying on agent-local mirrors.
 *
 * FTS-only (no vector) keeps 0.10.1 portable: agents without bge-m3 embedder
 * access can still query L4 by keyword/CJK substring. Vector-reranked version
 * lives in symbiosis-helix/src/memory-core.js for hosts with embedder.
 *
 * Returns empty result for sqlite (project_memory is PG-only).
 */
export async function recallProjectMemory({
  projectId,
  query: queryText,
  scopePath = null,
  memoryKind = null,
  status = 'active',
  limit = 10,
} = {}) {
  if (getType() !== 'pg') {
    return { ok: true, query: queryText, results: [], note: 'project_memory is PG-only; sqlite returns empty.' };
  }
  if (!projectId) throw new Error('projectId required');
  const q = String(queryText || '').trim();
  if (!q) throw new Error('query required');

  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(q);
  const args = [projectId, status];
  const conds = ['project_id = $1', 'status = $2'];
  let idx = 3;

  if (scopePath) {
    if (scopePath.includes('%')) conds.push(`scope_path LIKE $${idx++}`);
    else conds.push(`scope_path = $${idx++}`);
    args.push(scopePath);
  }
  if (memoryKind) {
    conds.push(`memory_kind = $${idx++}`);
    args.push(memoryKind);
  }
  if (hasCJK) {
    conds.push(`(title ILIKE $${idx} OR content ILIKE $${idx})`);
    args.push(`%${q}%`);
    idx++;
  } else {
    conds.push(`search_vector @@ to_tsquery('simple', $${idx})`);
    args.push(q.split(/\s+/).filter(Boolean).map((t) => t + ':*').join(' | '));
    idx++;
  }
  args.push(Math.max(1, Math.min(50, parseInt(limit) || 10)));

  const orderBy = hasCJK
    ? 'ORDER BY created_at DESC'
    : `ORDER BY ts_rank(search_vector, to_tsquery('simple', $${idx - 1})) DESC`;
  const sql = `SELECT id, project_id, scope_path, memory_kind, title, content, status, confidence,
                      verification_state, tags, created_at
               FROM project_memory
               WHERE ${conds.join(' AND ')}
               ${orderBy}
               LIMIT $${args.length}::int`;
  const r = await query(sql, args);
  return {
    ok: true,
    query: q,
    results: r.rows.map((row) => ({
      layer: 'l4',
      id: row.id,
      projectId: row.project_id,
      scopePath: row.scope_path,
      memoryKind: row.memory_kind,
      title: row.title,
      content: row.content,
      status: row.status,
      confidence: row.confidence,
      verificationState: row.verification_state,
      tags: row.tags,
      createdAt: row.created_at,
    })),
  };
}

// ========== Default Export ==========

export default {
  initMemoryTables,
  remember,
  recall,
  recallByTags,
  semanticRecall,
  updateImportance,
  decayMemories,
  consolidate,
  extractFromSession,
  buildMemoryContext,
  memoryStats,
  forgetOldMemories,
  createEmbedder,
  backfillEmbeddings,
  recallProjectMemory,
};
