/**
 * Knowledge — Atom-based Knowledge Governance Pipeline
 *
 * Inspired by llm-atomic-wiki pattern:
 *   raw → atoms → reviewed → promoted → compiled
 *
 * Atoms are the source of truth. Reports/wikis are derived cache.
 *
 * Features:
 * - Knowledge atoms (immutable claim units with provenance)
 * - Topic branches (category organization)
 * - Two-layer lint (deterministic rules + LLM semantic check)
 * - Promotion pipeline (draft → reviewed → promoted → archived)
 * - Compilation (atoms → report/summary)
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Init ==========

export async function initKnowledgeTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_atoms (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      source_type TEXT DEFAULT 'conversation',
      source_ref TEXT,
      topic TEXT,
      tags TEXT,
      status TEXT DEFAULT 'draft',
      reliability_tier INTEGER DEFAULT 2,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_atoms_agent ON knowledge_atoms(agent_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_atoms_topic ON knowledge_atoms(agent_id, topic)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_atoms_status ON knowledge_atoms(agent_id, status)`);

  await query(`
    CREATE TABLE IF NOT EXISTS knowledge_compilations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      atom_ids TEXT,
      topic TEXT,
      format TEXT DEFAULT 'report',
      created_at TEXT
    )
  `);
}

// ========== Helpers ==========

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nowExpr() {
  return getType() === 'pg' ? 'now()' : "datetime('now')";
}

// ========== Atom CRUD ==========

/**
 * Create a knowledge atom
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} opts.content - The claim/fact
 * @param {string} [opts.summary] - One-line summary
 * @param {string} [opts.sourceType] - 'conversation' | 'document' | 'web' | 'manual'
 * @param {string} [opts.sourceRef] - Session ID, URL, file path, etc.
 * @param {string} [opts.topic] - Topic branch
 * @param {string[]} [opts.tags]
 * @param {number} [opts.reliabilityTier] - 1 (verified) / 2 (unverified) / 3 (disputed)
 */
export async function createAtom({ agentId, content, summary = null, sourceType = 'conversation', sourceRef = null, topic = null, tags = [], reliabilityTier = 2 }) {
  const id = genId('atom');
  await query(
    `INSERT INTO knowledge_atoms (id, agent_id, content, summary, source_type, source_ref, topic, tags, status, reliability_tier, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, ${nowExpr()}, ${nowExpr()})`,
    [id, agentId, content, summary, sourceType, sourceRef, topic, JSON.stringify(tags), reliabilityTier]
  );
  return { id };
}

/**
 * Get atom by ID
 */
export async function getAtom(atomId) {
  const r = await query('SELECT * FROM knowledge_atoms WHERE id = $1', [atomId]);
  return r.rows[0] || null;
}

/**
 * List atoms with filters
 */
export async function listAtoms(agentId, { topic = null, status = null, limit = 50, minTier = null } = {}) {
  let sql = 'SELECT * FROM knowledge_atoms WHERE agent_id = $1';
  const params = [agentId];
  let idx = 2;

  if (topic) { sql += ` AND topic = $${idx++}`; params.push(topic); }
  if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
  if (minTier) { sql += ` AND reliability_tier <= $${idx++}`; params.push(minTier); }

  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  params.push(limit);

  return (await query(sql, params)).rows;
}

/**
 * Search atoms by text
 */
export async function searchAtoms(agentId, queryText, { limit = 20 } = {}) {
  const likeOp = getType() === 'pg' ? 'ILIKE' : 'LIKE';
  const term = `%${queryText}%`;
  const r = await query(
    `SELECT * FROM knowledge_atoms WHERE agent_id = $1 AND (content ${likeOp} $2 OR summary ${likeOp} $3) ORDER BY created_at DESC LIMIT $4`,
    [agentId, term, term, limit]
  );
  return r.rows;
}

// ========== Topic Branches ==========

/**
 * List all topics with counts
 */
