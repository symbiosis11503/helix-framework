/**
 * Deterministic red-line scanner for threads-coach / analyze.
 *
 * Scans a post text against R1-R12 from knowledge/algorithm-base.md.
 * Pattern-matched, no LLM required. Returns hits + warnings + clean.
 *
 * Caller still wants LLM for signal evaluation (S1-S14) — this only
 * handles the deterministic part (the red lines are mostly phrase / regex matches).
 *
 * Coverage:
 *   R1 Engagement Bait        — phrase match (5 sub-types)
 *   R2 Clickbait              — phrase match + exclamation count
 *   R3 hook-vs-body mismatch  — needs LLM (returns hint only)
 *   R4 originality / repost   — needs tracker comparison (handled in analyze())
 *   R5 consecutive same topic — needs tracker comparison (handled in analyze())
 *   R6 low-quality link       — URL extract + heuristic
 *   R7 sensitive topic        — keyword match
 *   R10 AI content disclosure — heuristic (no certainty)
 *   R11 image-text mismatch   — needs multi-modal (returns hint only)
 *   R12 soft demotion         — multi-signal heuristic
 */

const ENGAGEMENT_BAIT_PATTERNS = {
  vote_bait: [
    /按愛心.*選/,
    /按.*?選[A-Za-z甲乙丙\d]/,
    /react.*if/i,
    /vote.*by.*react/i,
  ],
  react_bait: [
    /按.*愛心.*如果/,
    /按.*讚.*如果/,
    /覺得.*?有用.*?按/,
    /同意.*?按/,
    /按.*?以示/,
    /like.*if.*you/i,
  ],
  share_bait: [
    /分享給.*?朋友/,
    /轉發到.*?限動/,
    /轉發.*?給.*?需要/,
    /share.*if.*you/i,
    /tag.*friend.*who.*needs/i,
  ],
  tag_bait: [
    /tag.*?(?:一個|個).*?(?:朋友|人|你的)/i,
    /tag.*?(?:somebody|someone).*?who/i,
    /(?:標註|@).*?(?:一個|個).*?(?:會用|需要)/,
  ],
  comment_bait: [
    /留言.*?(?:YES|是|\+1|好)/i,
    /留言.*?告訴我/,
    /留言.*?分享/,
    /\+1\s*留言/,
    /comment.*?(?:yes|below|if you).*?(?:agree|want)/i,
  ],
};

const CLICKBAIT_PATTERNS = [
  /你絕對不會相信/,
  /99\s*%.*?(?:都不知道|不知道)/,
  /這是.*?最.*?的(?:秘密|真相)/,
  /看完.*?(?:你會|哭|震驚|傻眼)/,
  /you (?:won't|will not) believe/i,
  /shocked.*?when.*?you (?:see|read)/i,
  /99\s*%.*?(?:don't|do not) know/i,
];

const SENSITIVE_TOPIC_KEYWORDS = {
  political: ['選舉', '總統', '立委', '政黨', '民進黨', '國民黨', '民眾黨', '政治', '統獨'],
  health_claim: ['治療', '療效', '保證痊癒', '無副作用', '神奇療法', '醫生不告訴你'],
  financial_claim: ['保證獲利', '穩賺', '無風險', '一定漲', '財務自由', '被動收入翻倍'],
  edge: ['情色', '血腥', '暴力'],
};

const URL_RE = /https?:\/\/[^\s)）]+/g;
const SUSPECT_TLDS = ['.tk', '.ml', '.ga', '.cf', '.click', '.gq'];

function scanEngagementBait(text) {
  const hits = [];
  for (const [subType, patterns] of Object.entries(ENGAGEMENT_BAIT_PATTERNS)) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        hits.push({ sub_type: subType, match: m[0] });
        break;
      }
    }
  }
  return hits;
}

function scanClickbait(text) {
  const phraseHits = CLICKBAIT_PATTERNS.filter((re) => re.test(text)).map((re) => re.toString());
  const exclamationCount = (text.match(/[!！]/g) || []).length;
  const charCount = [...text].length;
  const exclamationDensity = charCount > 0 ? exclamationCount / charCount : 0;
  return {
    phrase_hits: phraseHits,
    exclamation_count: exclamationCount,
    exclamation_density: exclamationDensity,
    excessive_exclamation: exclamationCount >= 4 || exclamationDensity > 0.03,
  };
}

function scanLinks(text) {
  const urls = text.match(URL_RE) || [];
  const findings = urls.map((url) => {
    const tld = url.match(/\.[a-z]{2,}(?:\/|$)/i)?.[0]?.replace(/\/$/, '');
    const suspectTld = tld && SUSPECT_TLDS.includes(tld.toLowerCase());
    return { url, tld: tld || null, suspect_tld: !!suspectTld };
  });
  return {
    url_count: urls.length,
    findings,
    has_suspect_tld: findings.some((f) => f.suspect_tld),
  };
}

function scanSensitiveTopics(text) {
  const hits = {};
  for (const [topic, keywords] of Object.entries(SENSITIVE_TOPIC_KEYWORDS)) {
    const matched = keywords.filter((kw) => text.includes(kw));
    if (matched.length) hits[topic] = matched;
  }
  return hits;
}

function scanAIDisclosure(text, opts = {}) {
  if (opts.is_ai_generated_image === true) {
    const hasDisclosure = /(?:AI 生成|AI-generated|生成式 AI|by AI|GPT|DALL-E|Midjourney|Stable Diffusion)/i.test(text);
    return { is_ai_image: true, has_disclosure: hasDisclosure };
  }
  return { is_ai_image: null, has_disclosure: null };
}

