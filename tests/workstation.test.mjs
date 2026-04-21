import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callWorkstation, registerWorkstationTool } from '../src/tools/workstation.js';

test('workstation: throws without WORKSTATION_URL', async () => {
  const prevUrl = process.env.WORKSTATION_URL;
  const prevTok = process.env.WORKSTATION_TOKEN;
  delete process.env.WORKSTATION_URL;
  delete process.env.WORKSTATION_TOKEN;
  try {
    await assert.rejects(() => callWorkstation({ goal: 'test' }), /WORKSTATION_URL not set/);
  } finally {
    if (prevUrl) process.env.WORKSTATION_URL = prevUrl;
    if (prevTok) process.env.WORKSTATION_TOKEN = prevTok;
  }
});

test('workstation: throws without spec.goal', async () => {
  process.env.WORKSTATION_URL = 'http://fake';
  process.env.WORKSTATION_TOKEN = 'fake';
  try {
    await assert.rejects(() => callWorkstation({}), /spec.goal required/);
  } finally {
    delete process.env.WORKSTATION_URL;
    delete process.env.WORKSTATION_TOKEN;
  }
});

test('workstation: registerWorkstationTool registers 4 tools', async () => {
  const registered = [];
  const registry = { register: (def) => registered.push(def.name) };
  const res = await registerWorkstationTool(registry);
  assert.deepEqual(res.registered, [
    'workstation.call',
    'workstation.health',
    'workstation.capabilities',
    'workstation.cancel',
  ]);
  assert.equal(registered.length, 4);
});

test('workstation: end-to-end with mock server', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/workstation/task') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const spec = JSON.parse(body);
        assert.equal(spec.goal, 'mock goal');
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ task_id: 'ws_mock', status: 'queued' }));
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/workstation/task/ws_mock') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        task_id: 'ws_mock',
        status: 'succeeded',
        result: { changed_files: ['a.js'], test_result: 'ok' },
      }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const out = await callWorkstation(
      { goal: 'mock goal' },
      { url: `http://127.0.0.1:${port}`, token: 'tok', pollIntervalMs: 50 },
    );
    assert.equal(out.ok, true);
    assert.equal(out.task_id, 'ws_mock');
    assert.equal(out.status, 'succeeded');
    assert.deepEqual(out.result.changed_files, ['a.js']);
  } finally {
    server.close();
  }
});
