# Workstation API Contract (v0.1 draft)

**Status**: draft for cross-check — 2026-04-20
**Owner**: CC1 (helix-framework side)
**Cross-check**: Hermes (truth boundary), CCOC (implementation)
**Phase 1 scope**: single-user / small-team, productization-quality polish

This contract defines how callers (Helix agents, CC sessions, Hermes, direct clients) invoke the VPS-OC sandbox workstation. It is **separate from** the brain-bridge contract (see Hermes's `symbiosis-helix/docs/plans/2026-04-20-oauth-gpt-brain-bridge-spec.md`) — the workstation talks to its brain internally.

---

## 1. Layers (who sees what)

```
caller (Helix / CC / Hermes)
      │  workstation-api (this contract)
      ▼
┌─────────────────────────────┐
│  VPS-OC workstation runtime │
│  ├── browser (Playwright)   │
│  ├── terminal               │
│  ├── files / artifacts      │
│  ├── office (LibreOffice)   │
│  └── code-server            │
└─────────────┬───────────────┘
              │  brain-bridge-api (Hermes's spec)
              ▼
      OAuth GPT bridge facade
              │
              ▼
     symbiosis-helix/openai-auth.js
```

Callers **never** see the brain bridge or consumer session. They only see task spec in, artifacts + result out.

---

## 2. Authentication

Phase 1: **single bearer token** `WORKSTATION_TOKEN`.

- Header: `Authorization: Bearer <token>`
- Set on the workstation via `.env` (deployment secret)
- Missing / invalid → `401 workstation_unauthorized`

Future-proofing (not implemented Phase 1): token format leaves room for `ws_user_<id>_...` so multi-user can slot in without breaking clients.

---

## 3. Endpoints

### 3.1 Health — liveness + brain reachability

```
GET /api/workstation/health
```

**Response 200**:
```json
{
  "status": "ok" | "degraded",
  "version": "0.1.0",
  "brain_bridge": { "reachable": true, "latency_ms": 120 },
  "sandbox": { "uptime_sec": 3600, "active_tasks": 2 }
}
```

No auth required for this endpoint (ops-friendly). Response is intentionally **ops-safe only** — must not expose model lists, internal URLs, token counts, or queue item details (those belong in `/capabilities` or `/metrics`, both authed).

### 3.2 Capabilities — what this workstation can do

```
GET /api/workstation/capabilities
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "capabilities": [
    { "name": "desktop",    "description": "XFCE Linux desktop via Xvfb",     "available": true },
    { "name": "browser",    "description": "Google Chrome + Playwright",       "available": true },
    { "name": "office",     "description": "LibreOffice Writer/Calc/Impress",  "available": true },
    { "name": "shell",      "description": "Bash shell execution",             "available": true },
    { "name": "screenshot", "description": "Desktop / browser screenshots",    "available": true },
    { "name": "vnc",        "description": "Remote desktop via noVNC",         "available": true }
  ],
  "brain_models": ["oauth-gpt/gpt-4o"],
  "limits": {
    "max_task_duration_sec": 1800,
    "max_concurrent_tasks": 3,
    "max_concurrent_tasks_per_token": 1,
    "max_artifact_size_mb": 100
  },
  "reset_mode": "container",
  "reset_policies": ["after_task", "after_project", "manual"],
  "checkpoint_policies": ["none", "on_step", "on_failure"]
}
```

Each `capabilities[i]` is an object with `name` (stable identifier), `description` (human-readable), `available` (boolean — whether the backing tool is installed and healthy). `brain_models` lists which brain endpoints this runtime can route through; empty means no brain bridge attached.

`reset_mode` describes how the workstation restores baseline between tasks. Phase 1: `"container"` (ephemeral Docker per task). Future options: `"snapshot"` (filesystem-level), `"none"` (caller manages persistence). Callers that need clean-environment guarantees should check this before submitting sensitive tasks.

### 3.3 Submit task — async

```
POST /api/workstation/task
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body** (task spec, follows Hermes's one-shot template):
```json
{
  "goal": "string — what the task should accomplish",
  "success_criteria": ["string"],
  "allowed_paths": ["workspace/...", "tmp/..."],
  "forbidden": ["no deploy", "no db schema change"],
  "steps": [
    "check current state",
    "implement minimal change",
    "run tests",
    "self-fix up to 2x on failure",
    "stop and report if still failing"
  ],
  "decision_policy": {
    "max_self_fix_retries": 2,
    "on_missing_credential": "stop_and_report",
    "on_architecture_change": "stop_and_report"
  },
  "output_format": {
    "fields": ["changed_files", "test_result", "blocker", "next_step"]
  },
  "brain_model": "oauth-gpt/gpt-4o",
  "timeout_sec": 600,
  "callback_url": null,
  "reset_policy": "after_task",
  "checkpoint_policy": "on_failure",
  "preserve_artifacts": true,
  "project_id": null
}
```

**Reset / checkpoint semantics**:
- `reset_policy`:
  - `after_task` (default) — workspace restored to baseline immediately after terminal state; every task starts clean
  - `after_project` — requires `project_id`; workspace persists across tasks sharing the same project, restored when the project is closed
  - `manual` — no automatic restore; caller must invoke rollback explicitly
- `checkpoint_policy`:
  - `none` — no snapshots
  - `on_step` — snapshot after each step (heavy, use sparingly)
  - `on_failure` (default) — snapshot only if a step fails, enabling resume
- `preserve_artifacts` (default `true`) — artifacts survive workspace reset; they live in an out-of-workspace store bound to the task_id, subject to the standard 7-day TTL

**Response 202** (accepted, async):
```json
{
  "task_id": "ws_01HXYZ...",
  "status": "queued",
  "created_at": "2026-04-20T16:00:00Z",
  "poll_url": "/api/workstation/task/ws_01HXYZ..."
}
```

**Errors**:
- `400 ws_invalid_spec` — required fields missing / malformed
- `401 workstation_unauthorized`
- `413 ws_spec_too_large`
- `429 ws_rate_limited` — too many concurrent tasks
- `503 ws_brain_unavailable` — brain bridge is down, task cannot start

### 3.4 Poll task

```
GET /api/workstation/task/:id
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "task_id": "ws_01HXYZ...",
  "status": "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled",
  "created_at": "2026-04-20T16:00:00Z",
  "updated_at": "2026-04-20T16:03:12Z",
  "progress": {
    "current_step": 3,
    "total_steps": 5,
    "last_event": "running tests"
  },
  "result": {
    "changed_files": ["src/foo.js"],
    "test_result": "3/3 pass",
    "blocker": null,
    "next_step": null,
    "artifacts": [
      { "name": "screenshot-step3.png", "url": "/api/workstation/artifact/...", "size_bytes": 45231 }
    ]
  },
  "error": null,
  "logs_url": "/api/workstation/task/ws_01HXYZ.../logs"
}
```

For non-terminal statuses (`queued` / `running`), `result` is `null` or partial.

### 3.5 Stream logs (optional, Phase 1+)

```
GET /api/workstation/task/:id/logs
Authorization: Bearer <token>
Accept: text/event-stream
```

SSE stream of structured log events. Phase 1 may implement as append-only JSON lines.

### 3.6 Cancel task

```
POST /api/workstation/task/:id/cancel
Authorization: Bearer <token>
```

**Response 200**:
```json
{ "task_id": "...", "status": "cancelled", "updated_at": "..." }
```

Idempotent — cancelling an already-terminal task returns current state, not error.

### 3.7 Reset session (manual)

```
POST /api/workstation/session/:project_id/reset
Authorization: Bearer <token>
```

Only relevant when tasks use `reset_policy: "after_project"` or `"manual"`. Destroys the persistent project workspace container and recreates a fresh one from baseline. Not a snapshot rollback — there is no "prior state" to return to; this is always a clean-slate recreate.

**Response 200**:
```json
{ "project_id": "...", "reset_at": "2026-04-20T16:30:00Z", "reset_mode": "container" }
```

### 3.8 Fetch artifact

```
GET /api/workstation/artifact/:artifact_id
Authorization: Bearer <token>
```

Returns the raw file (binary or text). Content-Type reflects artifact type.

---

## 4. Status lifecycle

```
queued ──► running ──► succeeded
              │
              ├──► failed
              │
              └──► cancelled
