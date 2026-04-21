import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry, createCircuitBreaker, isTransientError } from '../src/retry-policy.js';

test('retry: returns on first success', async () => {
  let calls = 0;
  const out = await retry(async () => { calls++; return 'ok'; });
  assert.equal(out, 'ok');
  assert.equal(calls, 1);
});

test('retry: retries on transient then succeeds', async () => {
  let calls = 0;
  const out = await retry(
    async () => { calls++; if (calls < 3) throw new Error('transient'); return 'done'; },
    { maxAttempts: 5, baseDelayMs: 1 },
  );
  assert.equal(out, 'done');
  assert.equal(calls, 3);
});

test('retry: exhausts attempts and throws last error', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('nope'); }, { maxAttempts: 3, baseDelayMs: 1 }),
    /nope/,
  );
  assert.equal(calls, 3);
});

test('retry: shouldRetry=false aborts early', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(
      async () => { calls++; const e = new Error('permanent'); e.permanent = true; throw e; },
      { maxAttempts: 5, baseDelayMs: 1, shouldRetry: (e) => !e.permanent },
    ),
  );
  assert.equal(calls, 1);
});

test('circuit breaker: opens after threshold, blocks with circuit_open', async () => {
  const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
  await assert.rejects(() => cb.run(async () => { throw new Error('fail1'); }));
  await assert.rejects(() => cb.run(async () => { throw new Error('fail2'); }));
  assert.equal(cb.state(), 'open');
  await assert.rejects(() => cb.run(async () => 'never'), /circuit_open/);
});

test('circuit breaker: half-open probe success closes the circuit', async () => {
  const cb = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 10 });
  await assert.rejects(() => cb.run(async () => { throw new Error('fail'); }));
  assert.equal(cb.state(), 'open');
  await new Promise((r) => setTimeout(r, 30));
  const out = await cb.run(async () => 'recovered');
  assert.equal(out, 'recovered');
  assert.equal(cb.state(), 'closed');
});

test('isTransientError: recognizes timeouts and 5xx', () => {
  assert.equal(isTransientError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientError({ name: 'AbortError' }), true);
  assert.equal(isTransientError({ status: 503 }), true);
  assert.equal(isTransientError({ status: 429 }), true);
  assert.equal(isTransientError({ status: 400 }), false);
  assert.equal(isTransientError(null), false);
});
