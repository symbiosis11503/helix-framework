import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  analyze,
  topics,
  draft,
  predict,
  review,
  voice,
  registerThreadsCoachTool,
} from '../src/tools/threads-coach.js';

async function withTempTracker(handle, posts, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-'));
  const dir = path.join(root, handle);
  await fs.mkdir(dir, { recursive: true });
  const tracker = {
    meta: {
      handle,
      scraped_at: new Date().toISOString(),
      data_path: 'B',
      post_count: posts.length,
      comment_count: 0,
      latest_post: posts[0]?.text?.slice(0, 30) || null,
    },
    posts,
  };
  await fs.writeFile(path.join(dir, 'tracker.json'), JSON.stringify(tracker, null, 2));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('analyze: returns skill spec + 3 knowledge slices for Path C input', async () => {
  const r = await analyze({ post_text: '人類記憶要忘掉 90% 才能正常生活，AI Agent 卻被設計成永不忘' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sub_skill, 'analyze');
  assert.strictEqual(r.data_path, 'C');
  assert.ok(r.skill_spec.length > 500, 'skill spec should be loaded');
  assert.deepStrictEqual(Object.keys(r.knowledge).sort(), ['algorithm-base', 'data-confidence', 'psychology']);
});

test('analyze: classifies data_path B when handle has tracker with < 10 posts', async () => {
  await withTempTracker('test-handle', [{ text: 'post one' }, { text: 'post two' }], async (dataDir) => {
    const r = await analyze({ handle: 'test-handle', post_text: 'draft text', dataDir });
    assert.strictEqual(r.data_path, 'B');
    assert.strictEqual(r.tracker_summary.post_count, 2);
  });
});

test('analyze: classifies data_path A when tracker has 10+ posts', async () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({ text: `post ${i}` }));
  await withTempTracker('test-handle', posts, async (dataDir) => {
    const r = await analyze({ handle: 'test-handle', post_text: 'draft', dataDir });
    assert.strictEqual(r.data_path, 'A');
  });
});

