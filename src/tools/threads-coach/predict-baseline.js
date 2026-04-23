/**
 * Deterministic 24h prediction baseline for threads-coach / predict.
 *
 * Given a candidate post text + tracker, find N comparable historical
 * posts (same hook type, similar topic neighborhood) and compute
 * p25/p50/p75 for likes/replies/reposts/shares.
 *
 * No LLM. Pure pattern + statistics. Caller can layer on LLM for
 * narrative around the numbers (caveats, trend hints).
 */

import { analyzeVoice } from './voice-analyzer.js';

function postCharSet(text) {
  return new Set(text ? [...text] : []);
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const x of setA) if (setB.has(x)) intersect += 1;
  return intersect / (setA.size + setB.size - intersect);
}

function classifyHook(text) {
  const firstLine = (text || '').split(/\n/)[0];
  if (/^(?:[^。！？\n]{2,}的(?:心得|筆記|教訓|結論|思考)|今天\s*[\:：]|[\d]+\s*種.*?方法)/.test(firstLine)) return 'title_label';
  if (/(?:其實|你以為|大家都|大部分人|99\s*%|不是.*?是)/.test(firstLine)) return 'contrarian';
  if (/^[0-9０-９]+\s*[、.,]/.test(firstLine)) return 'numeric_open';
  if (/^(?:今天|昨天|前幾天|上週|那天|有一次|去年)/.test(firstLine)) return 'story_open';
  if (/^[^。\n]{2,}(?:嗎\?|嗎？|呢\?|呢？)/.test(firstLine)) return 'question_open';
  return 'other';
}

function quantile(arr, q) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function summarize(values) {
  const filtered = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!filtered.length) return null;
  return {
    p25: quantile(filtered, 0.25),
    p50: quantile(filtered, 0.5),
    p75: quantile(filtered, 0.75),
    max: Math.max(...filtered),
    n: filtered.length,
  };
}

export function predictPost(post_text, tracker, opts = {}) {
  if (!post_text) throw new Error('post_text required');
  if (!tracker?.posts) {
    return { ok: false, error: 'tracker required for prediction' };
  }

  const minSim = opts.min_similarity || 0.25;
  const candidateHook = classifyHook(post_text);
  const candidateSet = postCharSet(post_text);

  const compared = tracker.posts
    .filter((p) => p.text && p.metrics?.likes != null)
    .map((p) => ({
      post: p,
      hook: classifyHook(p.text),
      similarity: jaccard(candidateSet, postCharSet(p.text)),
    }))
    .filter((x) => x.similarity >= minSim || x.hook === candidateHook);

  const matchedSameHook = compared.filter((x) => x.hook === candidateHook);
  const matchedSameTopic = compared.filter((x) => x.similarity >= minSim);

  const sample = matchedSameHook.length >= 3 ? matchedSameHook : compared;
  const N = sample.length;

  let confidence = 'low';
  if (N >= 10) confidence = 'high';
  else if (N >= 5) confidence = 'medium';

  if (N === 0) {
    return {
      ok: false,
      sub_skill: 'predict',
      candidate_hook: candidateHook,
      error: 'no comparable posts in tracker — confidence too low',
      tracker_size: tracker.posts.length,
    };
  }

  const predicted = {
    likes: summarize(sample.map((x) => x.post.metrics.likes)),
    replies: summarize(sample.map((x) => x.post.metrics.replies)),
    reposts: summarize(sample.map((x) => x.post.metrics.reposts)),
    shares: summarize(sample.map((x) => x.post.metrics.shares)),
  };

  // Determine main signal — which one in the candidate's design is most likely to fire
  let main_signal = 'replies';
  if (/(?:不是|其實|大部分人|99\s*%)/.test(post_text)) main_signal = 'sends';
  if (/[?？]\s*$/.test(post_text)) main_signal = 'replies';
  if (post_text.length > 250) main_signal = 'time_spent';

  // Caveats based on tracker state
  const caveats = [];
  const last7 = tracker.posts.filter((p) => {
    if (!p.ts) return false;
    return Date.now() - new Date(p.ts).getTime() < 7 * 24 * 3600 * 1000;
  });
  const sameTopicLast7 = last7.filter((p) => jaccard(candidateSet, postCharSet(p.text)) > 0.5);
  if (sameTopicLast7.length >= 2) {
    caveats.push(`近 7 天已發 ${sameTopicLast7.length} 篇同主題鄰域，diversity 風險，p50 預估下修 30%`);
  }

  return {
    ok: true,
    sub_skill: 'predict',
    candidate_hook: candidateHook,
    candidate_text_chars: post_text.length,
    sample_size: N,
    sample_breakdown: {
      same_hook: matchedSameHook.length,
      same_topic_neighborhood: matchedSameTopic.length,
    },
    confidence,
    predicted,
    main_signal,
    caveats,
  };
}

export default { predictPost };
