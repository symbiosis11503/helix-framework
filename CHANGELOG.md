# Changelog

## 0.10.2 — 2026-04-24

### Fixed — `helix_memory_stats` aggregator returning 0 despite positive sample rows
- `bin/helix-memory-mcp.js` read `stats.avg_importance` / `stats.avg_decay` and `stats.by_type` (snake_case), but `memory-manager.js#memoryStats()` returns `avgImportance` / `avgDecay` / `byType` (camelCase). The mismatch meant every agent saw `Avg importance: 0.00` / `Avg decay: 0.00` regardless of data — a silent correctness failure flagged by CC2 and Codex during SDD-MemComplete Phase C3 authenticity work.
- Handler now reads both shapes (camelCase preferred, snake_case fallback).

## 0.10.1 — 2026-04-24

### Added — `memory_project_recall` MCP tool
- `bin/helix-memory-mcp.js` exposes new tool to query L4 `project_memory` (cross-agent shared truth). External agents previously had no way to reach shared governance rules via MCP — `helix_recall` only scans the per-agent `memories` table.
- `src/memory-manager.js` adds `recallProjectMemory({ projectId, query, scopePath?, memoryKind?, status?, limit? })` — PG-only, FTS + CJK ILIKE (no bge dependency, keeps 0.10.x portable).

### Fixed — PG connection hardcode for direct-PG agents
- 0.10.0 hardcoded `host: '127.0.0.1'` + `port: 15432` in MCP server PG init, breaking agents that connect directly over Tailscale without an SSH tunnel. 0.10.1: when `HELIX_SSH_HOST` is unset, use `PG_HOST`/`PG_PORT` env (defaults `127.0.0.1:5432`).

### Context
Ships the main fix for the Forced Dual-Write Rollout (SDD v0.2, 2026-04-24). See `symbiosis-helix/docs/plans/2026-04-24-forced-dual-write-rollout-sdd-spec-v0.2.md`.

## 0.10.0 — 2026-04-21

### Added — Productization for 1.0.0 readiness
- `docs/road-to-1.0.md` + `docs/road-to-1.0.zh-TW.md` — explicit semver commitment, list of which contracts get locked at 1.0 (CLI, HTTP `/api/v1/*`, config shape, SKILL.md, tool-registry) and which internals stay flexible
- `.github/ISSUE_TEMPLATE/bug_report.md` + `feature_request.md` + `config.yml` — blank issues disabled; external bug reporters get structured fields (env, repro, logs)
- `.github/PULL_REQUEST_TEMPLATE.md` — scope checkboxes + test plan + breaking-change call-out
- `examples/{chatbot,cmd-runner,research-agent}/smoke.sh` — one-command smoke per example with smart CLI fallback (`helix` global → `node bin/helix.js` from source); skips runtime boot when no API key is set so CI runs cleanly

### Added — Workstation Client Tool (for VPS-OC integration)
- `src/tools/workstation.js` — 4 tools: `workstation.call` (submit task spec, poll to terminal), `workstation.health`, `workstation.capabilities`, `workstation.cancel`. Conforms to `docs/contracts/workstation-api.md`
- `docs/contracts/workstation-api.md` — bilingual-friendly contract for the VPS-OC workstation runtime: endpoints, error codes, lifecycle, truth boundary, reset/checkpoint policies

### Added — `oauth-gpt` Provider Slot
- `src/llm-provider.js` recognizes model pattern `oauth-gpt/<model>` and routes via `OAUTH_GPT_BRIDGE_URL` + `OAUTH_GPT_BRIDGE_TOKEN` (OpenAI-compatible). No consumer-session details touched in framework core.

### Added — Workflow Checkpoint + Retry Utilities
- `src/workflow-checkpoint.js` — save/load/clear/list/runWithCheckpoint. Failed step persists state; resumed run skips completed steps.
- `src/retry-policy.js` — exponential backoff `retry()`, `createCircuitBreaker()`, `isTransientError()` helper.

