# Road to 1.0.0

Helix is at **0.10.0** today. 1.0.0 will lock in a stable external API so teams can build on Helix without worrying about breaking changes between patch releases.

[繁體中文](./road-to-1.0.zh-TW.md) (pending)

## What 1.0.0 means

- **Semver from this point forward.** Breaking changes require a major bump; additive changes are minor; bug fixes are patch.
- **Stable CLI surface** — `helix init`, `helix start`, `helix login`, `helix doctor`, `helix agent`, `helix memory`, `helix eval`, `helix export/import`.
- **Stable HTTP API** under `/api/v1/*` — once frozen, endpoints don't disappear without a major bump.
- **Stable config shape** — `helix.config.js` top-level keys (`model`, `apiKeyEnv`, `database`, `agents`, `skills`, `hooks`) won't rename.
- **Stable skill loader** — `SKILL.md` frontmatter fields (`name`, `description`, `version`, `parameters`, `capabilities`) are permanent once in 1.0.
- **Stable tool-registry contract** — `register({ name, description, level, category, inputSchema, handler })` shape.

What is explicitly **not** locked by 1.0:
- Internal module boundaries inside `src/`. Anything not exposed through the CLI / HTTP / config / SKILL.md / tool-registry contract is free to move.
- Dashboard UI (`/v2/*`). Iterated continuously.
- Undocumented behavior. If it's not in the docs, it's not load-bearing.

## Release checklist (targeted for 1.0)

- [x] 10 LLM providers with SSE streaming
- [x] Three-tier memory + pgvector
- [x] SQLite + PostgreSQL dual adapter
- [x] Command safety engine (35+ patterns)
- [x] Prompt injection defense (7 patterns)
- [x] Workflow DAG engine
- [x] Skills auto-discovery
- [x] MCP client
- [x] Eval framework
- [x] Portable tarball distribution (macOS arm64, Linux x64)
- [x] English + 繁中 documentation parity (README, getting-started, core-guide, FAQ, distribution, config-reference)
- [x] GitHub issue + PR templates
- [x] `examples/` each has a one-command smoke script (`examples/*/smoke.sh`)
- [x] CI matrix across macOS arm64 + Linux x64 + Node 20/22/24
- [ ] `docs/migration/1.0.md` — API contract diff versus 0.9.x
- [ ] Public Discord / discussion channel for external users
- [ ] Intel Mac tarball (deferred; tracked separately — GitHub-hosted macos-13 runner queue time is the blocker)

## How to follow along

- **npm**: `npm install -g helix-agent-framework`
- **CHANGELOG**: [`CHANGELOG.md`](../CHANGELOG.md)
- **Issues**: use the GitHub bug / feature templates in `.github/ISSUE_TEMPLATE/`
- **PRs**: follow `.github/PULL_REQUEST_TEMPLATE.md`

If you're shipping something on top of Helix today, please file an issue describing your scenario so the 1.0 stability guarantees cover it.
