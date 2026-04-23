/**
 * Deterministic brand_voice fingerprint analyzer.
 *
 * Reads a tracker.json structure, returns statistical summary of the account's voice:
 *  - hook type distribution
 *  - ending pattern distribution
 *  - high-frequency phrases (with engagement-weighted ranking)
 *  - forbidden phrases (engagement-bait / clickbait actually used)
 *  - tone metrics
 *
 * No LLM required. Pure pattern + counting. The voice sub-skill caller can
 * layer on qualitative reasoning afterward.
 */

import { scanRedLines } from './red-line-scanner.js';

const HOOK_PATTERNS = {
  title_label: /^(?:[^。！？\n]{2,}的(?:心得|筆記|教訓|結論|思考)|今天\s*[\:：]|[\d]+\s*種.*?方法)/,
  contrarian: /(?:其實|你以為|大家都|大部分人|99\s*%|不是.*?是)/,
  numeric_open: /^[0-9０-９]+\s*[、.,]/,
  story_open: /^(?:今天|昨天|前幾天|上週|那天|有一次|去年)/,
  question_open: /^[^。\n]{2,}(?:嗎\?|嗎？|呢\?|呢？)/,
};

const ENDING_PATTERNS = {
  list_close: /(?:1\..*?2\.|→.*?→|•.*?•)\s*$/m,
  open_question: /(?:你會怎麼|你怎麼處理|你看過|你的[^?]+\?)\s*$/m,
  declarative: /(?:就是這樣|就這樣|就好|是必要的|很重要)[\s。]*$/,
  cta_bait: /(?:留言告訴|按愛心|tag.*?朋友|分享給)/i,
};

const TONE_KEYWORDS = {
  serious: ['實作', '架構', '系統', '邊界', '原則', '本質'],
  casual: ['搞', '弄', '跑', '走', '哈', '欸'],
  imperative: ['你應該', '你必須', '不要', '別', '要記得'],
  personal: ['我發現', '我自己', '我做', '我覺得', '我認為'],
  community: ['我們', '大家', '同行'],
};

// Strip Threads scrape header noise: "<username><relTime>更多" repeated multiple times
// before actual post body. Also strip trailing engagement text "讚N回覆N轉發N分享N".
function cleanScrapeText(text) {
  if (!text) return '';
  let cleaned = text;
  // Remove username header pattern (handle + relative time + 更多). Also strip standalone handle.
  cleaned = cleaned.replace(/[a-zA-Z0-9_.]+\s*\d+\s*(?:小時|分鐘|天|週|月|年)\s*(?:更多)?/g, ' ');
  // Strip standalone usernames that look like Threads handles (alphanumeric + digits, length 5-30)
  cleaned = cleaned.replace(/\b[a-z][a-z0-9_.]{4,29}\b(?=\s|$)/gi, (match) => {
    // Keep camelCase / words with caps in middle (likely real terms like "GitHub", "Terraform")
    if (/[A-Z]/.test(match.slice(1))) return match;
    // Keep mostly-letter terms (likely English words)
    const digits = (match.match(/\d/g) || []).length;
    if (digits === 0) return match;
    return ' ';
  });
  // Remove engagement text suffix
  cleaned = cleaned.replace(/讚\d*回覆\d*轉發\d*分享\d*/g, ' ');
  cleaned = cleaned.replace(/讚\s*\d*\s*回覆\s*\d*\s*轉發\s*\d*\s*分享\s*\d*/g, ' ');
  // Remove leading "更多" alone
  cleaned = cleaned.replace(/(?:^|\s)更多(?=\s|$)/g, ' ');
  // Collapse repeats of the same paragraph (Threads scrape often duplicates the body 2-3x)
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const l of lines) {
    if (l.length < 5) continue;
    if (seen.has(l)) continue;
    seen.add(l);
    unique.push(l);
  }
  return unique.join('\n').replace(/\s+/g, ' ').trim();
}

function tokenizeShortPhrases(text, minLen = 3, maxLen = 6) {
  // Stricter: only count phrases that aren't pure n-gram explosion of a single word.
  // We split on ALL whitespace + punctuation first, then only count whole resulting tokens.
  const phrases = new Map();
  const tokens = text
    .split(/[\s、，。！？!?,.;；:：()（）「」『』""''《》【】「」/\\\-—_=+*&^%$#@!~`|<>]+/)
    .filter((t) => t && t.length >= minLen && t.length <= maxLen * 4);
  for (const t of tokens) {
    // Skip pure ASCII identifiers (file extensions, URLs, etc.) — keep meaningful words
    if (/^[a-zA-Z]+$/.test(t) && t.length < 4) continue;
    if (/^\d+$/.test(t)) continue;
    phrases.set(t, (phrases.get(t) || 0) + 1);
  }
  return phrases;
}

function classifyHook(text) {
  const firstLine = text.split(/\n/)[0] || '';
  const matches = [];
  for (const [name, re] of Object.entries(HOOK_PATTERNS)) {
    if (re.test(firstLine)) matches.push(name);
  }
  return matches.length > 0 ? matches : ['other'];
}

function classifyEnding(text) {
  const tail = text.slice(-200);
  const matches = [];
  for (const [name, re] of Object.entries(ENDING_PATTERNS)) {
    if (re.test(tail)) matches.push(name);
  }
  return matches.length > 0 ? matches : ['other'];
}

function countToneKeywords(text) {
  const counts = {};
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS)) {
    counts[tone] = keywords.reduce((sum, kw) => sum + (text.match(new RegExp(kw, 'g')) || []).length, 0);
  }
  return counts;
}