```

Terminal states: `succeeded`, `failed`, `cancelled`. No re-transitions.

---

## 5. Error codes (stable)

| Code | HTTP | Meaning |
|---|---|---|
| `workstation_unauthorized` | 401 | Missing / invalid bearer token |
| `ws_invalid_spec` | 400 | Task spec validation failed (include `details`) |
| `ws_task_not_found` | 404 | task_id does not exist |
| `ws_spec_too_large` | 413 | Spec exceeds size limit |
| `ws_rate_limited` | 429 | Too many concurrent tasks |
| `ws_brain_unavailable` | 503 | Brain bridge down / unreachable |
| `ws_internal` | 500 | Unexpected runtime error |
| `ws_artifact_expired` | 410 | Artifact TTL reached (default 7d after task terminal state) |

All error responses:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```

---

## 6. Observability

Every task produces:
- **Structured logs** — step-level events with timestamps
- **Artifacts** — screenshots per browser step, files per terminal step, diffs per code step
- **Metrics** — duration, retries, brain bridge calls, tokens used (if brain reports)

Metrics endpoint:
```
GET /api/workstation/metrics
Authorization: Bearer <token>
```

Prometheus-text or JSON, exposing:
- `ws_tasks_total{status=...}`
- `ws_task_duration_seconds_bucket`
- `ws_brain_bridge_latency_ms_bucket`
- `ws_active_tasks`
- `ws_queue_depth`

