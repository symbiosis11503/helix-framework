/**
 * Deterministic topic candidate miner for threads-coach / topics.
 *
 * Reads tracker.json, returns:
 *   - unmet_demand_topics: questions in comments the author hasn't answered in posts
 *   - extension_topics: high-engagement post angles that haven't been re-explored
 *   - freshness_passing: candidates that pass topic-fatigue filter
 *
 * No LLM. Pure pattern + counting + similarity. Caller can layer on LLM
 * for natural-language phrasing of the candidates.
 */

const QUESTION_RE = /[?？]/;
const QUESTION_TRIGGERS = [
  /怎麼[做做用辦處理算判斷]/,
  /如何/,
  /想了解/,
  /可以細節/,
  /有沒有.*?教學/,
  /想問/,
  /可以分享/,
  /怎樣/,
  /為什麼/,
  /(?:能否|可否)/,
];

function isQuestion(text) {
  if (!text) return false;
  if (QUESTION_RE.test(text)) return true;
  return QUESTION_TRIGGERS.some((re) => re.test(text));
}

function extractKeywords(text, max = 6) {
  if (!text) return [];
  // Strip punctuation, take 2-4 char Chinese chunks (rough but works for Threads)
  const cleaned = text.replace(/[，。！？!?,.;；:：()（）「」『』""''《》【】\s]+/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && t.length <= 8);
  return tokens.slice(0, max);
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const x of setA) if (setB.has(x)) intersect += 1;
  return intersect / (setA.size + setB.size - intersect);
}

function postCharSet(text) {
  return new Set(text ? [...text] : []);
}

export function mineUnmetDemand(tracker, opts = {}) {
  if (!tracker?.posts) return [];
  const minSim = opts.coverage_threshold || 0.25;
  const out = [];

  for (const p of tracker.posts) {
    if (!Array.isArray(p.comments)) continue;
    for (const c of p.comments) {
      if (!c?.text || !isQuestion(c.text)) continue;
      // Has the author answered this in a subsequent post?
      const cSet = postCharSet(c.text);
      let coveredBy = null;
      for (const other of tracker.posts) {
        if (other.id === p.id) continue;
        if (other.ts && c.ts && other.ts < c.ts) continue;
        const sim = jaccard(cSet, postCharSet(other.text || ''));
        if (sim >= minSim) {
          coveredBy = { post_id: other.id, similarity: Number(sim.toFixed(3)) };
          break;
        }
      }
      if (!coveredBy) {
        out.push({
          source_post_id: p.id,
          source_post_url: p.url,
          asker: c.author,
          asked_at: c.ts,
          question: c.text.slice(0, 200),
          keywords: extractKeywords(c.text),
          status: 'unanswered',
        });
      }
    }
  }
  return out;
}

export function mineExtensionTopics(tracker, opts = {}) {
  if (!tracker?.posts) return [];
  const top = opts.top_percent || 0.3;
  const postsWithMetrics = tracker.posts.filter((p) => p.metrics?.likes != null);
  if (postsWithMetrics.length < 3) return [];

  const scored = postsWithMetrics
    .map((p) => ({
      post: p,
      score: (p.metrics.replies || 0) * 30 + (p.metrics.shares || 0) * 5 + (p.metrics.likes || 0),
    }))
    .sort((a, b) => b.score - a.score);

  const cutoff = Math.max(1, Math.floor(scored.length * top));
  const topPosts = scored.slice(0, cutoff);

  const candidates = [];
  for (const { post, score } of topPosts) {
    const keywords = extractKeywords(post.text, 4);
    candidates.push({
      seed_post_id: post.id,
      seed_score: score,
      seed_metrics: post.metrics,
      keywords,
      angle: 'extension',
      hint: '同主題鄰域延伸切角：可寫個人經驗版、反例版、深入細節版',
    });
  }
  return candidates;
}

export function applyFreshnessFilter(candidates, tracker, opts = {}) {
  if (!tracker?.posts) return candidates;
  const days = opts.recency_days || 14;
  const now = Date.now();
  const cutoffTs = now - days * 24 * 3600 * 1000;

  const recentPostSets = tracker.posts
    .filter((p) => p.ts && new Date(p.ts).getTime() > cutoffTs)
    .map((p) => ({ id: p.id, set: postCharSet(p.text || '') }));

  return candidates.map((c) => {
    const candidateText = c.question || c.keywords?.join('') || '';
    const cSet = postCharSet(candidateText);
    let maxSim = 0;
    let nearest = null;
    for (const r of recentPostSets) {
      const sim = jaccard(cSet, r.set);
      if (sim > maxSim) {
        maxSim = sim;
        nearest = r.id;
      }
    }
    const freshness_score = Math.max(0, Math.round((1 - maxSim) * 100));
    const fatigue_risk =
      maxSim > 0.7 ? 'High' :
      maxSim > 0.4 ? 'Medium' :
      'Low';
    return {
      ...c,
      freshness_score,
      max_similarity_to_recent: Number(maxSim.toFixed(3)),
      nearest_recent_post: nearest,
      fatigue_risk,
    };
  });
}

export function mineTopics(tracker, opts = {}) {
  const unmet = mineUnmetDemand(tracker, opts);
  const extension = mineExtensionTopics(tracker, opts);
  const all = [
    ...unmet.map((c) => ({ ...c, angle: 'unmet_demand' })),
    ...extension,
  ];
  const filtered = applyFreshnessFilter(all, tracker, opts);

  // Sort: unmet_demand_high_freshness > extension_high_freshness > anything-else
  filtered.sort((a, b) => {
    const aPrio = (a.angle === 'unmet_demand' ? 1000 : 0) + (a.freshness_score || 0);
    const bPrio = (b.angle === 'unmet_demand' ? 1000 : 0) + (b.freshness_score || 0);
    return bPrio - aPrio;
  });

  const limit = opts.limit || 5;
  return {
    unmet_count: unmet.length,
    extension_count: extension.length,
    candidates: filtered.slice(0, limit),
    total_filtered: filtered.length,
  };
}

export default { mineUnmetDemand, mineExtensionTopics, applyFreshnessFilter, mineTopics };
