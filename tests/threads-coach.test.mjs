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

// ---- Voice analyzer tests ----

import { analyzeVoice, renderVoiceMarkdown } from '../src/tools/threads-coach/voice-analyzer.js';

test('analyzeVoice: rejects when fewer than 5 posts', () => {
  const tracker = { posts: [{ text: '一篇文'.repeat(20) }] };
  const r = analyzeVoice(tracker);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /needs >= 5/);
});

test('analyzeVoice: produces summary when >= 5 posts', () => {
  const tracker = {
    posts: [
      { id: 'a', text: '今天我發現一個 bug。原因是缺少測試。我們的做法是先補測試再 fix。你會怎麼處理？' },
      { id: 'b', text: '其實大部分人搞錯了 git rebase。我自己踩過這個坑。重點是不要 rebase 已 push 的 commit。' },
      { id: 'c', text: '3 種 Bun SEA 的雷：1. native module 2. dynamic import 3. file path。我們的解法是先測試。' },
      { id: 'd', text: '昨天客戶問我為什麼 Helix 不用 LangChain。我發現很多人不知道差異。簡單說 LangChain 太重。' },
      { id: 'e', text: '我們系統壞了，第一反應不是修，是先看 log。Grafana dashboard 是必要的，不是可有可無。' },
      { id: 'f', text: 'AI Agent 的記憶系統怎麼做？我發現分層比單一向量庫穩。短期 / 中期 / 長期 三層。' },
    ],
  };
  const r = analyzeVoice(tracker);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.posts_analyzed, 6);
  assert.ok(r.hook_distribution);
  assert.ok(r.tone_totals);
  assert.ok(r.summary.dominant_hook);
  assert.ok(typeof r.avg_chars_per_post === 'number');
});

test('analyzeVoice: detects historically used forbidden phrases', () => {
  const tracker = {
    posts: [
      { id: 'a', text: '今天踩到的雷是 git rebase。寫起來才發現很多人沒注意 push 後 rebase 的問題。' },
      { id: 'b', text: '99% 的人都不知道這個 npm 指令，可以一鍵清理 stale dependencies。' },
      { id: 'c', text: '正常一點的內容，講框架選擇的時候要考慮 ecosystem 大小。' },
      { id: 'd', text: '另一篇講 AI Agent 記憶系統的內容，分層設計比單一向量穩。' },
      { id: 'e', text: '又一篇談 Bun 的好處，啟動速度比 Node 快兩倍以上。' },
    ],
  };
  const r = analyzeVoice(tracker);
  assert.strictEqual(r.ok, true);
  const r2Hits = r.forbidden_phrases_used.filter((f) => f.rule === 'R2');
  assert.ok(r2Hits.length > 0, 'should flag clickbait');
});

test('analyzeVoice: ranks top performers when metrics present', () => {
  const tracker = {
    posts: [
      { id: 'low', text: '一篇普通的文字內容講 Node.js 框架選擇。'.repeat(2), metrics: { likes: 1, replies: 0 } },
      { id: 'high', text: 'Git hooks 是最容易的 CI 起手式，比 Jenkins 簡單多了。'.repeat(2), metrics: { likes: 30, replies: 5, shares: 10 } },
      { id: 'mid', text: '中間表現的文字講 Bun SEA 編譯實測心得。'.repeat(2), metrics: { likes: 5, replies: 1 } },
      { id: 'p1', text: '另一個沒 metrics 的文章內容講 Helix 框架設計理念。', metrics: { likes: null } },
      { id: 'p2', text: '又一個沒 metrics 的內容談 Threads 經營策略。', metrics: { likes: null } },
    ],
  };
  const r = analyzeVoice(tracker);
  assert.strictEqual(r.ok, true);
  assert.ok(r.top_performers.length > 0);
  assert.strictEqual(r.top_performers[0].id, 'high');
});