function detectSoftDemotion(text) {
  const flags = [];
  const sentences = text.split(/[。！!？?\n]+/).filter(Boolean);
  if (sentences.length === 0) return { count: 0, flags };

  const wordCounts = sentences.map((s) => s.length);
  const avgLen = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  if (avgLen > 80) flags.push('long_sentences');
  if (sentences.length > 5) {
    const first = sentences.slice(0, Math.ceil(sentences.length / 2)).join('');
    const second = sentences.slice(Math.ceil(sentences.length / 2)).join('');
    const overlap = [...new Set([...first].filter((c) => second.includes(c)))].length;
    if (first.length > 0 && overlap / first.length > 0.7) flags.push('repetitive_content');
  }
  if (/(?:總之|簡單來說|換句話說).*?(?:總之|簡單來說|換句話說)/.test(text)) flags.push('redundant_summarizers');
  return { count: flags.length, flags };
}

export function scanRedLines(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('text required');
  }

  const r1 = scanEngagementBait(text);
  const r2 = scanClickbait(text);
  const r6 = scanLinks(text);
  const r7 = scanSensitiveTopics(text);
  const r10 = scanAIDisclosure(text, opts);
  const r12 = detectSoftDemotion(text);

  const hits = [];
  const warnings = [];
  const hints = [];

  if (r1.length > 0) {
    hits.push({ rule: 'R1', label: 'Engagement Bait', detail: r1 });
  }
  if (r2.phrase_hits.length > 0) {
    hits.push({ rule: 'R2', label: 'Clickbait phrase', detail: r2.phrase_hits });
  }
  if (r2.excessive_exclamation) {
    warnings.push({
      rule: 'R2',
      label: 'Excessive exclamation',
      detail: { count: r2.exclamation_count, density: r2.exclamation_density.toFixed(4) },
    });
  }
  if (r6.url_count > 0) {
    if (r6.has_suspect_tld) {
      warnings.push({ rule: 'R6', label: 'Suspect link TLD', detail: r6.findings.filter((f) => f.suspect_tld) });
    } else {
      hints.push({ rule: 'R6', label: 'Has external link — confirm domain reputation', detail: { url_count: r6.url_count } });
    }
  }
  if (Object.keys(r7).length > 0) {
    warnings.push({ rule: 'R7', label: 'Sensitive topic detected — check tone', detail: r7 });
  }
  if (r10.is_ai_image === true && r10.has_disclosure === false) {
    warnings.push({ rule: 'R10', label: 'AI image without disclosure', detail: {} });
  }
  if (r12.count >= 2) {
    warnings.push({ rule: 'R12', label: 'Multiple soft-demotion flags', detail: r12.flags });
  }

  hints.push({
    rule: 'R3',
    label: 'Hook-vs-body consistency requires LLM',
    detail: 'Compare first sentence promise against body content',
  });
  hints.push({
    rule: 'R11',
    label: 'Image-text consistency requires multi-modal',
    detail: 'If post has images, verify they support the text claim',
  });

  return {
    text_chars: [...text].length,
    hits,
    warnings,
    hints,
    summary: {
      hits_count: hits.length,
      warnings_count: warnings.length,
      verdict: hits.length === 0 ? (warnings.length === 0 ? 'clean' : 'warn') : 'block',
    },
  };
}

export function scanTrackerComparisons(text, tracker, opts = {}) {
  if (!tracker || !Array.isArray(tracker.posts)) {
    return {
      r4_originality: { available: false, reason: 'no tracker' },
      r5_consecutive_topic: { available: false, reason: 'no tracker' },
    };
  }

  const recent = tracker.posts.slice(-Math.max(5, opts.recent_n || 5));

  const charSet = new Set([...text]);
  const r4Scores = recent.map((p) => {
    if (!p.text) return { fingerprint: null, similarity: 0 };
    const otherSet = new Set([...p.text]);
    const intersection = [...charSet].filter((c) => otherSet.has(c)).length;
    const union = new Set([...charSet, ...otherSet]).size;
    const similarity = union > 0 ? intersection / union : 0;
    return { fingerprint: p.text.slice(0, 40), similarity: Number(similarity.toFixed(3)) };
  });
  const r4MaxSim = r4Scores.reduce((m, s) => Math.max(m, s.similarity), 0);

  const r5Recent3 = recent.slice(-3);
  const r5Scores = r5Recent3.map((p) => {
    if (!p.text) return { fingerprint: null, similarity: 0 };
    const otherSet = new Set([...p.text]);
    const intersection = [...charSet].filter((c) => otherSet.has(c)).length;
    const union = new Set([...charSet, ...otherSet]).size;
    return { fingerprint: p.text.slice(0, 40), similarity: union > 0 ? Number((intersection / union).toFixed(3)) : 0 };
  });
  const r5HighSimCount = r5Scores.filter((s) => s.similarity > 0.6).length;

  return {
    r4_originality: {
      available: true,
      max_similarity: r4MaxSim,
      verdict: r4MaxSim > 0.7 ? 'warn' : r4MaxSim > 0.5 ? 'edge' : 'clean',
      compared_against: r4Scores.length,
      detail: r4Scores,
    },
    r5_consecutive_topic: {
      available: true,
      high_sim_in_recent_3: r5HighSimCount,
      verdict: r5HighSimCount >= 2 ? 'warn' : 'clean',
      detail: r5Scores,
    },
  };
}

export default { scanRedLines, scanTrackerComparisons };
