/**
 * threads-coach Tool — Threads growth decision system.
 *
 * Skill spec: data/skills/threads-coach/SKILL.md
 *
 * Sub-skills exposed as discrete tool calls:
 *   threads.coach.setup    — first-time scrape + tracker.json bootstrap
 *   threads.coach.refresh  — incremental tracker update
 *   threads.coach.analyze  — diagnostic on a finished post (3-pass scan)
 *   threads.coach.topics   — next-post candidates from history + comments
 *   threads.coach.draft    — generate 1-3 draft versions from a topic
 *   threads.coach.predict  — 24h performance range from comparable history
 *   threads.coach.review   — predicted vs actual + lessons
 *   threads.coach.voice    — brand_voice.md fingerprint analysis
 *
 * Knowledge base: data/skills/threads-coach/knowledge/
 *   - algorithm-base.md  (12 red lines + 14 signals, sourced)
 *   - psychology.md      (audience behavior reasoning)
 *   - data-confidence.md (Directional/Weak/Usable/Strong/Deep rubric)
 *
 * The handlers below are thin wrappers — heavy reasoning lives in the LLM
 * caller invoking the sub-skill spec. This file's job is to load the right
 * knowledge slice + tracker.json and return them as structured context.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRedLines, scanTrackerComparisons } from './threads-coach/red-line-scanner.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '../../data/skills/threads-coach');
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data/threads');

async function readSkillFile(rel) {
  return fs.readFile(path.join(SKILL_ROOT, rel), 'utf8');
}

async function readTracker(handle, dataDir = DEFAULT_DATA_DIR) {
  const trackerPath = path.join(dataDir, handle, 'tracker.json');
  try {
    return JSON.parse(await fs.readFile(trackerPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function loadKnowledge(slices = []) {
  const out = {};
  for (const slice of slices) {
    out[slice] = await readSkillFile(`knowledge/${slice}.md`);
  }
  return out;
}

async function loadSubSkill(name) {
  return readSkillFile(`sub-skills/${name}.md`);
}

export async function setup({ handle, dataDir = DEFAULT_DATA_DIR }) {
  if (!handle) throw new Error('handle required');
  const scrapeScript = path.join(SKILL_ROOT, 'scripts/playwright-scrape.mjs');
  const outPath = path.join(dataDir, handle, 'tracker.json');
  const { stdout } = await execFileP('node', [scrapeScript, '--handle', handle, '--out', outPath], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const summary = JSON.parse(stdout.slice(stdout.indexOf('{')));
  return {
    ok: true,
    sub_skill: 'setup',
    handle,
    tracker_path: outPath,
    ...summary,
  };
}

export async function refresh({ handle, dataDir = DEFAULT_DATA_DIR, since = null }) {
  if (!handle) throw new Error('handle required');
  const scrapeScript = path.join(SKILL_ROOT, 'scripts/playwright-scrape.mjs');
  const outPath = path.join(dataDir, handle, 'tracker.json');
  const args = [scrapeScript, '--handle', handle, '--out', outPath];
  if (since) args.push('--since', since);
  const { stdout } = await execFileP('node', args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const summary = JSON.parse(stdout.slice(stdout.indexOf('{')));
  return { ok: true, sub_skill: 'refresh', handle, ...summary };
}

export async function analyze({ handle, post_text, dataDir = DEFAULT_DATA_DIR, scanOpts = {} }) {
  if (!post_text) throw new Error('post_text required');
  const tracker = handle ? await readTracker(handle, dataDir) : null;
  const knowledge = await loadKnowledge(['algorithm-base', 'psychology', 'data-confidence']);
  const skill = await loadSubSkill('analyze');
  const data_path = tracker ? (tracker.posts.length >= 10 ? 'A' : 'B') : 'C';

  const deterministic = {
    text_only: scanRedLines(post_text, scanOpts),
    tracker_comparisons: scanTrackerComparisons(post_text, tracker, scanOpts),
  };

  return {
    ok: true,
    sub_skill: 'analyze',
    handle,
    post_text,
    data_path,
    tracker_summary: tracker
      ? { post_count: tracker.posts.length, latest: tracker.meta.latest_post }
      : null,
    deterministic_scan: deterministic,
    skill_spec: skill,
    knowledge,
    note: 'deterministic_scan covers R1/R2/R6/R7/R10/R12 + tracker-based R4/R5. Use skill_spec + knowledge to layer on signal scoring (S1-S14) via LLM.',
  };
}

export async function topics({ handle, dataDir = DEFAULT_DATA_DIR, limit = 5 }) {
  if (!handle) throw new Error('handle required');
  const tracker = await readTracker(handle, dataDir);
  if (!tracker) {
    return {
      ok: false,
      sub_skill: 'topics',
      error: `no tracker for ${handle} — run threads.coach.setup first`,
    };
  }
  const knowledge = await loadKnowledge(['algorithm-base', 'data-confidence']);
  const skill = await loadSubSkill('topics');
  return {
    ok: true,
    sub_skill: 'topics',
    handle,
    limit,
    tracker_summary: { post_count: tracker.posts.length, comment_count: tracker.meta.comment_count },
    skill_spec: skill,
    knowledge,
  };
}

export async function draft({ handle, topic, angle, target_signal, target_audience, dataDir = DEFAULT_DATA_DIR }) {
  if (!topic) throw new Error('topic required');
  const tracker = handle ? await readTracker(handle, dataDir) : null;
  const knowledge = await loadKnowledge(['algorithm-base', 'psychology']);
  const skill = await loadSubSkill('draft');
  return {
    ok: true,
    sub_skill: 'draft',
    handle,
    topic,
    angle,
    target_signal,
    target_audience,
    tracker_summary: tracker ? { post_count: tracker.posts.length } : null,
    skill_spec: skill,
    knowledge,
  };
}

export async function predict({ handle, post_text, dataDir = DEFAULT_DATA_DIR }) {
  if (!handle || !post_text) throw new Error('handle and post_text required');
  const tracker = await readTracker(handle, dataDir);
  if (!tracker) {
    return { ok: false, sub_skill: 'predict', error: `no tracker for ${handle}` };
  }
  const knowledge = await loadKnowledge(['algorithm-base', 'data-confidence']);
  const skill = await loadSubSkill('predict');
  return {
    ok: true,
    sub_skill: 'predict',
    handle,
    post_text,
    tracker_summary: { post_count: tracker.posts.length },
    skill_spec: skill,
    knowledge,
  };
}

export async function review({ handle, post_id, actual_metrics, dataDir = DEFAULT_DATA_DIR }) {
  if (!handle || !post_id) throw new Error('handle and post_id required');
  const tracker = await readTracker(handle, dataDir);
  const knowledge = await loadKnowledge(['algorithm-base']);
  const skill = await loadSubSkill('review');
  return {
    ok: true,
    sub_skill: 'review',
    handle,
    post_id,
    actual_metrics,
    tracker_present: !!tracker,
    skill_spec: skill,
    knowledge,
  };
}

export async function voice({ handle, dataDir = DEFAULT_DATA_DIR }) {
  if (!handle) throw new Error('handle required');
  const tracker = await readTracker(handle, dataDir);
  if (!tracker) return { ok: false, sub_skill: 'voice', error: `no tracker for ${handle}` };
  const skill = await loadSubSkill('voice');
  return {
    ok: true,
    sub_skill: 'voice',
    handle,
    posts_available: tracker.posts.length,
    skill_spec: skill,
  };
}

export async function registerThreadsCoachTool(registry) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('registry with register() required');
  }
  const handlers = { setup, refresh, analyze, topics, draft, predict, review, voice };
  const registered = [];
  for (const [name, fn] of Object.entries(handlers)) {
    registry.register({
      name: `threads.coach.${name}`,
      description: `threads-coach / ${name} — see data/skills/threads-coach/sub-skills/${name}.md`,
      level: name === 'setup' || name === 'refresh' ? 'L3' : 'L2',
      category: name === 'setup' || name === 'refresh' ? 'write' : 'read',
      inputSchema: { required: [], optional: ['handle', 'post_text', 'topic', 'post_id'] },
      handler: async (args) => fn(args || {}),
      metadata: { skill: 'data/skills/threads-coach/SKILL.md' },
    });
    registered.push(`threads.coach.${name}`);
  }
  return { registered };
}

export default {
  setup,
  refresh,
  analyze,
  topics,
  draft,
  predict,
  review,
  voice,
  registerThreadsCoachTool,
};