export function analyzeVoice(tracker, opts = {}) {
  if (!tracker || !Array.isArray(tracker.posts)) {
    throw new Error('tracker.posts required');
  }
  // 20-char threshold: filters out single-word fragments but keeps real Threads posts
  const posts = tracker.posts.filter((p) => p.text && p.text.length >= 20);
  if (posts.length < 5) {
    return {
      ok: false,
      error: `voice analysis needs >= 5 posts with text, got ${posts.length}`,
      posts_available: posts.length,
    };
  }

  const hookCounts = {};
  const endingCounts = {};
  const toneTotals = { serious: 0, casual: 0, imperative: 0, personal: 0, community: 0 };
  const forbiddenHits = [];
  const allPhrases = new Map();
  const wordCountByPost = [];
  const exclamationByPost = [];

  for (const p of posts) {
    const cleanText = cleanScrapeText(p.text);
    if (cleanText.length < 20) continue;

    const hooks = classifyHook(cleanText);
    for (const h of hooks) hookCounts[h] = (hookCounts[h] || 0) + 1;

    const endings = classifyEnding(cleanText);
    for (const e of endings) endingCounts[e] = (endingCounts[e] || 0) + 1;

    const tone = countToneKeywords(cleanText);
    for (const [k, v] of Object.entries(tone)) toneTotals[k] += v;

    const scan = scanRedLines(cleanText);
    for (const hit of scan.hits) {
      forbiddenHits.push({ post_id: p.id, rule: hit.rule, sample: cleanText.slice(0, 60) });
    }

    const phrases = tokenizeShortPhrases(cleanText);
    for (const [phrase, count] of phrases.entries()) {
      allPhrases.set(phrase, (allPhrases.get(phrase) || 0) + count);
    }

    wordCountByPost.push([...cleanText].length);
    exclamationByPost.push((cleanText.match(/[!！]/g) || []).length);
  }

  // Top phrases (frequency >= 2 across multiple posts)
  const topPhrases = [...allPhrases.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.floor(posts.length * 0.2)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));

  const avgChars = Math.round(wordCountByPost.reduce((a, b) => a + b, 0) / wordCountByPost.length);
  const avgExclamation = (exclamationByPost.reduce((a, b) => a + b, 0) / wordCountByPost.length).toFixed(2);

  // Engagement-weighted tone (if metrics available)
  const postsWithMetrics = posts.filter((p) => p.metrics?.likes != null);
  const topPerformers = postsWithMetrics
    .map((p) => ({
      id: p.id,
      score: (p.metrics.replies || 0) * 30 + (p.metrics.shares || 0) * 5 + (p.metrics.likes || 0),
      hook_types: classifyHook(p.text),
      ending_types: classifyEnding(p.text),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    ok: true,
    posts_analyzed: posts.length,
    posts_with_metrics: postsWithMetrics.length,
    hook_distribution: hookCounts,
    ending_distribution: endingCounts,
    tone_totals: toneTotals,
    avg_chars_per_post: avgChars,
    avg_exclamation_per_post: parseFloat(avgExclamation),
    top_phrases: topPhrases,
    forbidden_phrases_used: forbiddenHits,
    top_performers: topPerformers,
    summary: {
      dominant_hook: Object.entries(hookCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      dominant_ending: Object.entries(endingCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      tone_lean:
        toneTotals.serious > toneTotals.casual ? 'serious' :
        toneTotals.casual > toneTotals.serious ? 'casual' : 'balanced',
      perspective:
        toneTotals.community > toneTotals.personal ? 'we-voice (team)' :
        toneTotals.personal > toneTotals.community ? 'I-voice (personal)' : 'mixed',
    },
  };
}

export function renderVoiceMarkdown(analysis, handle) {
  if (!analysis.ok) return `# Voice — ${handle}\n\nNot enough data: ${analysis.error}\n`;
  const lines = [
    `# Brand Voice — ${handle}`,
    '',
    `> Auto-generated from ${analysis.posts_analyzed} posts (${analysis.posts_with_metrics} with engagement metrics).`,
    '',
    '## Summary',
    `- Dominant hook: **${analysis.summary.dominant_hook}**`,
    `- Dominant ending: **${analysis.summary.dominant_ending}**`,
    `- Tone lean: **${analysis.summary.tone_lean}**`,
    `- Perspective: **${analysis.summary.perspective}**`,
    `- Avg chars per post: ${analysis.avg_chars_per_post}`,
    `- Avg exclamation per post: ${analysis.avg_exclamation_per_post} (red line if > 1.5)`,
    '',
    '## Hook Distribution',
    ...Object.entries(analysis.hook_distribution).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Ending Distribution',
    ...Object.entries(analysis.ending_distribution).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Tone Keywords (raw counts)',
    ...Object.entries(analysis.tone_totals).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Top Phrases (≥ 20% of posts)',
    ...analysis.top_phrases.map(({ phrase, count }) => `- "${phrase}" × ${count}`),
    '',
  ];
  if (analysis.forbidden_phrases_used.length > 0) {
    lines.push('## ⚠️ Forbidden phrases historically used');
    for (const f of analysis.forbidden_phrases_used) {
      lines.push(`- ${f.rule} in ${f.post_id}: "${f.sample}..."`);
    }
    lines.push('');
  }
  if (analysis.top_performers.length > 0) {
    lines.push('## Top Performers (engagement-weighted)');
    for (const tp of analysis.top_performers) {
      lines.push(`- ${tp.id} score=${tp.score} hooks=[${tp.hook_types.join(',')}] endings=[${tp.ending_types.join(',')}]`);
    }
    lines.push('');
  }
  lines.push('## Manual Refinements (user-edited)');
  lines.push('');
  lines.push('<!-- Auto-regen will preserve this section -->');
  lines.push('');
  return lines.join('\n');
}

export default { analyzeVoice, renderVoiceMarkdown };
