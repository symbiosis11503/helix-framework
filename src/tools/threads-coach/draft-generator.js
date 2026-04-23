/**
 * Deterministic draft scaffold generator for threads-coach / draft.
 *
 * Given a topic, target signal, and tracker, generates 3 draft scaffolds
 * (direct hook / story / framework). Each scaffold is structural — the
 * caller adds the actual content via LLM, but the structure (hook
 * pattern, ending pattern, length budget) is decided here.
 *
 * No LLM. Pure structural scaffolding. Returns 3 differentiated outlines
 * each with explicit voice constraints derived from voice analyzer.
 */

import { analyzeVoice } from './voice-analyzer.js';
import { scanRedLines } from './red-line-scanner.js';

const DEFAULT_BUDGETS = {
  hook_chars: { min: 15, max: 60 },
  body_chars: { min: 100, max: 200 },
  ending_chars: { min: 15, max: 50 },
  total_chars: { min: 130, max: 280 },
};

const HOOK_TEMPLATES = {
  contrarian: {
    pattern: '其實 / 大部分人 / 不是 X 是 Y',
    instruction: '第一句明確反駁一個常見假設。具體不空泛，不喊口號。',
    examples: ['其實大部分人搞錯了 X', '不是 X 太貴，是 Y 沒做好', '99% 的人以為 A 是因，但其實是 B'],
  },
  story: {
    pattern: '具體時間 + 地點 + 事件',
    instruction: '第一段給一個具體場景（昨天 / 上週 / 那次客戶問），然後從場景拉出觀察。',
    examples: ['上週客戶問我 X', '昨天踩到一個雷', '前幾天部署時發現 Y'],
  },
  framework: {
    pattern: '三點 / 分層 / 流程',
    instruction: '第一句點出共通問題，中段 list 出 3-5 點解法，結尾收一個底層原則。',
    examples: ['做 X 常踩三個雷', 'Y 流程拆三步', '處理 Z 的三個層次'],
  },
};

const ENDING_TEMPLATES = {
  open_question_specific: {
    pattern: '具體可回答的問句',
    instruction: '結尾問句要具體到「讀者腦中能立刻形成具體答案」。不要「你覺得呢？」這種模糊問句。',
    examples: ['你會把記憶分幾層？', '你的 hook 通常用哪種開頭？', '你怎麼處理 X 的 edge case？'],
  },
  declarative_principle: {
    pattern: '收一個底層原則或斷言',
    instruction: '結尾用一句「不要 / 一定要 / 重點是」結語，但不討讚不求互動。',
    examples: ['資料有缺口比有錯誤更危險', '系統可以掛但資料不能有洞', '架構的目的不是漂亮是好維護'],
  },
};

function pickAudienceWeighting(audience) {
  // B2B / niche default → emphasize replies + Trust Graph; KOL → emphasize sends
  if (audience === 'b2b' || audience === 'niche' || audience === 'technical') {
    return {
      sends_weight: 0.5,
      replies_weight: 1.5,
      trust_graph_weight: 1.5,
      preferred_endings: ['open_question_specific', 'declarative_principle'],
      forbidden_patterns: ['hashtag_stuffing', 'cta_bait', 'emoji_heavy'],
    };
  }
  return {
    sends_weight: 1.0,
    replies_weight: 1.0,
    trust_graph_weight: 1.0,
    preferred_endings: ['open_question_specific', 'declarative_principle'],
    forbidden_patterns: ['cta_bait'],
  };
}