### Added — Spec Compiler Skill
- `data/skills/workstation/spec-compiler/SKILL.md` — turns a rough natural-language task into a structured workstation spec (goal / success_criteria / allowed_paths / forbidden / steps / decision_policy / output_format). Targets metered LLM brains (one well-bounded run instead of many round-trips).

### Changed — README & Docs
- `README.en.md` rewritten to feature-parity with `README.md` (10 LLM providers, 21 modules, full CLI, badges, links to docs/road-to-1.0)
- Examples README documents the new `smoke.sh` flow

### Changed — CI
- `.github/workflows/test.yml` matrix now covers `ubuntu-latest` + `macos-14` × Node 20/22/24
- New step: syntax-check every `examples/*/helix.config.js`
- New step: run every `examples/*/smoke.sh`

### Tests
- 53 tests total (was 28). 45 pass, 8 e2e-workstation skipped when `WORKSTATION_URL` not set
- New: `tests/workstation.test.mjs` (4), `tests/workflow-checkpoint.test.mjs` (6), `tests/retry-policy.test.mjs` (7), `tests/e2e-workstation.test.mjs` (8 — 9-gate cross-check skeleton)
- **First full 9-gate baseline against live VPS-OC + brain bridge: 8/8 pass** (2026-04-21 03:59 UTC) — real LLM completion through OAuth GPT bridge in 8 seconds end-to-end

### Fixed
- `src/tools/workstation.js` accepts both `succeeded` and `completed` as terminal-success status (different runtime conventions); previously only `succeeded` was recognized, causing polls to wait until timeout when runtime returned `completed`

### Added — Workstation CLI Wrapper
- `helix workstation run "<goal>" [--timeout N] [--model M]` — submits a task to a configured VPS-OC Manus workstation and live-polls to terminal state, printing result inline
- `helix workstation status <task_id>` — query one task
- `helix workstation cancel <task_id>`
- `helix workstation health` — no-auth endpoint probe, shows brain-bridge reachability + latency
- `helix workstation capabilities` — available tools, brain_models, reset_mode, limits
- Env: `WORKSTATION_URL` (required), `WORKSTATION_TOKEN` (required for all but health). One-command path from install to running a real LLM-backed task inside a fresh Docker container.

## 0.9.1 — 2026-04-20

### Attempted
- Tried to re-add macOS Intel (x86_64) portable tarball via `macos-13` runner
- **Blocked**: GitHub Actions free-tier Intel Mac runner stayed queued past the 20-min timeout window; two release attempts (0.9.0 pre-release + 0.9.1 retry) both had the macos-13 leg fail to start
- Intel Mac tarball deferred to **0.9.2** (pending self-hosted Intel runner OR paid tier) — Intel Mac users continue to use the arm64 tarball via Rosetta 2
- Docs + CHANGELOG now explicitly reflect this gap instead of implying it shipped

### Changed
- `release.yml` comment block documents the Intel-Mac queue issue for future maintainers

## 0.9.0 — 2026-04-20

### Added — Portable Tarball Distribution
- New `scripts/build-portable.sh` packages node binary + esbuild-bundled Helix + native deps into a download-and-run tarball per OS/arch
- New `.github/workflows/release.yml` matrix builds portable tarballs on tag push or workflow_dispatch, attaches to GitHub Release
- First portable release: **v0.9.0** on GitHub
  - `helix-portable-darwin-arm64.tar.gz` (32.6 MB) — macOS Apple Silicon
  - `helix-portable-linux-x86_64.tar.gz` (38.3 MB) — Linux x64
  - Intel Mac users run arm64 via Rosetta 2 (macos-13 runner dropped from matrix due to queue waits)
- Usage: `tar -xzf helix-portable-<os>-<arch>.tar.gz && cd helix-portable-<os>-<arch> && ./helix init && ./helix start`