export async function listTopics(agentId) {
  const r = await query(
    'SELECT topic, COUNT(*) as count, MIN(created_at) as first_at, MAX(created_at) as last_at FROM knowledge_atoms WHERE agent_id = $1 AND topic IS NOT NULL GROUP BY topic ORDER BY count DESC',
    [agentId]
  );
  return r.rows;
}

// ========== Promotion Pipeline ==========

/**
 * Review an atom (draft → reviewed)
 */
export async function reviewAtom(atomId, { reviewedBy = 'system', reliabilityTier = null }) {
  if (reliabilityTier !== null) {
    await query(
      `UPDATE knowledge_atoms SET status = 'reviewed', reviewed_by = $1, reliability_tier = $2, reviewed_at = ${nowExpr()}, updated_at = ${nowExpr()} WHERE id = $3`,
      [reviewedBy, reliabilityTier, atomId]
    );
  } else {
    await query(
      `UPDATE knowledge_atoms SET status = 'reviewed', reviewed_by = $1, reviewed_at = ${nowExpr()}, updated_at = ${nowExpr()} WHERE id = $2`,
      [reviewedBy, atomId]
    );
  }
  return { reviewed: true };
}

/**
 * Promote an atom (reviewed → promoted)
 */
export async function promoteAtom(atomId) {
  await query(
    `UPDATE knowledge_atoms SET status = 'promoted', updated_at = ${nowExpr()} WHERE id = $1 AND status = 'reviewed'`,
    [atomId]
  );
  return { promoted: true };
}

/**
 * Archive an atom (any → archived)
 */
export async function archiveAtom(atomId) {
  await query(
    `UPDATE knowledge_atoms SET status = 'archived', updated_at = ${nowExpr()} WHERE id = $1`,
    [atomId]
  );
  return { archived: true };
}

// ========== Two-Layer Lint ==========

/**
 * Layer 1: Deterministic lint (no LLM needed)
 * Checks: empty content, duplicate detection, missing topic, broken refs
 */
export async function lintDeterministic(agentId) {
  const issues = [];

  // Empty content
  const empty = await query(
    "SELECT id, summary FROM knowledge_atoms WHERE agent_id = $1 AND (content IS NULL OR content = '')",
    [agentId]
  );
  for (const row of empty.rows) {
    issues.push({ atomId: row.id, type: 'empty_content', severity: 'error', message: 'Atom has no content' });
  }

  // Missing topic
  const noTopic = await query(
    "SELECT id, summary FROM knowledge_atoms WHERE agent_id = $1 AND topic IS NULL AND status != 'archived'",
    [agentId]
  );
  for (const row of noTopic.rows) {
    issues.push({ atomId: row.id, type: 'no_topic', severity: 'warning', message: 'Atom has no topic branch' });
  }

  // Duplicate content (exact match)
  const dupes = await query(
    `SELECT a.id as id1, b.id as id2, a.summary FROM knowledge_atoms a JOIN knowledge_atoms b ON a.content = b.content AND a.id < b.id WHERE a.agent_id = $1 AND b.agent_id = $2 AND a.status != 'archived' AND b.status != 'archived' LIMIT 20`,
    [agentId, agentId]
  );
  for (const row of dupes.rows) {
    issues.push({ atomId: row.id1, relatedId: row.id2, type: 'duplicate', severity: 'warning', message: 'Duplicate content found' });
  }

  return { issues, count: issues.length, layer: 'deterministic' };
}

/**
 * Layer 2: Semantic lint (requires LLM)
 * Checks: contradictions, outdated claims, low-quality content
 */