test('renderVoiceMarkdown: produces markdown with required sections', () => {
  const tracker = {
    posts: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      text: `今天我發現第 ${i} 個有趣的點。其實大家都搞錯了。我們的做法是 X。你會怎麼想？`,
    })),
  };
  const analysis = analyzeVoice(tracker);
  const md = renderVoiceMarkdown(analysis, 'test-handle');
  assert.match(md, /Brand Voice — test-handle/);
  assert.match(md, /## Summary/);
  assert.match(md, /## Hook Distribution/);
  assert.match(md, /## Manual Refinements/);
});

// ---- Metrics extraction regex sanity (mirrors playwright-scrape.mjs extractMetricsFromText) ----

test('metrics regex: parses Threads UI engagement counts from "讚24回覆9轉發1分享4"', () => {
  const text = '讚24回覆9轉發1分享4';
  const out = {};
  const patterns = [
    [/讚\s*(\d+)/g, 'likes'],
    [/回覆\s*(\d+)/g, 'replies'],
    [/轉發\s*(\d+)/g, 'reposts'],
    [/分享\s*(\d+)/g, 'shares'],
  ];
  for (const [re, field] of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) out[field] = parseInt(m[1], 10);
  }
  assert.deepStrictEqual(out, { likes: 24, replies: 9, reposts: 1, shares: 4 });
});

test('metrics regex: handles partial UI text (only some counts visible)', () => {
  const text = '讚2回覆轉發分享';
  const m = text.match(/讚\s*(\d+)/);
  assert.ok(m);
  assert.strictEqual(parseInt(m[1], 10), 2);
});

// ---- Topics miner tests ----

import { mineUnmetDemand, mineExtensionTopics, mineTopics } from '../src/tools/threads-coach/topics-miner.js';

test('mineUnmetDemand: finds questions in comments not answered in subsequent posts', () => {
  const tracker = {
    posts: [
      {
        id: 'p1',
        url: 'https://t.test/p1',
        ts: '2026-04-20',
        text: '怎麼用 Bun SEA 編譯 helix 框架的初步分享筆記',
        comments: [
          { author: 'commentor1', text: 'Bun SEA 在 Linux 跑生產有什麼坑？想了解細節', ts: '2026-04-20T01:00:00Z' },
          { author: 'commentor2', text: '推 Bun SEA 路線', ts: '2026-04-20T02:00:00Z' },
        ],
      },
      {
        id: 'p2',
        url: 'https://t.test/p2',
        ts: '2026-04-22',
        text: 'Helix Framework 0.12 新功能 demo',
        comments: [],
      },
    ],
  };
  const out = mineUnmetDemand(tracker);
  assert.ok(out.length >= 1);
  const q = out.find((x) => x.asker === 'commentor1');
  assert.ok(q);
  assert.strictEqual(q.status, 'unanswered');
});

test('mineExtensionTopics: surfaces top-engagement posts as extension seeds', () => {
  const tracker = {
    posts: [
      { id: 'low', text: '一般文字內容', metrics: { likes: 1, replies: 0 } },
      { id: 'high', text: 'Git hooks 是 CI 起手式', metrics: { likes: 30, replies: 5, shares: 10 } },
      { id: 'mid', text: '中等表現的內容', metrics: { likes: 5, replies: 1 } },
      { id: 'p4', text: '另一篇', metrics: { likes: 2, replies: 0 } },
    ],
  };
  const out = mineExtensionTopics(tracker);
  assert.ok(out.length >= 1);
  assert.strictEqual(out[0].seed_post_id, 'high');
});

