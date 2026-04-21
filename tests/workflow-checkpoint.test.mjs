import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  listCheckpoints,
  runWithCheckpoint,
} from '../src/workflow-checkpoint.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'helix-ckpt-')); }

test('checkpoint: save + load roundtrip', () => {
  const dir = tmp();
  try {
    saveCheckpoint({ flowId: 'f1', stepId: 's2', stepIndex: 1, context: { a: 1 } }, { dir });
    const got = loadCheckpoint('f1', { dir });
    assert.equal(got.flowId, 'f1');
    assert.equal(got.stepId, 's2');
    assert.equal(got.stepIndex, 1);
    assert.deepEqual(got.context, { a: 1 });
    assert.ok(got.updatedAt > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint: load returns null when absent', () => {
  const dir = tmp();
  try {
    assert.equal(loadCheckpoint('missing', { dir }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint: clear removes the file', () => {
  const dir = tmp();
  try {
    saveCheckpoint({ flowId: 'f2', stepId: 's1', stepIndex: 0, context: {} }, { dir });
    assert.ok(loadCheckpoint('f2', { dir }));
    clearCheckpoint('f2', { dir });
    assert.equal(loadCheckpoint('f2', { dir }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint: list returns active flows', () => {
  const dir = tmp();
  try {
    saveCheckpoint({ flowId: 'a', stepId: 's1', stepIndex: 0, context: {} }, { dir });
    saveCheckpoint({ flowId: 'b', stepId: 's1', stepIndex: 0, context: {} }, { dir });
    const list = listCheckpoints({ dir });
    assert.equal(list.length, 2);
    const ids = list.map((c) => c.flowId).sort();
    assert.deepEqual(ids, ['a', 'b']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runWithCheckpoint: runs all steps, context accumulates', async () => {
  const dir = tmp();
  try {
    const out = await runWithCheckpoint({
      flowId: 'flow-all',
      dir,
      steps: [
        { id: 'step1', run: async () => 'r1' },
        { id: 'step2', run: async (ctx) => `${ctx.step1}+r2` },
        { id: 'step3', run: async (ctx) => `${ctx.step2}+r3` },
      ],
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.completed, ['step1', 'step2', 'step3']);
    assert.equal(out.output.step3, 'r1+r2+r3');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runWithCheckpoint: resumes after failure, skips completed steps', async () => {
  const dir = tmp();
  try {
    // Attempt 1: fails on step 3
    let step3Count = 0;
    const attempt1 = await runWithCheckpoint({
      flowId: 'flow-fail',
      dir,
      steps: [
        { id: 'step1', run: async () => 'r1' },
        { id: 'step2', run: async () => 'r2' },
        { id: 'step3', run: async () => { step3Count++; throw new Error('boom'); } },
      ],
    });
    assert.equal(attempt1.ok, false);
    assert.equal(step3Count, 1);

    // Attempt 2: step 1 & 2 restored from checkpoint, step 3 re-runs and succeeds
    let step1Runs = 0, step2Runs = 0, step3Runs = 0;
    const attempt2 = await runWithCheckpoint({
      flowId: 'flow-fail',
      dir,
      steps: [
        { id: 'step1', run: async () => { step1Runs++; return 'r1'; } },
        { id: 'step2', run: async () => { step2Runs++; return 'r2'; } },
        { id: 'step3', run: async () => { step3Runs++; return 'r3'; } },
      ],
    });
    assert.equal(attempt2.ok, true);
    assert.equal(step1Runs, 0, 'step1 should be skipped');
    assert.equal(step2Runs, 0, 'step2 should be skipped');
    assert.equal(step3Runs, 1, 'step3 should re-run');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
