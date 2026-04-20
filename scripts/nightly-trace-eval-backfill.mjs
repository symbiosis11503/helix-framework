#!/usr/bin/env node
/**
 * Nightly trace eval backfill — B 版 (helix-framework)
 *
 * Re-score completed trace runs that have no eval_score (or older eval_version),
 * persist the summary back onto trace_runs.
 *
 * Per spec docs/reports/14_trace_eval_persistence_nightly_spec.md (Hermes A 版 reference impl).
 *
 * Usage:
 *   node scripts/nightly-trace-eval-backfill.mjs
 *   node scripts/nightly-trace-eval-backfill.mjs --limit 50 --version eval-lite@2026-04-20
 *
 * Schedule (cron example):
 *   0 3 * * *  cd /path/to/helix-project && node scripts/nightly-trace-eval-backfill.mjs >> .helix/nightly.log 2>&1
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { initDb } from '../src/db.js';
import * as trace from '../src/trace-lite.js';
import * as evalLite from '../src/eval-lite.js';

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const limit = parseInt(getArg('--limit', '100'), 10);
const evalVersion = getArg('--version', `eval-lite@${new Date().toISOString().slice(0, 10)}`);

async function loadConfig() {
  const configPath = join(process.cwd(), 'helix.config.js');
  if (!existsSync(configPath)) return {};
  const mod = await import(configPath);
  return mod.default || {};
}

function badgeFromScores(scores) {
  if (!scores.length) return 'gray';
  const min = Math.min(...scores);
  if (min >= 90) return 'green';
  if (min >= 70) return 'yellow';
  return 'red';
}

async function runSuite(name, agentId) {
  if (name === 'command-safety' && typeof evalLite.evalCommandSafety === 'function') {
    return evalLite.evalCommandSafety(agentId);
  }
  if (name === 'prompt-injection' && typeof evalLite.evalPromptInjection === 'function') {
    return evalLite.evalPromptInjection(agentId);
  }
  return null;
}

async function backfillBatch({ limit, evalVersion }) {
  const runs = await trace.listRunsNeedingEval({ limit, evalVersion });
  const processed = [];

  for (const run of runs) {
    const suites = {};
    const numericScores = [];
    for (const suiteName of ['command-safety', 'prompt-injection']) {
      const result = await runSuite(suiteName, run.agent_id || 'default');
      if (!result) continue;
      suites[suiteName.replace(/-/g, '_')] = {
        score: result.score,
        passed: result.passed,
        total: result.total,
        judge_version: evalVersion,
        run_id: result.id,
        status: 'ok',
      };
      if (typeof result.score === 'number') numericScores.push(result.score);
    }

    const avg = numericScores.length ? Number((numericScores.reduce((a, b) => a + b, 0) / numericScores.length).toFixed(1)) : null;
    const min = numericScores.length ? Math.min(...numericScores) : null;
    const payload = {
      suites,
      summary: { min_score: min, avg_score: avg, badge: badgeFromScores(numericScores) },
      source: 'nightly-cron',
      scored_at: new Date().toISOString(),
    };
    const saved = await trace.attachEvalScore(run.id, payload, evalVersion);
    processed.push({ run_id: run.id, agent_id: run.agent_id, saved, summary: payload.summary });
  }

  return processed;
}

// Re-export for /api/admin/trace/eval/backfill endpoint
export { backfillBatch };

async function main() {
  const config = await loadConfig();
  await initDb(config);
  await trace.initTraceTables();
  await evalLite.initEvalTables();
  const processed = await backfillBatch({ limit, evalVersion });
  console.log(JSON.stringify({ ok: true, limit, eval_version: evalVersion, processed: processed.length, runs: processed }, null, 2));
}

// Only run main if invoked directly (not on import)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
    process.exit(1);
  });
}