test('mineTopics: returns mixed candidates with freshness scores', () => {
  const tracker = {
    posts: [
      {
        id: 'p1',
        ts: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        text: '舊文：講 AI Agent 記憶系統的實作細節',
        comments: [
          { author: 'commentor', text: '想了解 Helix 怎麼處理長期記憶？怎麼做？' },
        ],
        metrics: { likes: 10, replies: 3, shares: 2 },
      },
      {
        id: 'p2',
        ts: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
        text: '新文：Threads 經營策略小心得',
        metrics: { likes: 5, replies: 1, shares: 0 },
      },
    ],
  };
  const out = mineTopics(tracker, { limit: 3 });
  assert.ok(out.candidates.length > 0);
  assert.ok('freshness_score' in out.candidates[0]);
  assert.ok('fatigue_risk' in out.candidates[0]);
});

// ---- Predict baseline tests ----

import { predictPost } from '../src/tools/threads-coach/predict-baseline.js';

test('predictPost: returns p25/p50/p75 from comparable history', () => {
  const tracker = {
    posts: [
      { id: 'p1', text: 'Git hooks 是最容易的 CI 起手式', metrics: { likes: 30, replies: 5, shares: 10 } },
      { id: 'p2', text: 'Git rebase 注意事項分享', metrics: { likes: 20, replies: 3, shares: 5 } },
      { id: 'p3', text: 'Git workflow 進階技巧', metrics: { likes: 15, replies: 2, shares: 3 } },
      { id: 'p4', text: 'Git 心得整理筆記', metrics: { likes: 10, replies: 1, shares: 2 } },
      { id: 'p5', text: 'Git 入門快速上手', metrics: { likes: 5, replies: 0, shares: 1 } },
    ],
  };
  const r = predictPost('Git hooks 進階用法的心得', tracker);
  assert.strictEqual(r.ok, true);
  assert.ok(r.predicted.likes);
  assert.ok(r.predicted.likes.p25 <= r.predicted.likes.p50);
  assert.ok(r.predicted.likes.p50 <= r.predicted.likes.p75);
  assert.ok(['low', 'medium', 'high'].includes(r.confidence));
});

test('predictPost: returns error when no comparable posts', () => {
  const tracker = { posts: [] };
  const r = predictPost('某篇文', tracker);
  assert.strictEqual(r.ok, false);
});

// ---- Draft generator tests ----

import { generateDraftScaffolds } from '../src/tools/threads-coach/draft-generator.js';

