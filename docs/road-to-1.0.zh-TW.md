# 邁向 1.0.0

Helix 目前是 **0.10.0**。1.0.0 會鎖定一組穩定的對外 API — 團隊從此之後可以基於 Helix 建東西，不用擔心小版本間 breaking。

[English](./road-to-1.0.md)

## 1.0.0 的承諾

- **從此遵守 semver。** 破壞性變更 = major、附加功能 = minor、bug fix = patch。
- **穩定 CLI 介面** — `helix init` / `start` / `login` / `doctor` / `agent` / `memory` / `eval` / `export` / `import`。
- **穩定 HTTP API** 在 `/api/v1/*` — 一旦凍結，endpoints 不會無 major 升級就消失。
- **穩定 config shape** — `helix.config.js` 的頂層 keys（`model`、`apiKeyEnv`、`database`、`agents`、`skills`、`hooks`）不改名。
- **穩定 skill loader** — `SKILL.md` frontmatter 的 `name` / `description` / `version` / `parameters` / `capabilities` 進 1.0 後永久存在。
- **穩定 tool-registry contract** — `register({ name, description, level, category, inputSchema, handler })` 形狀固定。

**不**鎖定的範圍：
- `src/` 內部模組邊界。沒暴露在 CLI / HTTP / config / SKILL.md / tool-registry 的東西都能自由調整。
- Dashboard UI (`/v2/*`) — 持續迭代。
- 未寫進文件的行為。文件沒寫的不算公開契約。

## 1.0 前的待辦

- [x] 10 家 LLM provider + SSE streaming
- [x] 三層記憶 + pgvector
- [x] SQLite + PostgreSQL 雙 adapter
- [x] Command safety（35+ patterns）
- [x] Prompt injection 防護（7 patterns）
- [x] DAG Workflow engine
- [x] Skills auto-discovery
- [x] MCP client
- [x] Eval framework
- [x] Portable tarball（macOS arm64 / Linux x64）
- [x] 中英文件對稱（README / getting-started / core-guide / FAQ / distribution / config-reference）
- [x] GitHub issue + PR template
- [x] `examples/` 每個加 one-command smoke（`examples/*/smoke.sh`）
- [x] CI matrix 覆蓋 macOS arm64 + Linux x64 + Node 20/22/24
- [x] `docs/migration/1.0.md` — 與 0.9.x 的 API 變更
- [ ] 對外 Discord / 討論頻道
- [ ] Intel Mac tarball（另排時程；GitHub-hosted macos-13 runner 排隊是 blocker）

## 怎麼跟進

- **npm**：`npm install -g helix-agent-framework`
- **CHANGELOG**：[`CHANGELOG.md`](../CHANGELOG.md)
- **Issues**：走 `.github/ISSUE_TEMPLATE/` 裡的 bug / feature template
- **PRs**：照 `.github/PULL_REQUEST_TEMPLATE.md`

如果你正在基於 Helix 寫東西，開一個 issue 描述你的場景 — 1.0 的穩定承諾要把它涵蓋進去。
