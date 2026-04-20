import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

const dbDir = mkdtempSync(join(tmpdir(), 'helix-int-'));
process.env.HELIX_TEST_DB = join(dbDir, 'test.db');

const { initDb, query } = await import('../src/db.js');
await initDb({ database: { type: 'sqlite', path: process.env.HELIX_TEST_DB } });

const trace = await import('../src/trace-lite.js');
const evalLite = await import('../src/eval-lite.js');
const session = await import('../src/session-store.js');

before(async () => {
  await trace.initTraceTables();
  await evalLite.initEvalTables();
});

after(() => {
  try { rmSync(dbDir, { recursive: true, force: true }); } catch {}
});

test('trace-lite: startRun + endRun + listRuns', async () => {
  const run = await trace.startRun({ agentId: 'test-agent', source: 'integration-test' });
  assert.ok(run.id, 'run id returned');
  await trace.endRun(run.id, { status: 'completed' });
  const runs = await trace.listRuns({ agentId: 'test-agent', limit: 10 });
  assert.ok(runs.length >= 1);
  assert.equal(runs[0].status, 'completed');
});

test('trace-lite: startSpan + endSpan + getRun', async () => {
  const run = await trace.startRun({ agentId: 'span-test' });
  const span = await trace.startSpan({ runId: run.id, name: 'test.op', spanType: 'test' });
  assert.ok(span.id);
  await trace.endSpan(span.id, { status: 'ok', output: { ok: true } });
  await trace.endRun(run.id, { status: 'completed' });
  const full = await trace.getRun(run.id);
  assert.equal(full.id, run.id);
  assert.ok(Array.isArray(full.spans));
  assert.ok(full.spans.length >= 1);
});

test('trace-lite: attachEvalScore + eval_score round-trip', async () => {
  const run = await trace.startRun({ agentId: 'eval-test' });
  await trace.endRun(run.id, { status: 'completed' });
  await trace.attachEvalScore(run.id, { summary: { avg_score: 92, min_score: 85, badge: 'green' } }, 'test-v1');
  const full = await trace.getRun(run.id);
  const score = full.eval_score; // getRun already parses JSON
  assert.equal(score.summary.badge, 'green');
  assert.equal(score.summary.avg_score, 92);
});

test('trace-lite: traceStats returns runs/spans/byStatus', async () => {
  const stats = await trace.traceStats({ hours: 24 });
  assert.ok(typeof stats.runs === 'number');
  assert.ok(typeof stats.spans === 'number');
  assert.ok(stats.byStatus && typeof stats.byStatus === 'object');
});

test('trace-lite: listRunsNeedingEval excludes already-scored', async () => {
  const needs = await trace.listRunsNeedingEval({ limit: 50 });
  assert.ok(Array.isArray(needs));
  // The eval-test run from previous test should NOT be in this list
  const ids = new Set(needs.map(r => r.id));
  // The one we just scored shouldn't be here (if evalVersion is null, any score excludes it)
  assert.ok(needs.every(r => !r.eval_score), 'all returned runs lack eval_score');
});

test('session-store: create + get + append + list', async () => {
  const s = await session.createSession({ agentId: 'sess-test', systemPrompt: 'you are helpful' });
  assert.ok(s.id);
  const fetched = await session.getSession(s.id);
  assert.equal(fetched.agent_id, 'sess-test');
  await session.appendMessage({ sessionId: s.id, role: 'user', content: 'hello' });
  await session.appendMessage({ sessionId: s.id, role: 'assistant', content: 'hi there' });
  const msgs = await session.getMessages(s.id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  const list = await session.listSessions('sess-test');
  assert.ok(list.length >= 1);
});

test('session-store: sessionStats', async () => {
  const stats = await session.sessionStats('sess-test');
  assert.ok(stats.sessions);
  assert.ok(Number(stats.sessions.total) >= 1);
});

test('session-store: buildSessionContext returns text + tokens', async () => {
  const s = await session.createSession({ agentId: 'ctx-test', systemPrompt: 'sys' });
  await session.appendMessage({ sessionId: s.id, role: 'user', content: 'q1' });
  await session.appendMessage({ sessionId: s.id, role: 'assistant', content: 'a1' });
  const ctx = await session.buildSessionContext(s.id);
  assert.equal(typeof ctx.text, 'string');
  assert.ok(ctx.text.includes('q1'));
  assert.ok(ctx.text.includes('a1'));
  assert.ok(typeof ctx.tokens === 'number');
  assert.ok(typeof ctx.messageCount === 'number');
});

test('eval-lite: commandSafetySuite returns ≥10 cases', () => {
  const cases = evalLite.commandSafetySuite();
  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 10, `got ${cases.length} cases, expected ≥10`);
  assert.ok(cases.every(c => c.input && c.expected));
});

test('eval-lite: promptInjectionSuite returns cases', () => {
  const cases = evalLite.promptInjectionSuite();
  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 5);
});

test('eval-lite: evalCommandSafety end-to-end', async () => {
  const r = await evalLite.evalCommandSafety();
  assert.ok(r.score !== undefined);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(typeof r.passed === 'number');
  assert.ok(typeof r.total === 'number');
  assert.equal(r.suite, 'command-safety');
});

test('eval-lite: evalPromptInjection end-to-end', async () => {
  const r = await evalLite.evalPromptInjection();
  assert.ok(r.score !== undefined);
  assert.equal(r.suite, 'prompt-injection');
});

test('eval-lite: getEvalHistory returns array', async () => {
  const h = await evalLite.getEvalHistory({ limit: 10 });
  assert.ok(Array.isArray(h));
  // We just ran 2 evals, history should have entries
  assert.ok(h.length >= 2);
});

test('cli: helix --version prints 0.x.x', () => {
  const out = execSync(`node ${join(REPO_ROOT, 'bin/helix.js')} --version`, { encoding: 'utf8' });
  assert.match(out, /helix v\d+\.\d+\.\d+/i);
});

test('cli: helix help prints usage', () => {
  const out = execSync(`node ${join(REPO_ROOT, 'bin/helix.js')} help`, { encoding: 'utf8' });
  assert.match(out, /helix.*init|start|login|doctor/is);
});

test('cli: unknown subcommand falls through to help', () => {
  const out = execSync(`node ${join(REPO_ROOT, 'bin/helix.js')} definitely-not-a-real-command 2>&1 || true`, { encoding: 'utf8' });
  assert.match(out, /init|start|login|doctor/is, 'help output shown as fallback');
});
