# Single-binary packaging options — research

Helix 0.10.0 ships as an npm package (2.1 MB / 53 files) depending on the Node.js runtime users must install separately. Users today:

```
npm i -g helix-agent-framework
helix init
```

This works but has friction for non-Node-native users. Agenvoy (analyzed 2026-04-22) demonstrates a cleaner operator experience with a single-binary Go distribution. This doc compares viable packaging paths for helix-framework 1.x and beyond.

---

## Current state

- **Runtime**: Node.js (`bin/helix.js` shebang `#!/usr/bin/env node`)
- **Core deps** (`package.json`):
  - `express` ^5.1.0 — pure JS
  - `pg` ^8.20.0 — pure JS
  - `better-sqlite3` ^12.9.0 — **native C++ addon** (platform-specific .node)
- **Optional deps** (user brings own):
  - `playwright` — browser automation, heavy native binaries
  - `pgvector` — PG extension, server-side
- **Install path**: npm install → Node resolves → native addon compiled against Node ABI
- **Tarball size**: 2.1 MB (source only; Node runtime not included)

## Evaluation axes

1. **User friction**: do they need to install a separate runtime?
2. **Cross-platform**: macOS arm64 / macOS x64 / Linux x64 / Linux arm64 / Windows?
3. **Binary size**: how big is the shipped artifact?
4. **Native addon compatibility**: does `better-sqlite3` work?
5. **Rewrite cost**: how much of the current codebase must change?
6. **Startup time**: cold-start latency for `helix --version` etc.
7. **Maintenance**: can one person maintain two distributions long-term?

---

## Option A — Bun SEA (Single Executable)

**Tool**: `bun build --compile`

**How it works**: Bun embeds its JS runtime + your app into a single executable. Cross-compile targets: macOS arm64/x64, Linux arm64/x64, Windows x64.

**Pros:**
- **Zero codebase rewrite** — existing JS runs as-is
- Preserves JS ecosystem + npm packages
- Embedded Bun runtime handles express/pg fine (pure JS deps compatible)
- Cross-compile from one host
- Fast startup (Bun is faster than Node)

**Cons:**
- Binary size ~60–100 MB (Bun runtime + app)
- **Native addon risk** — `better-sqlite3` is the specific pain point. Bun's native addon support is best-effort; historically broken, improving in 2025-2026. Needs validation.
- Single-file = harder to debug stack traces (sourcemaps needed)
- Bun ≠ Node — edge cases in module resolution, streams, fs APIs occasionally differ