test('generateDraftScaffolds: returns 3 differentiated versions', () => {
  const r = generateDraftScaffolds({
    topic: 'B2B niche LINE@ 切入策略',
    target_signal: 'replies',
    target_audience: 'b2b',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.versions.length, 3);
  const labels = r.versions.map((v) => v.hook_type);
  assert.deepStrictEqual(labels.sort(), ['contrarian', 'framework', 'story']);
});

test('generateDraftScaffolds: B2B audience adjusts forbidden patterns', () => {
  const r = generateDraftScaffolds({
    topic: 'X',
    target_signal: 'replies',
    target_audience: 'b2b',
  });
  assert.ok(r.audience_guardrails.must_avoid.includes('hashtag_stuffing'));
  assert.ok(r.audience_guardrails.must_avoid.includes('engagement_bait_R1'));
});

test('generateDraftScaffolds: requires topic', () => {
  assert.throws(() => generateDraftScaffolds({}), /topic required/);
});

// ---- Review evaluator tests ----

import { reviewPost } from '../src/tools/threads-coach/review-evaluator.js';

test('reviewPost: classifies actual within IQR as good prediction', () => {
  const r = reviewPost({
    post_id: 'p1',
    predicted: {
      likes: { p25: 10, p50: 20, p75: 30 },
      replies: { p25: 1, p50: 3, p75: 5 },
      main_signal: 'replies',
    },
    actual_metrics: { likes: 22, replies: 4 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.comparisons.likes.classification, 'within_iqr');
  assert.strictEqual(r.comparisons.replies.classification, 'within_iqr');
  assert.strictEqual(r.main_signal_match.fired, true);
});

test('reviewPost: classifies actual far above p75 as positive lesson', () => {
  const r = reviewPost({
    post_id: 'p1',
    predicted: {
      likes: { p25: 10, p50: 20, p75: 30 },
      main_signal: 'likes',
    },
    actual_metrics: { likes: 80 },
  });
  assert.strictEqual(r.comparisons.likes.landing, 'above_p75');
  const positive = r.lessons.find((l) => l.type === 'positive');
  assert.ok(positive);
});

test('reviewPost: detects severe deviation below', () => {
  const r = reviewPost({
    post_id: 'p1',
    predicted: {
      likes: { p25: 18, p50: 20, p75: 22 },  // tight IQR, makes deviation more severe
      main_signal: 'likes',
    },
    actual_metrics: { likes: 8 },  // dev = |8-20|/4 = 3.0 → severe
  });
  assert.strictEqual(r.comparisons.likes.classification, 'severe');
  assert.strictEqual(r.comparisons.likes.landing, 'below_p25');
  const negative = r.lessons.find((l) => l.type === 'negative');
  assert.ok(negative);
});

test('reviewPost: confirms diversity caveat when likes below_p25', () => {
  const r = reviewPost({
    post_id: 'p1',
    predicted: { likes: { p25: 10, p50: 20, p75: 30 } },
    actual_metrics: { likes: 5 },
    caveats_at_predict_time: ['近 7 天已發 2 篇同主題鄰域，diversity 風險，p50 預估下修 30%'],
  });
  const confirmed = r.caveat_verification.find((c) => c.verdict === 'confirmed');
  assert.ok(confirmed);
});

test('reviewPost: requires post_id and actual_metrics', () => {
  const r1 = reviewPost({});
  assert.strictEqual(r1.ok, false);
  const r2 = reviewPost({ post_id: 'x' });
  assert.strictEqual(r2.ok, false);
});

test('analyzeVoice: scrape-noise filtering removes username + duplicated body + engagement suffix', () => {
  // Mimics the actual list-my-posts text format which duplicates body 2-3 times
  const dirtyText =
    'symbiosis115032天更多重構不需要大爆炸重寫，小步快跑更安全。每次改 bug 順手清理動到的檔案，5 分鐘整理。\n' +
    'symbiosis115032天更多重構不需要大爆炸重寫，小步快跑更安全。每次改 bug 順手清理動到的檔案，5 分鐘整理。\n' +
    '重構不需要大爆炸重寫，小步快跑更安全。每次改 bug 順手清理動到的檔案，5 分鐘整理。\n' +
    '讚6回覆轉發分享';
  const tracker = {
    posts: Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      text: dirtyText.replace('重構', `主題 ${i} 重構`),
    })),
  };
  const r = analyzeVoice(tracker);
  assert.strictEqual(r.ok, true);
  // username should NOT show up in top phrases
  const usernameInTop = r.top_phrases.find((p) => p.phrase === 'symbiosis11503');
  assert.strictEqual(usernameInTop, undefined, 'username should be stripped from top phrases');
  // engagement counts (讚N回覆) should NOT show as top phrases
  const engagementInTop = r.top_phrases.find((p) => /^讚\d+/.test(p.phrase) || /^回覆\d+/.test(p.phrase));
  assert.strictEqual(engagementInTop, undefined, 'engagement counts should be stripped');
});

test('voice: integrates analysis output when tracker has posts', async () => {
  const posts = Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`,
    text: `今天的文字 ${i}：我發現很多事情都比想像中複雜。其實大部分人搞錯了。你怎麼處理？`,
  }));
  await withTempTracker('voice-test', posts, async (dataDir) => {
    const r = await voice({ handle: 'voice-test', dataDir });
    assert.strictEqual(r.ok, true);
    assert.ok(r.analysis);
    assert.strictEqual(r.analysis.ok, true);
    assert.ok(r.markdown.includes('Brand Voice — voice-test'));
    assert.strictEqual(r.markdown_path, null, 'markdown_path null without write_markdown flag');
  });
});
