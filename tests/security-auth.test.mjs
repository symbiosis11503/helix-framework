import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const dbDir = mkdtempSync(join(tmpdir(), 'helix-auth-'));
const dbPath = join(dbDir, 'auth.db');
const BOOTSTRAP_TOKEN = 'helix-bootstrap-admin-token';

process.env.ADMIN_TOKEN = BOOTSTRAP_TOKEN;

const { query } = await import('../src/db.js');
const { startLiteServer } = await import('../src/server-lite.js');
const registry = await import('../src/tool-registry.js');
const hooks = await import('../src/hooks.js');
const auth = await import('../src/auth.js');

let runtime;
let baseUrl;
let viewerKey;
let operatorKey;
let adminKey;

function authHeaders(token, extra = {}) {
  return { ...extra, Authorization: 'Bearer ' + token };
}

async function json(path, opt = {}) {
  const res = await fetch(baseUrl + path, opt);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function createKey(body, token = BOOTSTRAP_TOKEN) {
  const { res, data } = await json('/api/auth/keys', {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, JSON.stringify(data));
  return data;
}

before(async () => {
  runtime = await startLiteServer({
    database: { type: 'sqlite', path: dbPath },
    server: { host: '127.0.0.1', port: 0 },
    model: 'local',
  });
  if (!runtime.server.listening) await once(runtime.server, 'listening');
  const { port } = runtime.server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  registry.register({
    name: 'test.echo',
    description: 'echo',
    inputSchema: { required: ['value'], optional: [] },
    handler: async ({ value }) => ({ echoed: value }),
  });
  registry.bindCapabilities('cap-alpha', ['test.echo']);

  await query(
    'INSERT INTO agent_instances (id, role_id, name, model, system_prompt, status) VALUES ($1, $2, $3, $4, $5, $6)',
    ['agent-a', 'cap-alpha', 'Agent A', 'local', 'sys', 'active'],
  );
  await query(
    'INSERT INTO agent_instances (id, role_id, name, model, system_prompt, status) VALUES ($1, $2, $3, $4, $5, $6)',
    ['agent-b', 'cap-beta', 'Agent B', 'local', 'sys', 'active'],
  );
  await query(
    'INSERT INTO sessions (id, agent_id, system_prompt, status) VALUES ($1, $2, $3, $4)',
    ['session-a', 'agent-a', 'sys', 'active'],
  );
  await query(
    'INSERT INTO sessions (id, agent_id, system_prompt, status) VALUES ($1, $2, $3, $4)',
    ['session-b', 'agent-b', 'sys', 'active'],
  );

  viewerKey = (await createKey({ name: 'viewer', role: 'viewer', agent_scope: 'agent-a' })).key;
  operatorKey = (await createKey({ name: 'operator', role: 'operator', agent_scope: 'agent-a' })).key;
  adminKey = (await createKey({ name: 'admin', role: 'admin' })).key;
});

after(async () => {
  hooks.clearHooks();
  try { registry.unregister('test.echo'); } catch {}
  delete process.env.ADMIN_TOKEN;
  await new Promise(resolve => runtime.server.close(resolve));
  rmSync(dbDir, { recursive: true, force: true });
});

test('auth helpers fail closed for unknown roles and missing capabilities', () => {
  assert.equal(auth.hasRole('mystery', 'viewer'), false);
  assert.equal(auth.hasRole('viewer', 'mystery'), false);
  assert.equal(registry.hasCapability('cap-missing', 'test.echo'), false);
});

test('health remains public but anonymous sensitive bootstrap is denied', async () => {
  const health = await fetch(baseUrl + '/api/health');
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.status, 'ok');

  const { res, data } = await json('/api/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'anon', role: 'admin' }),
  });
  assert.equal(res.status, 401);
  assert.match(data.error, /API key required/i);
});

test('viewer cannot mutate or execute protected operations', async () => {
  const executeRes = await json('/api/tools/execute', {
    method: 'POST',
    headers: authHeaders(viewerKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tool: 'test.echo', agent_id: 'agent-a', args: { value: 'hi' } }),
  });
  assert.equal(executeRes.res.status, 403);

  const editRes = await json('/api/files/edit', {
    method: 'POST',
    headers: authHeaders(viewerKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path: '/tmp/nope.txt', old_string: 'a', new_string: 'b' }),
  });
  assert.equal(editRes.res.status, 403);
});

test('operator cannot manage keys or MCP configuration', async () => {
  const keyRes = await json('/api/auth/keys', {
    method: 'POST',
    headers: authHeaders(operatorKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'blocked', role: 'viewer' }),
  });
  assert.equal(keyRes.res.status, 403);

  const mcpRes = await json('/api/mcp/connect', {
    method: 'POST',
    headers: authHeaders(operatorKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'demo', command: 'echo' }),
  });
  assert.equal(mcpRes.res.status, 403);
});

test('authorized admin can manage keys', async () => {
  const { res, data } = await json('/api/auth/keys', {
    headers: authHeaders(adminKey),
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(data.keys));
  assert.ok(data.keys.length >= 3);
});

test('forged body roles do not elevate and unknown capabilities are denied', async () => {
  const denied = await json('/api/tools/execute', {
    method: 'POST',
    headers: authHeaders(adminKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tool: 'test.echo',
      agent_id: 'agent-b',
      role_id: 'cap-alpha',
      args: { value: 'blocked' },
    }),
  });
  assert.equal(denied.res.status, 403);
  assert.match(denied.data.error, /capability/i);

  const allowed = await json('/api/tools/execute', {
    method: 'POST',
    headers: authHeaders(operatorKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tool: 'test.echo',
      agent_id: 'agent-a',
      role_id: 'cap-beta',
      args: { value: 'ok' },
    }),
  });
  assert.equal(allowed.res.status, 200);
  assert.equal(allowed.data.ok, true);
  assert.equal(allowed.data.result.echoed, 'ok');
});

test('scoped callers cannot access other agents or sessions', async () => {
  const foreignSessions = await json('/api/sessions?agent_id=agent-b', {
    headers: authHeaders(operatorKey),
  });
  assert.equal(foreignSessions.res.status, 403);

  const ownSessions = await json('/api/sessions?agent_id=agent-a', {
    headers: authHeaders(operatorKey),
  });
  assert.equal(ownSessions.res.status, 200);
  assert.equal(ownSessions.data.count, 1);

  const foreignMessages = await json('/api/sessions/session-b/messages', {
    headers: authHeaders(operatorKey),
  });
  assert.equal(foreignMessages.res.status, 403);
});

test('dangerous execution is disabled when safety hooks are unavailable', async () => {
  hooks.clearHooks('tool.before');
  const { res, data } = await json('/api/tools/execute', {
    method: 'POST',
    headers: authHeaders(adminKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tool: 'test.echo', agent_id: 'agent-a', args: { value: 'nope' } }),
  });
  assert.equal(res.status, 503);
  assert.match(data.error, /dangerous operations disabled/i);
});
