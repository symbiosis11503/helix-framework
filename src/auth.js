/**
 * Auth — Role-Based Access Control (RBAC) for Helix
 *
 * Provides:
 * - API key management (multiple keys with roles)
 * - Role hierarchy: admin > operator > viewer
 * - Middleware for Express routes
 * - Token generation and validation
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';
import { createHmac, randomBytes } from 'crypto';

// ========== Constants ==========

const ROLES = ['viewer', 'operator', 'admin'];
const ROLE_HIERARCHY = { viewer: 0, operator: 1, admin: 2 };

// ========== Init ==========

export async function initAuthTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      agent_scope TEXT,
      active INTEGER DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT,
      expires_at TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)`);
}

// ========== Key Management ==========

/**
 * Generate a new API key
 * @param {object} opts
 * @param {string} opts.name - Key name/label
 * @param {string} opts.role - 'viewer' | 'operator' | 'admin'
 * @param {string} [opts.agentScope] - Restrict to specific agent ID (null = all)
 * @param {number} [opts.expiresInDays] - Auto-expire after N days
 * @returns {{ id, key, name, role, prefix }}
 */
export async function createApiKey({ name, role = 'viewer', agentScope = null, expiresInDays = null }) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}. Must be: ${ROLES.join(', ')}`);

  const id = `key-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const rawKey = `hx_${randomBytes(24).toString('hex')}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 7);

  const now = getType() === 'pg' ? 'now()' : "datetime('now')";
  let expiresAt = null;
  if (expiresInDays) {
    expiresAt = getType() === 'pg'
      ? `now() + interval '${parseInt(expiresInDays)} days'`
      : new Date(Date.now() + expiresInDays * 86400000).toISOString();
  }

  await query(
    `INSERT INTO api_keys (id, name, key_hash, key_prefix, role, agent_scope, active, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, ${now}, $7)`,
    [id, name, keyHash, keyPrefix, role, agentScope, expiresAt]
  );

  return { id, key: rawKey, name, role, prefix: keyPrefix };
}

/**
 * Validate an API key and return its metadata
 * @param {string} key - Raw API key
 * @returns {{ valid, id, name, role, agentScope } | { valid: false }}
 */
export async function validateKey(key) {
  if (!key) return { valid: false };

  const keyHash = hashKey(key);
  const r = await query(
    'SELECT id, name, role, agent_scope, active, expires_at FROM api_keys WHERE key_hash = $1',
    [keyHash]
  );

  const row = r.rows[0];
  if (!row) return { valid: false };
  if (!row.active) return { valid: false, reason: 'key disabled' };

  // Check expiry
  if (row.expires_at) {
    const expiry = new Date(row.expires_at);
    if (expiry < new Date()) return { valid: false, reason: 'key expired' };
  }

  // Update last_used_at
  const now = getType() === 'pg' ? 'now()' : "datetime('now')";
  await query(`UPDATE api_keys SET last_used_at = ${now} WHERE id = $1`, [row.id]).catch(() => {});

  return {
    valid: true,
    id: row.id,
    name: row.name,
    role: row.role,
    agentScope: row.agent_scope,
  };
}

/**
 * List all API keys (without showing the actual key)
 */
export async function listKeys({ activeOnly = true } = {}) {
  let sql = 'SELECT id, name, key_prefix, role, agent_scope, active, last_used_at, created_at, expires_at FROM api_keys';
  if (activeOnly) sql += ' WHERE active = 1';
  sql += ' ORDER BY created_at DESC';
  return (await query(sql)).rows;
}

/**
 * Revoke an API key
 */
export async function revokeKey(keyId) {
  const r = await query('UPDATE api_keys SET active = 0 WHERE id = $1', [keyId]);
  return { revoked: r.rowCount > 0 };
}

// ========== Role Checking ==========

/**
 * Check if a role meets the minimum required level
 * @param {string} userRole - The user's role
 * @param {string} requiredRole - Minimum required role
 * @returns {boolean}
 */
export function hasRole(userRole, requiredRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
}

/**
 * Check if an agent scope allows access to a specific agent
 */
export function hasAgentAccess(agentScope, agentId) {
  if (!agentScope) return true; // null = all agents
  return agentScope === agentId;
}

// ========== Express Middleware ==========

/**
 * Create auth middleware for Express routes
 *
 * Usage:
 *   app.get('/api/admin/...', requireRole('admin'), handler)
 *   app.get('/api/tasks', requireRole('viewer'), handler)
 *   app.post('/api/agent/chat', requireRole('operator'), handler)
 *
 * Checks: Authorization header (Bearer token) or X-Api-Key header
 * Falls back to ADMIN_TOKEN env var for backward compatibility
 */
export function requireRole(minRole = 'viewer') {
  return async (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'API key required (Authorization: Bearer ... or X-Api-Key: ...)' });
    }

    // Backward compat: check ADMIN_TOKEN env var
    if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) {
      req.auth = { role: 'admin', name: 'env-admin', agentScope: null };
      return next();
    }

    // Validate via database
    try {
      const result = await validateKey(token);
      if (!result.valid) {
        return res.status(401).json({ error: result.reason || 'invalid API key' });
      }

      if (!hasRole(result.role, minRole)) {
        return res.status(403).json({ error: `Requires ${minRole} role, you have ${result.role}` });
      }

      req.auth = result;
      next();
    } catch {
      // DB not initialized — fall back to ADMIN_TOKEN only
      if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) {
        req.auth = { role: 'admin', name: 'env-admin', agentScope: null };
        return next();
      }
      return res.status(401).json({ error: 'auth system not available' });
    }
  };
}

// ========== Helpers ==========

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  if (req.headers['x-api-key']) return req.headers['x-api-key'];
  if (req.headers['x-admin-token']) return req.headers['x-admin-token'];
  return null;
}

function hashKey(key) {
  return createHmac('sha256', 'helix-auth-v1').update(key).digest('hex');
}

export default {
  initAuthTables,
  createApiKey, validateKey, listKeys, revokeKey,
  hasRole, hasAgentAccess,
  requireRole,
  ROLES,
};
