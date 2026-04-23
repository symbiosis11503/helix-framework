#!/usr/bin/env node
/**
 * threads-coach scrape — pull a Threads profile + per-post detail into tracker.json.
 *
 * Wraps the existing playwright-threads.mjs (sbs-vps:/opt/symbiosis-helix/scripts/) over ssh,
 * so we don't need to re-implement Playwright auth + Xvfb headed mode here.
 *
 * Usage:
 *   node playwright-scrape.mjs --handle <handle> [--out <path>] [--ssh-host sbs-vps]
 *   node playwright-scrape.mjs --handle <handle> --since <iso8601>      # incremental
 *
 * Output: tracker.json structured per data/skills/threads-coach/sub-skills/setup.md
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function flag(name) {
  return process.argv.includes(name);
}

const enrich = !process.argv.includes('--no-enrich');

const handle = arg('--handle');
if (!handle) {
  console.error('Usage: playwright-scrape.mjs --handle <handle> [--out PATH] [--since ISO] [--ssh-host HOST]');
  process.exit(2);
}
const sshHost = arg('--ssh-host', 'sbs-vps');
const outPath = resolve(arg('--out', `data/threads/${handle}/tracker.json`));
const since = arg('--since');

const profileUrl = `https://www.threads.com/@${handle}`;

function sshExec(cmd) {
  const wrapped =
    `cd /opt/symbiosis-helix && set -a; source .env; set +a; export DISPLAY=:99; ${cmd}`;
  return execFileSync('ssh', [sshHost, wrapped], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function safeJson(stdout) {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

// Extract engagement metrics from Threads UI text — patterns like "讚24" / "回覆9" / "轉發1" / "分享10"
// observed in list-my-posts output. Parses from any single text blob.
function extractMetricsFromText(text) {
  if (!text || typeof text !== 'string') return {};
  const out = {};
  const patterns = [
    [/讚\s*(\d+)/g, 'likes'],
    [/回覆\s*(\d+)/g, 'replies'],
    [/轉發\s*(\d+)/g, 'reposts'],
    [/分享\s*(\d+)/g, 'shares'],
    [/Like[s]?\s*(\d+)/gi, 'likes'],
    [/Repl(?:y|ies)?\s*(\d+)/gi, 'replies'],
    [/Repost[s]?\s*(\d+)/gi, 'reposts'],
    [/Share[s]?\s*(\d+)/gi, 'shares'],
  ];
  for (const [re, field] of patterns) {
    re.lastIndex = 0;
    let m;
    let max = 0;
    while ((m = re.exec(text))) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    if (max > 0) out[field] = max;
  }
  return out;
}

console.error(`[scrape] handle=${handle} since=${since || 'all'} via ${sshHost}`);

// Step 1: pull all visible posts with URLs + IDs + ts via list-my-posts
const listRaw = sshExec(`node scripts/playwright-threads.mjs list-my-posts --handle '${handle}' --limit 100 --scrolls 12`);
const list = safeJson(listRaw);
if (!list?.ok || !Array.isArray(list?.posts)) {
  console.error('[scrape] failed to parse list-my-posts output');
  console.error(listRaw.slice(0, 500));
  process.exit(1);
}

console.error(`[scrape] list-my-posts returned ${list.posts.length} posts (total found: ${list.total_found})`);

// Step 2: load existing tracker if present (for incremental merge)
let tracker = {
  meta: {
    handle,
    scraped_at: new Date().toISOString(),
    data_path: 'B',
    post_count: 0,
    comment_count: 0,
    earliest_post: null,
    latest_post: null,
  },
  posts: [],
};

if (existsSync(outPath)) {
  try {
    tracker = JSON.parse(readFileSync(outPath, 'utf8'));
    console.error(`[scrape] loaded existing tracker (${tracker.posts.length} posts)`);
  } catch (e) {
    console.error(`[scrape] existing tracker unreadable, starting fresh: ${e.message}`);
  }
}

const seenIds = new Set(tracker.posts.filter((p) => p.id).map((p) => p.id));

// Step 3: merge new posts (keyed by post id, which we now reliably have)
let added = 0;
let updated = 0;

for (const p of list.posts) {
  if (!p.id) continue;
  if (seenIds.has(p.id)) {
    // already in tracker — refresh metrics from latest scrape (Threads engagement counts change over time)
    const existing = tracker.posts.find((x) => x.id === p.id);
    if (existing && p.text) {
      const fresh = extractMetricsFromText(p.text);
      for (const k of ['likes', 'replies', 'reposts', 'shares']) {
        if (fresh[k] != null) existing.metrics[k] = fresh[k];
      }
      // refresh visible text snapshot (Threads occasionally edits post text)
      existing.text = p.text;
    }
    updated += 1;
    continue;
  }
  const parsedMetrics = extractMetricsFromText(p.text);
  tracker.posts.push({
    id: p.id,
    url: p.url,
    ts: p.ts,
    text: p.text || '',
    images: [],
    metrics: {
      likes: parsedMetrics.likes ?? null,
      replies: parsedMetrics.replies ?? null,
      reposts: parsedMetrics.reposts ?? null,
      shares: parsedMetrics.shares ?? null,
      quotes: null,
      views: null,
    },
    comments: [],
    _scrape_path: 'list-my-posts',
  });
  seenIds.add(p.id);
  added += 1;
}

// Step 4: enrich newly added posts with full detail (comments + engagement) via fetch-post
let enriched = 0;
let enrichmentErrors = 0;
if (enrich && added > 0) {
  console.error(`[scrape] enriching ${added} new posts via fetch-post (this takes ~5s per post)...`);
  const newlyAdded = tracker.posts.filter((p) => p._scrape_path === 'list-my-posts' && p.comments.length === 0);
  for (const p of newlyAdded) {
    if (!p.url) continue;
    try {
      const detailRaw = sshExec(`node scripts/playwright-threads.mjs fetch-post --post-url '${p.url}'`);
      const detail = safeJson(detailRaw);
      if (detail?.post) {
        if (Array.isArray(detail.comments)) {
          p.comments = detail.comments.map((c) => ({
            author: c.author,
            text: c.text,
            ts: c.time || c.ts || null,
          }));
        }
        if (detail.post.engagement) {
          p.metrics = { ...p.metrics, ...detail.post.engagement };
        }
        if (detail.post.images) {
          p.images = detail.post.images.map((img) => ({ src: img.src, alt: img.alt }));
        }
        p._scrape_path = 'list-my-posts+enriched';
        enriched += 1;
      }
    } catch (e) {
      console.error(`[scrape] enrich fail for ${p.id}: ${e.message.slice(0, 100)}`);
      enrichmentErrors += 1;
    }
  }
  console.error(`[scrape] enriched ${enriched} posts (${enrichmentErrors} errors)`);
}

// Step 5: backfill from threads_scheduler.py published log if available (much richer history)
const SCHEDULER_PUBLISHED = '/Users/wei/Projects/symbiosis-agent/data/posts_published.json';
const SCHEDULER_POSTS_DIR = '/Users/wei/Projects/symbiosis-agent/data/posts';
let scheduler_backfill = 0;
if (existsSync(SCHEDULER_PUBLISHED)) {
  try {
    const published = JSON.parse(readFileSync(SCHEDULER_PUBLISHED, 'utf8'));
    for (const entry of published) {
      // Use file name as stable id when scrape hasn't seen the actual post yet
      const stableId = `scheduler:${entry.file}`;
      if (seenIds.has(stableId)) continue;
      // Read the draft text from posts/*.md
      const draftPath = `${SCHEDULER_POSTS_DIR}/${entry.file}`;
      let draftText = '';
      if (existsSync(draftPath)) {
        try {
          const raw = readFileSync(draftPath, 'utf8');
          // Extract Threads section if present, else strip markdown headers
          if (raw.includes('## Threads 版')) {
            const start = raw.indexOf('## Threads 版') + '## Threads 版'.length;
            const next = raw.indexOf('\n##', start);
            draftText = (next > -1 ? raw.slice(start, next) : raw.slice(start)).trim();
          } else {
            draftText = raw.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
          }
        } catch {}
      }
      if (!draftText) continue;
      tracker.posts.push({
        id: stableId,
        url: null, // scheduler doesn't capture post URL after publish
        ts: entry.date,
        text: draftText,
        images: [],
        metrics: {
          likes: null, replies: null, reposts: null, shares: null,
          quotes: null, views: null,
        },
        comments: [],
        _scrape_path: 'scheduler-backfill',
        _source_file: entry.file,
      });
      seenIds.add(stableId);
      scheduler_backfill += 1;
    }
    if (scheduler_backfill > 0) console.error(`[scrape] backfilled ${scheduler_backfill} posts from scheduler published log`);
  } catch (e) {
    console.error(`[scrape] scheduler backfill failed: ${e.message}`);
  }
}

tracker.posts.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

tracker.meta.scraped_at = new Date().toISOString();
tracker.meta.post_count = tracker.posts.length;
tracker.meta.comment_count = tracker.posts.reduce((sum, p) => sum + p.comments.length, 0);
tracker.meta.latest_post = tracker.posts[0]?.text?.slice(0, 50) || null;
tracker.meta.latest_post_ts = tracker.posts[0]?.ts || null;
tracker.meta.earliest_post_ts = tracker.posts[tracker.posts.length - 1]?.ts || null;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(tracker, null, 2));

const summary = {
  handle,
  out: outPath,
  visible_in_profile: list.posts.length,
  total_found: list.total_found,
  posts_added: added,
  posts_updated: updated,
  total_posts_in_tracker: tracker.posts.length,
  latest_post_ts: tracker.meta.latest_post_ts,
};
console.log(JSON.stringify(summary, null, 2));