**Compatibility risk (specific):**
- `better-sqlite3`: compiled native module. Bun may not load it cleanly; may need swap to `bun:sqlite` (Bun's built-in) for Bun targets and keep `better-sqlite3` for Node.
- `pg`: pure JS + optional `pg-native` (we don't use pg-native) — compatible.
- `express`: fully compatible.

**Effort**: ~2–5 days
- Day 1–2: verify all deps load under Bun; swap `better-sqlite3` → `bun:sqlite` or abstract behind adapter
- Day 3: CI cross-compile matrix (4 targets)
- Day 4: smoke test on each target
- Day 5: distribution pipeline (GitHub Releases attach binaries)

---

## Option B — Go rewrite

**How it works**: Rewrite helix-framework core (CLI, HTTP server, memory layer, tool-registry, LLM clients) in Go. Ship as single static binary.

**Pros:**
- Truly small binary (~10–20 MB)
- Fastest startup
- No runtime dependency — works on any Linux/macOS with no prior install
- Cross-compile is Go's strength: `GOOS=linux GOARCH=arm64 go build` just works

**Cons:**
- **Massive rewrite cost** — every line of JS must be re-authored in Go
- Ecosystem loss: LangChain / npm packages for LLM routing, evals, skill loaders have no direct Go equivalent
- Go lacks mature equivalent of playwright's ergonomics (`playwright-go` exists but less polished)
- Losing npm publish distribution channel fragments the user base
- Two codebases if we keep npm alive → maintenance burden doubles
- Type system shift — our JSDoc + TS-style types don't port mechanically

**Effort**: **weeks to months**
- Core CLI + HTTP server: 2–3 weeks
- Memory layer (three-tier + pgvector): 2 weeks
- Tool registry + skill loader: 2 weeks
- LLM client multiplexer (10 providers): 3 weeks
- Test / stabilize: 4 weeks
- **Total: ~3 months for feature parity**

---

## Option C — Node SEA (experimental)

**Tool**: Node.js 22+ built-in Single Executable Application feature.

**Pros:**
- Official Node.js path — future-proof
- No runtime swap needed (it IS Node)

**Cons:**
- **Still experimental** as of Node 22 (2025)
- Requires manual post-processing (`postject` tool to inject snapshot into Node binary)
- Each platform requires building on that platform (no cross-compile)
- Native addons: same problems as Bun SEA
- Binary size ~100+ MB (full Node runtime)

**Effort**: similar to Bun SEA (~3–5 days) but with more fragile tooling.

---

## Option D — Dockerize + desktop wrapper

**How it works**: Ship Docker image + a thin CLI wrapper that pulls/runs the image. Or use Tauri for desktop app (work-in-progress in helix-framework #50).

**Pros:**
- Full environment isolation
- Works on any host with Docker
- Native addon problems disappear (Linux container)

**Cons:**
- Users need Docker installed (still a runtime dep, just shifted)
- Desktop app path (Tauri) is a different UX — menubar / window vs CLI
- Doesn't address the original problem (less friction than npm, but adds Docker as dep)

**Effort**: tracked separately in #50 (Tauri desktop wrapper, deferred).

---

## Comparison matrix

| | npm (current) | Bun SEA | Go rewrite | Node SEA | Docker |
|---|---|---|---|---|---|
| User friction | Node install | **Zero install** | **Zero install** | **Zero install** | Docker install |
| Cross-compile | n/a | **4 targets** | **all targets** | 1 platform per build | n/a |
| Binary size | 2.1 MB src | ~60–100 MB | ~10–20 MB | ~100 MB | image size varies |
| Native addons | ✅ (npm resolves) | ⚠️ better-sqlite3 risk | n/a (pure Go) | ⚠️ same risk | ✅ |
| Rewrite cost | 0 | Low (adapter layer) | **3 months** | Low | Minimal |
| Startup | ~200ms | ~50ms (Bun fast) | ~5ms | ~200ms | ~2s (container) |
| Maintenance | 1 codebase | 1 codebase + adapter | **2 codebases** | 1 codebase | 1 codebase + Dockerfile |

---

## Recommendation

**Prioritize Option A (Bun SEA) as the 1.x stretch goal.**

**Reasoning:**
1. **Preserves the JS ecosystem** — we lose nothing. `@helix/skill-*` npm packages keep working.
2. **Low rewrite cost** — swap `better-sqlite3` for an adapter pattern (`bun:sqlite` / `better-sqlite3` switch based on runtime). Everything else Just Works.
3. **Cross-compile** covers macOS + Linux in one pipeline.
4. **4–5 day effort** fits a post-1.0 minor release.
5. **Does not block** existing npm distribution — we ship both.

**Go rewrite is NOT recommended**: 3-month effort for a distribution improvement is not justified when Bun SEA delivers 80% of the UX win at 5% of the cost. Go is worth revisiting only if (a) Bun SEA fails native addon compat AND (b) we need microsecond startup AND (c) we have engineering capacity to run two codebases.

**Node SEA is a fallback** if Bun SEA proves incompatible — same effort level, same tradeoffs, but with an officially-blessed upstream.

---

## Recommended 1.x roadmap

### 1.1.0 — Bun SEA proof-of-concept
- Swap `better-sqlite3` for adapter (`bun:sqlite` on Bun, `better-sqlite3` on Node)
- `bun build --compile --target=bun-darwin-arm64 bin/helix.js --outfile=helix-darwin-arm64`
- CI matrix: build for 4 targets
- Attach binaries to GitHub Release alongside the npm package

### 1.2.0 — Distribution hardening
- Auto-update channel (check for newer binary)
- Signed binaries (macOS notarization)
- Homebrew tap: `brew install helix-symbiosis/helix`

### 2.0.0 — If Bun SEA falls short
- Revisit Node SEA once it's stable
- Evaluate Go rewrite only if compelling operational need emerges (e.g., resource-constrained edge deployment)

---

## References

- Bun build executable docs: https://bun.sh/docs/bundler/executables
- Node SEA docs: https://nodejs.org/api/single-executable-applications.html
- Agenvoy (comparison target): https://github.com/pardnchiu/Agenvoy (Go, single-binary)
- better-sqlite3 Bun compat tracking: https://github.com/oven-sh/bun/issues (search "better-sqlite3")

---

**Status**: Research artifact (2026-04-22). Not committed to 1.x roadmap yet — awaiting boss decision on scope.
**Author**: CC1 (as part of task #65 / Agenvoy framework 內化 actionable #5).
**Next action**: if approved, open task to prototype Bun SEA build with `better-sqlite3` adapter.
