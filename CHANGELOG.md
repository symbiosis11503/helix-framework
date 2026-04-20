# Changelog

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
