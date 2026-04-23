/**
 * Deterministic post-publish review for threads-coach / review.
 *
 * Compares predicted vs actual metrics, computes calibration deviation,
 * extracts lessons (which signals fired, which didn't, which caveats
 * proved correct).
 *
 * No LLM. Pure statistics + pattern. Caller can layer on LLM for
 * narrative + style_guide update suggestions.
 */

function deviationScore(actual, predicted) {
  if (actual == null || !predicted) return null;
  const range = predicted.p75 - predicted.p25;
  if (range === 0) return Math.abs(actual - predicted.p50);
  return Math.abs(actual - predicted.p50) / range;
}

function classifyDeviation(score) {
  if (score == null) return 'unknown';
  if (score < 0.5) return 'within_iqr';        // good prediction
  if (score < 1.5) return 'edge';              // slightly off
  return 'severe';                              // model needs recalibration
}

function landingTier(actual, predicted) {
  if (actual == null || !predicted) return 'unknown';
  if (actual < predicted.p25) return 'below_p25';
  if (actual < predicted.p50) return 'p25_p50';
  if (actual < predicted.p75) return 'p50_p75';
  return 'above_p75';
}

export function reviewPost({
  post_id,
  predicted,
  actual_metrics,
  caveats_at_predict_time = [],
  comments_count = null,
  meaningful_comments_ratio = null,
}) {
  if (!post_id || !actual_metrics) {
    return { ok: false, error: 'post_id and actual_metrics required' };
  }

  const comparisons = {};
  const main_signal_match = { evaluated: false };

  for (const sig of ['likes', 'replies', 'reposts', 'shares']) {
    const a = actual_metrics[sig];
    const p = predicted?.[sig];
    if (a == null || !p) continue;
    const dev = deviationScore(a, p);
    comparisons[sig] = {
      actual: a,
      predicted: p,
      deviation_score: dev != null ? Number(dev.toFixed(2)) : null,
      classification: classifyDeviation(dev),
      landing: landingTier(a, p),
    };
  }

  // Main signal evaluation: did the predicted main signal actually fire?
  if (predicted?.main_signal) {
    const sig = predicted.main_signal === 'sends' ? 'shares' : predicted.main_signal;
    const cmp = comparisons[sig];
    if (cmp) {
      main_signal_match.evaluated = true;
      main_signal_match.signal = predicted.main_signal;
      main_signal_match.fired = ['p50_p75', 'above_p75'].includes(cmp.landing);
      main_signal_match.classification = cmp.classification;
    }
  }

  // Caveat verification: did the warned caveats actually depress numbers?
  const caveat_verification = caveats_at_predict_time.map((caveat) => {
    let verdict = 'unverified';
    if (/diversity|連發|相近|同主題/.test(caveat) && comparisons.likes?.landing === 'below_p25') {
      verdict = 'confirmed';
    }
    return { caveat, verdict };
  });

  // Lessons — derive specific takeaways
  const lessons = [];
  for (const [sig, cmp] of Object.entries(comparisons)) {
    if (cmp.landing === 'above_p75') {
      lessons.push({
        signal: sig,
        type: 'positive',
        message: `${sig} 高於 p75 — 這個 hook / 結尾 pattern 在你帳號上特別有效，加進 style_guide`,
      });
    }
    if (cmp.landing === 'below_p25' && cmp.classification === 'severe') {
      lessons.push({
        signal: sig,
        type: 'negative',
        message: `${sig} 嚴重低於 IQR — 檢查是否觸發 R5 diversity 或受眾不匹配`,
      });
    }
  }

  // Comment quality lesson
  if (meaningful_comments_ratio != null) {
    if (meaningful_comments_ratio > 0.5) {
      lessons.push({
        signal: 'S2',
        type: 'positive',
        message: `5+ 詞留言比例 ${(meaningful_comments_ratio * 100).toFixed(0)}% — 留言區成為第二內容場成功`,
      });
    } else if (meaningful_comments_ratio < 0.2 && comments_count > 0) {
      lessons.push({
        signal: 'S2',
        type: 'negative',
        message: `5+ 詞留言比例只 ${(meaningful_comments_ratio * 100).toFixed(0)}% — 結尾問句太模糊，下次要更具體`,
      });
    }
  }

  // Calibration log entry — to be appended to predict.log later
  const calibration_entry = {
    post_id,
    actual: actual_metrics,
    predicted,
    main_signal_match: main_signal_match.fired ?? null,
    deviation_summary: Object.fromEntries(
      Object.entries(comparisons).map(([k, v]) => [k, v.deviation_score]),
    ),
    ts: new Date().toISOString(),
  };

  return {
    ok: true,
    sub_skill: 'review',
    post_id,
    comparisons,
    main_signal_match,
    caveat_verification,
    lessons,
    calibration_entry,
    summary: {
      total_signals_evaluated: Object.keys(comparisons).length,
      lessons_count: lessons.length,
      positive_lessons: lessons.filter((l) => l.type === 'positive').length,
      negative_lessons: lessons.filter((l) => l.type === 'negative').length,
      main_signal_fired: main_signal_match.fired ?? null,
    },
  };
}

export default { reviewPost };