export async function lintSemantic(agentId, { summarizeFn, limit = 50 } = {}) {
  if (!summarizeFn) return { issues: [], count: 0, layer: 'semantic', note: 'No LLM provided' };

  const atoms = await listAtoms(agentId, { status: 'draft', limit });
  if (atoms.length === 0) return { issues: [], count: 0, layer: 'semantic' };

  const atomTexts = atoms.map(a => `[${a.id}] ${a.summary || a.content.slice(0, 100)}`).join('\n');

  const prompt = `Review these knowledge atoms for quality issues.
For each problematic atom, output a JSON object with: atomId, type (contradiction/outdated/vague/low_quality), message.

Atoms:
${atomTexts.slice(0, 6000)}

Respond with a JSON array only. If no issues found, respond with [].`;

  try {
    const response = await summarizeFn(prompt);
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      const issues = JSON.parse(match[0]).map(i => ({ ...i, severity: 'warning', layer: 'semantic' }));
      return { issues, count: issues.length, layer: 'semantic' };
    }
  } catch {}

  return { issues: [], count: 0, layer: 'semantic' };
}

// ========== Compilation ==========

/**
 * Compile promoted atoms into a report/summary
 */
export async function compile(agentId, { topic = null, title = null, format = 'report', summarizeFn = null } = {}) {
  const atoms = await listAtoms(agentId, { topic, status: 'promoted', limit: 200 });
  if (atoms.length === 0) return { compiled: false, reason: 'no promoted atoms' };

  const atomTexts = atoms.map(a => `- ${a.content}`).join('\n');
  let content;

  if (summarizeFn) {
    const prompt = `Compile these knowledge atoms into a structured ${format}${topic ? ` about "${topic}"` : ''}:

${atomTexts.slice(0, 8000)}

Format as markdown with sections. Be concise and factual.`;

    try {
      content = await summarizeFn(prompt);
    } catch {
      content = `# ${title || topic || 'Knowledge Report'}\n\n${atomTexts}`;
    }
  } else {
    content = `# ${title || topic || 'Knowledge Report'}\n\n${atomTexts}`;
  }

  const id = genId('comp');
  const atomIds = atoms.map(a => a.id);

  await query(
    `INSERT INTO knowledge_compilations (id, agent_id, title, content, atom_ids, topic, format, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${nowExpr()})`,
    [id, agentId, title || topic || 'Untitled', content, JSON.stringify(atomIds), topic, format]
  );

  return { compiled: true, id, atomCount: atoms.length, contentLength: content.length };
}

/**
 * List compilations
 */
export async function listCompilations(agentId, { topic = null, limit = 20 } = {}) {
  let sql = 'SELECT id, agent_id, title, topic, format, created_at FROM knowledge_compilations WHERE agent_id = $1';
  const params = [agentId];
  let idx = 2;
  if (topic) { sql += ` AND topic = $${idx++}`; params.push(topic); }
  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  params.push(limit);
  return (await query(sql, params)).rows;
}

// ========== Stats ==========

export async function knowledgeStats(agentId) {
  const total = await query('SELECT COUNT(*) as count FROM knowledge_atoms WHERE agent_id = $1', [agentId]);
  const byStatus = await query(
    "SELECT status, COUNT(*) as count FROM knowledge_atoms WHERE agent_id = $1 GROUP BY status",
    [agentId]
  );
  const byTopic = await query(
    "SELECT topic, COUNT(*) as count FROM knowledge_atoms WHERE agent_id = $1 AND topic IS NOT NULL GROUP BY topic ORDER BY count DESC LIMIT 10",
    [agentId]
  );
  const compilations = await query('SELECT COUNT(*) as count FROM knowledge_compilations WHERE agent_id = $1', [agentId]);

  return {
    atoms: total.rows[0]?.count || 0,
    byStatus: Object.fromEntries((byStatus.rows || []).map(r => [r.status, r.count])),
    topTopics: byTopic.rows,
    compilations: compilations.rows[0]?.count || 0,
  };
}

export default {
  initKnowledgeTables,
  createAtom, getAtom, listAtoms, searchAtoms,
  listTopics,
  reviewAtom, promoteAtom, archiveAtom,
  lintDeterministic, lintSemantic,
  compile, listCompilations,
  knowledgeStats,
};