### Added — Bilingual Documentation
- `README.zh-TW.md` — 繁體中文 README with 三柱 positioning (繁中介面 × 輕量系統 × 簡單直覺)
- `docs/distribution.md` + `docs/distribution.zh-TW.md` — four distribution paths with "which one for me" guide
- `docs/core-guide.zh-TW.md` — 13 shared-core modules in Chinese
- `docs/CONFIG_REFERENCE.zh-TW.md` — config reference in Chinese
- `docs/FAQ.zh-TW.md` — FAQ in Chinese
- `CONTRIBUTING.zh-TW.md` — contribution guide in Chinese
- `examples/README.zh-TW.md` + each example's `README.zh-TW.md`
- Bilingual cross-links at top of every doc; internal links follow user's chosen language

### Added — esbuild Bundle Script
- `npm run build:bundle` produces `dist/helix-bundle.mjs` (1.4 MB single-file ESM) for packaging pipelines
- better-sqlite3 and pg externalized (kept as native deps that travel beside the bundle)

### Fixed
- `PKG_VERSION` lookup in `server-lite.js` now checks same-dir first (for portable bundles) before parent (for npm installs), and verifies `pkg.name === 'helix-agent-framework'` so it doesn't read the user's project package.json by mistake
- Previous portable builds reported `version: "unknown"` when a user-project package.json was next to the extract directory

## 0.8.1 — 2026-04-20

### Added — PWA (Installable Web App)
- `static/v2/manifest.json` — W3C Web App Manifest (zh-TW, standalone display, dark theme)
- `static/v2/icon-192.svg` + `icon-512.svg` — any + maskable purpose
- `static/v2/service-worker.js` — cache-first for static assets, never caches `/api/*`
- `index.html` + `debug.html` — meta tags, theme-color, apple-touch-icon, SW registration
- Result: `http://localhost:18860/v2/` shows browser "Install Helix" affordance → opens in standalone window with Dock/Start icon

### Fixed
- Port conflict (EADDRINUSE) now fails fast with 3 actionable remediation paths instead of raw Node crash

## 0.8.0 — 2026-04-20

### Added — CI / Tests (adoption readiness sprint)
- `.github/workflows/test.yml` — matrix on Node 20 / 22 / 24, runs syntax checks across `src/*.js` + `bin/*.js`, `npm test`, and `npm pack --dry-run`
- `tests/integration.test.mjs` — 16 new integration tests covering `trace-lite` (startRun/Span/eval round-trip/stats/listRunsNeedingEval), `session-store` (CRUD/stats/context), `eval-lite` (suites/end-to-end/history), and CLI (version/help/fallback). Uses temp SQLite
- Total test suite: **28 tests** (was 12) — runs in ~300ms

### Added — Examples Directory
- `examples/chatbot/` — minimal single-agent scaffold (Gemini + session memory)
- `examples/research-agent/` — multi-step with skills, memory-v2 decay, web-search
- `examples/cmd-runner/` — shell command agent with command-safety + injection-defense hooks
- `examples/README.md` — which-to-pick table + copy-out instructions

### Added — Console v3
- 4th action card: **Run Workflow** — lists `/api/workflow-defs`, spawns via `POST .../run`
- actions grid switched to `auto-fit` so 4 cards reflow gracefully on mobile

### Fixed — Version Drift
- `/api/health` now reads `package.json` version at module load (was hardcoded `0.4.1`)
- Startup banner reads same (was hardcoded `0.4.1`)
- `bin/helix-memory-mcp.js` MCP `serverInfo.version` now dynamic
- `docs/getting-started.md` — updated stale `v0.4.1` in example output, replaced dead `api-reference.md` link with examples pointer

## 0.7.0 — 2026-04-20

### Added — Console UX (Plan #3)
- `static/v2/index.html` rewritten from internal "Helix Agent Runtime" dashboard to product-facing **Helix Console**
- Onboarding block with 3-step quick-start (visible when 0 agents, dismissible via `localStorage._helix_onboard_dismissed`)
- Per-action `.hint` descriptions on each card (Spawn / Chat / Eval) — explain what the action does and when to use it
- Empty-state copy in zh-TW for trace list and alerts ("尚無 trace；跑幾個 agent 任務會自動記錄")
- Eval badges inline in the trace list (green/yellow/red) — parsed from `eval_score` JSON, hover shows avg/min
- Nav row: Debug Tools / API Health / npm / GitHub + live version display from `/api/health`
- Input validation before spawn/chat submissions (avoids silent 400s)