test('topics: errors when no tracker', async () => {
  const r = await topics({ handle: 'nonexistent-handle', dataDir: '/tmp/no-such-dir-xyz' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no tracker/);
});

test('topics: returns skill + knowledge when tracker exists', async () => {
  await withTempTracker('test-handle', [{ text: 'p1' }], async (dataDir) => {
    const r = await topics({ handle: 'test-handle', dataDir });
    assert.strictEqual(r.ok, true);
    assert.ok(r.skill_spec.includes('topics'));
    assert.deepStrictEqual(Object.keys(r.knowledge).sort(), ['algorithm-base', 'data-confidence']);
  });
});

test('draft: requires topic', async () => {
  await assert.rejects(() => draft({}), /topic required/);
});

test('draft: returns skill + algorithm + psychology knowledge', async () => {
  const r = await draft({ topic: 'B2B niche LINE@', target_signal: 'replies' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.topic, 'B2B niche LINE@');
  assert.strictEqual(r.target_signal, 'replies');
  assert.deepStrictEqual(Object.keys(r.knowledge).sort(), ['algorithm-base', 'psychology']);
});

test('predict: errors when no tracker', async () => {
  const r = await predict({ handle: 'no-handle', post_text: 'draft', dataDir: '/tmp/no-such-dir-xyz' });
  assert.strictEqual(r.ok, false);
});

test('review: requires post_id', async () => {
  await assert.rejects(() => review({ handle: 'x' }), /post_id/);
});

test('voice: errors when no tracker', async () => {
  const r = await voice({ handle: 'no-handle', dataDir: '/tmp/no-such-dir-xyz' });
  assert.strictEqual(r.ok, false);
});

test('registerThreadsCoachTool: registers all 8 sub-skills', async () => {
  const registered = [];
  const registry = { register: (t) => registered.push(t) };
  const res = await registerThreadsCoachTool(registry);
  assert.strictEqual(registered.length, 8);
  const names = registered.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [
    'threads.coach.analyze',
    'threads.coach.draft',
    'threads.coach.predict',
    'threads.coach.refresh',
    'threads.coach.review',
    'threads.coach.setup',
    'threads.coach.topics',
    'threads.coach.voice',
  ]);
  assert.deepStrictEqual(res.registered.sort(), names);
});

test('registerThreadsCoachTool: setup + refresh marked L3 write, others L2 read', async () => {
  const registered = [];
  await registerThreadsCoachTool({ register: (t) => registered.push(t) });
  for (const t of registered) {
    if (t.name === 'threads.coach.setup' || t.name === 'threads.coach.refresh') {
      assert.strictEqual(t.level, 'L3');
      assert.strictEqual(t.category, 'write');
    } else {
      assert.strictEqual(t.level, 'L2');
      assert.strictEqual(t.category, 'read');
    }
  }
});

// ---- Red-line scanner tests ----

import { scanRedLines, scanTrackerComparisons } from '../src/tools/threads-coach/red-line-scanner.js';

test('scanRedLines: clean text → verdict clean', () => {
  const r = scanRedLines('我們做 AI Agent 記憶系統的時候，發現分層比單一向量庫穩。');
  assert.strictEqual(r.summary.verdict, 'clean');
  assert.strictEqual(r.summary.hits_count, 0);
});

test('scanRedLines: R1 react bait detected', () => {
  const r = scanRedLines('如果你同意這個想法，按愛心讓我知道');
  const r1 = r.hits.find((h) => h.rule === 'R1');
  assert.ok(r1, 'should hit R1');
  assert.strictEqual(r.summary.verdict, 'block');
});

test('scanRedLines: R1 tag bait detected', () => {
  const r = scanRedLines('Tag 一個會用到這個的朋友吧！');
  assert.ok(r.hits.find((h) => h.rule === 'R1'));
});

test('scanRedLines: R1 comment bait detected', () => {
  const r = scanRedLines('如果有共鳴，留言告訴我你的故事');
  assert.ok(r.hits.find((h) => h.rule === 'R1'));
});

test('scanRedLines: R2 clickbait phrase detected', () => {
  const r = scanRedLines('你絕對不會相信這個 AI 工具能做到的事');
  assert.ok(r.hits.find((h) => h.rule === 'R2'));
});

test('scanRedLines: R2 excessive exclamation warned but not blocked', () => {
  const r = scanRedLines('AI 真的太強了！！！！！');
  const r2Warn = r.warnings.find((w) => w.rule === 'R2');
  assert.ok(r2Warn);
});

test('scanRedLines: R7 political topic flagged as warning', () => {
  const r = scanRedLines('這次選舉之後，我覺得政府應該先推 AI 產業政策');
  const r7 = r.warnings.find((w) => w.rule === 'R7');
  assert.ok(r7);
  assert.ok(r7.detail.political);
});

test('scanRedLines: R6 hint when external link present, no warning for normal domain', () => {
  const r = scanRedLines('參考這篇 https://example.com/article 寫得很完整');
  const r6Hint = r.hints.find((h) => h.rule === 'R6');
  assert.ok(r6Hint);
  assert.strictEqual(r.warnings.find((w) => w.rule === 'R6'), undefined);
});

test('scanRedLines: R6 warning for suspect TLD', () => {
  const r = scanRedLines('看這個 https://shady.tk/page 真的有效');
  assert.ok(r.warnings.find((w) => w.rule === 'R6'));
});

test('scanRedLines: hints always include R3 + R11', () => {
  const r = scanRedLines('正常文字');
  assert.ok(r.hints.find((h) => h.rule === 'R3'));
  assert.ok(r.hints.find((h) => h.rule === 'R11'));
});

test('scanTrackerComparisons: no tracker → both unavailable', () => {
  const r = scanTrackerComparisons('post text', null);
  assert.strictEqual(r.r4_originality.available, false);
  assert.strictEqual(r.r5_consecutive_topic.available, false);
});

test('scanTrackerComparisons: R4 detects high similarity to recent post', () => {
  const tracker = {
    posts: [
      { text: '完全不一樣的內容講別的事' },
      { text: 'AI Agent 記憶系統三層架構 short context session 摘要長期向量' },
    ],
  };
  const r = scanTrackerComparisons(
    'AI Agent 記憶系統三層架構 short context session 摘要長期向量資料庫',
    tracker,
  );
  assert.strictEqual(r.r4_originality.available, true);
  assert.ok(r.r4_originality.max_similarity > 0.5);
});

test('analyze: integrates deterministic scan into output', async () => {
  const r = await analyze({
    post_text: '如果你同意這個觀點，按愛心給我',
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.deterministic_scan, 'deterministic_scan present');
  assert.strictEqual(r.deterministic_scan.text_only.summary.verdict, 'block');
  assert.ok(r.deterministic_scan.text_only.hits.find((h) => h.rule === 'R1'));
});

test('analyze: logEvent failure does not break the call', async () => {
  // db.js has no init in test context — logEvent should swallow the error
  const r = await analyze({ post_text: '正常文字' });
  assert.strictEqual(r.ok, true);
});