export function generateDraftScaffolds({
  topic,
  angle,
  target_signal = 'replies',
  target_audience = 'b2b',
  tracker = null,
  voice_observations = null,
}) {
  if (!topic) throw new Error('topic required');

  const weighting = pickAudienceWeighting(target_audience);
  const voice = voice_observations || (tracker ? analyzeVoice(tracker) : null);

  const versions = [];

  // Version A: contrarian / direct hook — best for sends + replies
  versions.push({
    label: 'A — direct hook',
    hook_type: 'contrarian',
    hook: HOOK_TEMPLATES.contrarian,
    structure: [
      { section: 'hook', budget: DEFAULT_BUDGETS.hook_chars, instruction: HOOK_TEMPLATES.contrarian.instruction },
      { section: 'body', budget: { min: 80, max: 150 }, instruction: '1-2 個具體論證或案例支持反直覺的主張。要可驗證不要喊口號。' },
      { section: 'ending', budget: DEFAULT_BUDGETS.ending_chars, instruction: ENDING_TEMPLATES.open_question_specific.instruction },
    ],
    target_signal: target_signal === 'sends' ? 'sends' : 'replies',
    expected_signals: { S1: 'high', S2: 'mid-high', S3: 'mid' },
    risks: ['若反直覺斷言沒有真實證據，R3 hook-vs-body 會失敗'],
    audience_fit: target_audience === 'b2b' ? 'good' : 'good',
  });

  // Version B: story-led — best for trust + replies
  versions.push({
    label: 'B — story-led',
    hook_type: 'story',
    hook: HOOK_TEMPLATES.story,
    structure: [
      { section: 'hook', budget: DEFAULT_BUDGETS.hook_chars, instruction: HOOK_TEMPLATES.story.instruction },
      { section: 'body', budget: { min: 80, max: 150 }, instruction: '從場景拉出一個普遍化的觀察。情境 → 觀察 → 普遍化結論。' },
      { section: 'ending', budget: DEFAULT_BUDGETS.ending_chars, instruction: ENDING_TEMPLATES.open_question_specific.instruction },
    ],
    target_signal: 'replies',
    expected_signals: { S1: 'mid', S2: 'high', S3: 'mid-high', S8: 'high' },
    risks: ['故事過長會把停留時間拖到負影響'],
    audience_fit: target_audience === 'b2b' ? 'great' : 'good',
  });

  // Version C: framework / list — best for sends + time_spent
  versions.push({
    label: 'C — framework / list',
    hook_type: 'framework',
    hook: HOOK_TEMPLATES.framework,
    structure: [
      { section: 'hook', budget: DEFAULT_BUDGETS.hook_chars, instruction: HOOK_TEMPLATES.framework.instruction },
      { section: 'body', budget: { min: 100, max: 180 }, instruction: '3-5 點 list，每點 2-3 句。每點要互不重複，避免換句話說。' },
      { section: 'ending', budget: DEFAULT_BUDGETS.ending_chars, instruction: ENDING_TEMPLATES.declarative_principle.instruction + ' 或 ' + ENDING_TEMPLATES.open_question_specific.instruction },
    ],
    target_signal: 'sends',
    expected_signals: { S1: 'high', S2: 'mid', S3: 'high', S6: '建議加架構圖' },
    risks: ['列點過多會稀釋每點的訊息密度'],
    audience_fit: 'great',
  });

  // Voice constraints — derived from brand_voice if available
  const voice_constraints = {
    forbidden_phrases: voice?.ok ? voice.forbidden_phrases_used.map((f) => f.rule) : [],
    avoid_exclamation_above: 1,
    preferred_perspective: voice?.summary?.perspective || 'unknown',
    dominant_existing_hook: voice?.summary?.dominant_hook || 'unknown',
    note: voice?.ok
      ? '保持你既有的口吻特徵；任何 forbidden phrases 出現會在後續 analyze 階段被打回。'
      : '沒有 voice fingerprint，建議先跑 voice() 建立 brand_voice.md。',
  };

  // Audience-specific guardrails
  const audience_guardrails = {
    audience: target_audience,
    weighting,
    must_avoid: [...weighting.forbidden_patterns, 'engagement_bait_R1', 'clickbait_R2'],
    must_include: [
      'concrete number / case / personal experience',
      target_signal === 'replies' ? 'specific question that invites case-sharing' : null,
      target_signal === 'sends' ? 'one quotable framework or counterintuitive line' : null,
    ].filter(Boolean),
  };

  return {
    ok: true,
    sub_skill: 'draft',
    topic,
    angle,
    target_signal,
    target_audience,
    versions,
    voice_constraints,
    audience_guardrails,
    note: 'Use these scaffolds to write the actual content. Each version is structurally differentiated — fill in body text per the section budgets and constraints. Run threads.coach.analyze on the finished draft before posting.',
  };
}

export default { generateDraftScaffolds };