### Added — Smoke Tests
- `tests/smoke.test.mjs` — 12 tests covering `command-safety` (block/warn/safe + risk summary), `edit-tool` (validation, exact replace, ambiguous match), and `hooks` injection-defense (abort + allow paths)
- `npm test` script wired to `node --test tests/`
- Runs in <100ms with zero external deps — safe to gate CI on

## 0.6.1 — 2026-04-20

### Fixed
- **Critical packaging fix**: `scripts/nightly-trace-eval-backfill.mjs` was excluded from the published 0.6.0 tarball by `.npmignore scripts/` blanket rule, which caused `POST /api/admin/trace/eval/backfill` to fail at runtime (`ERR_MODULE_NOT_FOUND`). 0.6.1 narrows the exclude rule so runtime-required scripts ship inside the package.

## 0.6.0 — 2026-04-20

### Added — Trace Eval Persistence (D1 Phase 2)
- `trace_runs` schema additive columns: `eval_score` (JSONB on PG / TEXT on SQLite), `eval_scored_at`, `eval_version`
- `trace-lite.js` `attachEvalScore(runId, scoreObj, version)` write API + auto JSON parse on read
- `trace-lite.js` `listRunsNeedingEval({limit, evalVersion})` — find completed runs missing scores
- `POST /api/trace/runs/:runId/eval` — admin-auth attach single score
- `POST /api/admin/trace/eval/backfill` — admin-auth ad-hoc batch backfill (calls into nightly script)
- `scripts/nightly-trace-eval-backfill.mjs` — cron-schedulable batch re-eval with `--limit` / `--version` flags
- Badge rule: min ≥90 green / ≥70 yellow / else red

### Added — Debug Overlay v2 (D2 enhancement)
- Truth-state map per fetched URL (classified ok / auth / missing / server / network)
- Copy-snapshot button — JSON debug bundle to clipboard for bug reports
- Clear button — reset captured state without closing overlay
- Persisted toggle in `localStorage._sbs_debug_visible`

### Added — CLI Trace Subcommand
- `helix trace runs [--limit N]` — list recent runs with eval badge icons
- `helix trace stats [--hours N]` — runs / spans / totalTokens / totalCost / byStatus / hours window (default 24h)
- `helix trace backfill [--limit N]` — trigger admin backfill via auth-aware client

### Added — Debug HTML Eval Badge
- `static/v2/debug.html` trace list rows show per-run eval badge (green/yellow/red/gray) + scored_at timestamp

### Security
- **B-version admin endpoints fail-closed** — `POST /api/admin/trace/eval/backfill` and `POST /api/trace/runs/:runId/eval` no longer allow remote requests when `ADMIN_TOKEN` is unset; loopback / Tailscale / private LAN only as fallback. Closes the same anti-pattern that needed P0 fix in 0.5.0.

---

## 0.5.0 — 2026-04-20

### Added
- **Dependency Probe** — `helix start` now probes critical (Node>=18, DB driver, express) vs warnings (no API key, no model, port busy); fail-fast on critical with `--safe-mode` override
- **CLI REPL** — `helix repl [agent]` (alias of `helix agent chat`) with 11 slash commands: `/help`, `/clear`, `/reset`, `/agents`, `/switch`, `/memory`, `/history`, `/save`, `/session`, `/quit`, `/exit`
- **Debug Overlay** — drop-in `static/v2/_debug-overlay.js`: press `?` for live console errors, failed requests, hydrate timing

### Security
- **P0 admin auth fix** — `admin-api.js` 23 endpoints previously open in dev-mode fallback (`SBS_ADMIN_TOKEN` env unset → returned true); now fails closed with `SBS_ADMIN_TOKEN → ADMIN_TOKEN` chain + Bearer support + loopback/Tailscale-only when no token