---

## 7. Truth boundary (what this contract does NOT expose)

Callers **must not** see:
- Consumer OAuth session state (refresh token, cookies, scopes)
- Brain bridge internal URL or auth
- Raw LLM request/response (logs may include summaries only)
- Other users' task IDs, artifacts, or logs

If caller tries to fetch an artifact / task belonging to another caller (future multi-user), return `404 ws_task_not_found` — do not leak existence.

---

## 8. Caller examples

### 8.1 From Helix agent (via `call_workstation` tool)

```js
// helix-framework/src/tools/workstation.js (pending impl, Task #58)
import { callWorkstation } from 'helix/tools/workstation';

const result = await callWorkstation({
  goal: 'refactor login form to use new validation lib',
  allowed_paths: ['src/auth/'],
  forbidden: ['no deploy', 'no db change'],
  timeout_sec: 600,
});
```

### 8.2 From CC session (direct HTTP)

```bash
curl -X POST https://workstation.vps-oc.internal/api/workstation/task \
  -H "Authorization: Bearer $WORKSTATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d @task-spec.json
```

### 8.3 From Hermes (cross-check probe)

```bash
curl https://workstation.vps-oc.internal/api/workstation/health
# expect { "status": "ok", "brain_bridge": { "reachable": true } }
```

---

## 9. Phase 1 decisions (locked after Hermes cross-check 2026-04-20)

1. **Callback vs polling** — Phase 1 is **polling only**. `callback_url` field is reserved in the spec but not implemented (webhook auth / retry / signature / dead-letter defer to Phase 2+).
2. **Artifact retention** — default **7 days**, configurable via env. TTL clock starts at task terminal state (`succeeded` / `failed` / `cancelled`). Failed/cancelled artifacts follow the same TTL — not kept indefinitely.
3. **Brain model list** — always **discover via `/capabilities`** (callers must not hard-code). Phase 1 implementation returns a minimal list (e.g. just `oauth-gpt/gpt-4o`), but the discovery contract is already in place so switching to Copilot / API later needs no client changes.
4. **Per-token concurrency** — **mandatory Phase 1**. Defaults: `max_concurrent_tasks_per_token = 1`, `global_max_concurrent_tasks = 3`. Excess returns `429 ws_rate_limited`.
5. **Streaming** — `logs` SSE: yes. Partial result stream: **deferred**. Partial progress is exposed via the `progress` block on poll responses only; no separate result-stream surface.

---

## 10. Phase 1 implementation handoff

- **CCOC** owns the runtime that implements this contract (VPS-OC-side HTTP server + task orchestrator)
- **Hermes** owns the brain-bridge facade that the runtime calls internally
- **CC1** owns the `call_workstation` client tool in helix-framework (Task #58)

Cross-check gate before Phase 1 ship:
- [ ] 3-way smoke: Helix / CC / Hermes each invoke the API successfully
- [ ] Truth boundary audit: no consumer session leak in logs / errors / artifacts
- [ ] Auth failure paths tested: 401 on missing / bad token
- [ ] Brain bridge degraded mode: task correctly reports `ws_brain_unavailable`
