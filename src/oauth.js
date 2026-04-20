/**
 * OAuth — OAuth 2.0 Client for External Service Integration
 *
 * Provides:
 * - Authorization Code flow (for user-facing apps)
 * - Client Credentials flow (for service-to-service)
 * - Token storage, refresh, and lifecycle management
 * - Multi-provider support (any OAuth 2.0 compliant service)
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';
import { randomBytes } from 'crypto';

// ========== Init ==========

export async function initOAuthTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT,
      auth_url TEXT NOT NULL,
      token_url TEXT NOT NULL,
      scopes TEXT,
      redirect_uri TEXT,
      created_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      agent_id TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT DEFAULT 'Bearer',
      scopes TEXT,
      expires_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_agent ON oauth_tokens(agent_id)`);
}

// ========== Provider Management ==========

/**
 * Register an OAuth provider
 */
export async function registerProvider({ name, clientId, clientSecret = null, authUrl, tokenUrl, scopes = '', redirectUri = null }) {
  const id = `oauth-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = getType() === 'pg' ? 'now()' : "datetime('now')";

  await query(
    `INSERT INTO oauth_providers (id, name, client_id, client_secret, auth_url, token_url, scopes, redirect_uri, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${now})`,
    [id, name, clientId, clientSecret, authUrl, tokenUrl, scopes, redirectUri]
  );

  return { id, name };
}

/**
 * List registered providers (without secrets)
 */
export async function listProviders() {
  const r = await query('SELECT id, name, auth_url, token_url, scopes, redirect_uri, created_at FROM oauth_providers');
  return r.rows;
}

/**
 * Get provider by ID
 */
export async function getProvider(providerId) {
  const r = await query('SELECT * FROM oauth_providers WHERE id = $1', [providerId]);
  return r.rows[0] || null;
}

/**
 * Remove a provider
 */
export async function removeProvider(providerId) {
  await query('DELETE FROM oauth_tokens WHERE provider_id = $1', [providerId]);
  const r = await query('DELETE FROM oauth_providers WHERE id = $1', [providerId]);
  return { removed: r.rowCount > 0 };
}

// ========== Authorization Code Flow ==========

/**
 * Generate authorization URL for user to visit
 * @returns {{ url, state }}
 */
export async function getAuthorizationUrl(providerId, { scopes = null, state = null } = {}) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error('Provider not found');

  const authState = state || randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: provider.client_id,
    redirect_uri: provider.redirect_uri || '',
    response_type: 'code',
    scope: scopes || provider.scopes || '',
    state: authState,
  });

  return {
    url: `${provider.auth_url}?${params.toString()}`,
    state: authState,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(providerId, { code, redirectUri = null, agentId = null }) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error('Provider not found');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: provider.client_id,
    redirect_uri: redirectUri || provider.redirect_uri || '',
  });
  if (provider.client_secret) body.set('client_secret', provider.client_secret);

  const res = await fetch(provider.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return await storeToken(providerId, data, agentId);
}

// ========== Client Credentials Flow ==========

/**
 * Get token using client credentials (service-to-service)
 */
export async function clientCredentials(providerId, { scopes = null, agentId = null } = {}) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error('Provider not found');
  if (!provider.client_secret) throw new Error('Client credentials flow requires client_secret');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: provider.client_id,
    client_secret: provider.client_secret,
  });
  if (scopes || provider.scopes) body.set('scope', scopes || provider.scopes);

  const res = await fetch(provider.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Client credentials failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return await storeToken(providerId, data, agentId);
}

// ========== Token Management ==========

/**
 * Get a valid access token (auto-refreshes if expired)
 */
export async function getAccessToken(providerId, { agentId = null } = {}) {
  let sql = 'SELECT * FROM oauth_tokens WHERE provider_id = $1';
  const params = [providerId];
  if (agentId) { sql += ' AND agent_id = $2'; params.push(agentId); }
  sql += ' ORDER BY created_at DESC LIMIT 1';

  const r = await query(sql, params);
  const token = r.rows[0];
  if (!token) return null;

  // Check if expired
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    // Try refresh
    if (token.refresh_token) {
      try {
        const refreshed = await refreshToken(providerId, token.refresh_token, agentId);
        return refreshed.access_token;
      } catch {
        return null; // Refresh failed
      }
    }
    return null; // Expired, no refresh token
  }

  return token.access_token;
}

/**
 * Refresh an expired token
 */
export async function refreshToken(providerId, refreshTokenValue, agentId = null) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error('Provider not found');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    client_id: provider.client_id,
  });
  if (provider.client_secret) body.set('client_secret', provider.client_secret);

  const res = await fetch(provider.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return await storeToken(providerId, data, agentId);
}

/**
 * List tokens for a provider (without showing full token)
 */
export async function listTokens(providerId) {
  const r = await query(
    `SELECT id, provider_id, agent_id, token_type, scopes, expires_at, created_at, updated_at,
            CASE WHEN expires_at IS NOT NULL AND expires_at < ${getType() === 'pg' ? "now()::text" : "datetime('now')"} THEN 'expired' ELSE 'active' END as status
     FROM oauth_tokens WHERE provider_id = $1 ORDER BY created_at DESC`,
    [providerId]
  );
  return r.rows;
}

/**
 * Revoke/delete a token
 */
export async function revokeToken(tokenId) {
  const r = await query('DELETE FROM oauth_tokens WHERE id = $1', [tokenId]);
  return { revoked: r.rowCount > 0 };
}

// ========== Internal ==========

async function storeToken(providerId, tokenData, agentId) {
  const id = `tok-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const now = getType() === 'pg' ? 'now()' : "datetime('now')";

  let expiresAt = null;
  if (tokenData.expires_in) {
    expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  }

  await query(
    `INSERT INTO oauth_tokens (id, provider_id, agent_id, access_token, refresh_token, token_type, scopes, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${now}, ${now})`,
    [id, providerId, agentId, tokenData.access_token, tokenData.refresh_token || null,
     tokenData.token_type || 'Bearer', tokenData.scope || null, expiresAt]
  );

  return {
    id,
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'Bearer',
    expires_in: tokenData.expires_in,
    scopes: tokenData.scope,
  };
}

export default {
  initOAuthTables,
  registerProvider, listProviders, getProvider, removeProvider,
  getAuthorizationUrl, exchangeCode,
  clientCredentials,
  getAccessToken, refreshToken, listTokens, revokeToken,
};