### Tooling
- `boundary-check.mjs` — A/B/S 5 cross-import rules (now CI-enforced via Hermes contract)
- `v2-console-gate.mjs` — playwright headless console error gate with noise filter (Cloudflare beacon, 401 token-gated)
- `sw-bump.sh` — auto-bump `static/sw.js` VERSION + `--check` mode for pre-commit
- `trace-eval-link.mjs` — attach eval scores to recent trace runs (PoC)
- `claim-probe.mjs` — claim manifest → live probe regression gate

### Fixed
- Version string drift between `package.json`, `bin/helix.js`, `README.md` consolidated under semver

## B-20260419-1018

### Added
- **Gateway Adapter** — Unified messaging platform integration (Telegram, Discord, LINE, Slack) with webhook parsing, auto-session, and signature validation
- **Memory Manager** — Tiered long-term memory (episodic/semantic/procedural) with importance scoring, time decay, consolidation, auto-extraction from sessions, and context injection
- **Agent Autonomy** — Long task checkpoint/resume, self-optimization (execution path learning), and autonomous discovery rules with cooldown and master toggle
- **API Routes** — 20 new endpoints: `/api/gateway/*`, `/api/memory/v2/*`, `/api/autonomy/*`

### Changed
- Shared core expanded from 8 to 11 modules
- `.npmignore` improved (excludes .tgz, docs, scripts; package 55KB from 133KB)
- systemd service now loads `.env` via EnvironmentFile

## B-20260419-0021

### Added
- **Session Store** — Per-message conversation persistence with FTS search, compression, and parent session chaining
- **Delegation OS** — Isolated child agent execution with tool restrictions, depth limits, and batch parallel support
- **Command Safety** — 35+ dangerous command patterns with Unicode normalization and ANSI strip
- **Hook Lifecycle** — Interceptable before/after hooks that can abort operations, with built-in command safety and prompt injection defense
- **Edit Tool** — Exact string match file editing with uniqueness check, dry-run, and similar-match hints
- **MCP Client** — Stdio transport JSON-RPC client with dynamic tool discovery and server lifecycle management
- **LLM Provider** — Multi-provider chat completion (Gemini, Claude, OpenAI) with auto-detection
- **Tool Registry** — Dynamic tool registration, capability binding, and execution pipeline with hook chain integration
- **Agent Chat with Memory** — Conversations automatically persisted to session store with context injection and auto-compression at 30K tokens
- **CLI Agent Commands** — `helix agent list` and `helix agent chat [id]` for interactive agent management
- **Toast Notifications** — Non-blocking toast system replacing all browser alerts across 23 pages
- **Mobile Hamburger Menu** — Responsive sidebar toggle for screens under 960px
- **PWA Support** — Manifest and service worker auto-injected via shell.js across all pages
- **HttpOnly Cookie Auth** — Admin token can be set via HttpOnly cookie instead of localStorage
- **Hydration Timestamp** — Dashboard shows last data refresh time

### Security
- SQL injection fix in agent-spawn.js (parameterized queries)
- WebSocket authentication (external connections require token, 4401 on unauthorized)
- Admin auth default changed to enforce (was log-only)
- CSP hardened (object-src none, base-uri self, form-action self, frame-ancestors self)
- Prompt injection defense (7 patterns in hook lifecycle)

### Fixed
- PG search_vector column missing for session messages (changed to ILIKE)
- ReDoS vulnerability in DELETE pattern detection
- Delegation calling non-existent endpoint (fallback chain + agent chat API)
- ESM compatibility for consumer projects with existing package.json
- Events page showing generic empty-state during auth error
- Recurring cluster "cluster cluster" duplicate label

## B-20260418-2140

### Added
- Initial B version release
- CLI: `helix init`, `helix login`, `helix doctor`, `helix start`, `helix status`
- SQLite zero-config runtime
- Basic agent spawn and task management
- Memory remember/recall
- Workflow and cron job listing
