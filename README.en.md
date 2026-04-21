# Helix — Local-first AI Agent Framework

[![npm version](https://img.shields.io/npm/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![node](https://img.shields.io/node/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![license](https://img.shields.io/npm/l/helix-agent-framework.svg)](./LICENSE)

**English** · [繁體中文](./README.zh-TW.md)

> Build and run AI agents locally. No cloud required, no PostgreSQL required.

Helix is a standalone AI agent framework for project workspaces. It runs entirely on your machine with SQLite — no external services, no account sign-up, no vendor lock-in.

## Install

```bash
npm install -g helix-agent-framework
```

See [distribution paths](./docs/distribution.md) for all options — npm, portable tarball (macOS / Linux / Windows), PWA install, and the planned Tauri desktop shell.

## Quick Start

```bash
# 1. Initialize the project scaffold
helix init

# 2. Set an API key (any supported provider works)
helix login --provider gemini --api-key YOUR_KEY

# 3. Start the local runtime
helix start

# Open http://localhost:18860/v2/
```

That's the whole bootstrap. No database to install, no cloud service to sign up for.

## What You Get

- **Agent Runtime** — spawn, manage, and run AI agents with persistent memory
- **10 LLM Providers** — Gemini, Claude, OpenAI, Kimi, Mistral, DeepSeek, Groq, Qwen, OpenRouter, Ollama (auto-detected from model name)
- **SSE Streaming** — real-time streaming for every provider
- **Plan-Act-Observe Reasoning** — recursive decision loop with tool execution
- **Three-tier Memory** — episodic / semantic / procedural with importance decay and optional pgvector
- **Session Store** — per-message persistence with FTS search and automatic compression
- **Workflow Engine** — DAG-based execution with parallel branches and conditional logic
- **Delegation OS** — isolated child agents with tool restrictions and depth limits
- **Knowledge Governance** — atom CRUD with promotion pipeline and deterministic lint
- **Command Safety** — 35+ dangerous patterns detected with Unicode normalization
- **Prompt Injection Defense** — 7 detection patterns integrated into the hook lifecycle
- **2FA / RBAC / OAuth** — TOTP authenticator, role-based access, multi-provider OAuth 2.0
- **Eval Framework** — built-in benchmarks with regression gates
- **Messaging Integration** — Telegram, Discord, LINE, Slack adapters
- **Alerting** — rule-based alerts with webhook / email / log channels
- **Observability** — Run / Span / Metrics tracing
- **MCP Client** — connect to any MCP server over stdio transport
- **Skills System** — Markdown-based skill definitions with auto-discovery
- **Dashboard** — web UI with debug tools at localhost:18860

## CLI Commands

| Command | Description |
|---------|-------------|
| `helix init` | Initialize project scaffold |
| `helix login` | Configure an API key |
| `helix start` | Start the agent runtime |
| `helix doctor` | Check environment (21 modules) |
| `helix status` | Show runtime status |
| `helix agent list` | List all agents |
| `helix agent chat [id]` | Interactive chat with an agent |
| `helix memory stats [id]` | Show memory statistics |
| `helix memory recall <id> <query>` | Search agent memory |
| `helix gateway status` | Messaging platform status |
| `helix eval run [suite]` | Run a benchmark (`command-safety`, `prompt-injection`, `memory-recall`) |
| `helix eval history` | View eval history |
| `helix export` | Export workspace data (JSON) |
| `helix import <file>` | Import workspace data |
| `helix workstation run "<goal>"` | Submit a task to a VPS-OC Manus workstation (live-poll for result) |
| `helix workstation health` | Workstation + brain-bridge status |
| `helix workstation capabilities` | List runtime tools and available brain models |

## Supported LLM Providers

| Provider | Model Examples | Env Variable |
|----------|---------------|-------------|
| Google Gemini | `gemini-2.5-flash`, `gemini-2.5-pro` | `GEMINI_API_KEY` |
| Anthropic | `claude-sonnet-4-6`, `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |
| Moonshot Kimi | `moonshot-v1-128k` | `KIMI_API_KEY` |
| Mistral | `mistral-large-latest` | `MISTRAL_API_KEY` |
| DeepSeek | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| Groq | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| Qwen | `qwen-max` | `QWEN_API_KEY` |
| OpenRouter | any model | `OPENROUTER_API_KEY` |
| Local (Ollama) | `ollama/llama3` | — |

Provider is auto-detected from the model name. Any OpenAI-compatible endpoint can be swapped in via `baseUrl`.

## Architecture

```
helix start
  └── server-lite.js (Express + SQLite)
        ├── db.js              — PG / SQLite dual adapter
        ├── llm-provider.js    — 10 LLM providers + SSE streaming
        ├── agent-reasoning.js — Plan-Act-Observe loop
        ├── agent-autonomy.js  — Long tasks + self-optimization + discovery
        ├── session-store.js   — Context OS (sessions, compression)
        ├── memory-manager.js  — Three-tier memory + pgvector
        ├── delegation.js      — Delegation OS (child isolation)
        ├── workflow.js        — DAG workflow engine
        ├── knowledge.js       — Knowledge atom governance
        ├── skills.js          — Skill auto-discovery
        ├── tool-registry.js   — Tool manifest + execution
        ├── command-safety.js  — Shell command safety (35+ patterns)
        ├── hooks.js           — Interceptable lifecycle hooks
        ├── gateway-adapter.js — Telegram / Discord / LINE / Slack adapters
        ├── auth.js            — RBAC (admin / operator / viewer)
        ├── two-factor.js      — TOTP 2FA
        ├── oauth.js           — OAuth 2.0 multi-provider
        ├── alerts.js          — Rule-based alerting
        ├── trace-lite.js      — Run / Span / Metrics tracing
        ├── eval-lite.js       — Benchmark runner + regression gate
        ├── edit-tool.js       — File edit (exact string match)
        └── mcp-client.js      — MCP client (stdio)
```

21 shared-core modules, ~100 KB packaged.

## Security

- L1 / L2 / L3 tool permission levels with interrupt-resume approval
- Hook lifecycle can abort any tool call before execution
- Command safety engine with 35+ dangerous patterns
- Prompt injection defense (7 detection patterns)
- WebSocket authentication (external connections require a token)
- Admin auth with HttpOnly cookie support
- CSP headers (`object-src 'none'`, `frame-ancestors 'self'`)

## Docs

- [Getting Started](./docs/getting-started.md) — longer walk-through
- [Core Guide](./docs/core-guide.md) — module-by-module reference
- [Config Reference](./docs/CONFIG_REFERENCE.md)
- [FAQ](./docs/FAQ.md)
- [Distribution](./docs/distribution.md)
- [Examples](./examples/) — `chatbot`, `cmd-runner`, `research-agent`

## Version

0.10.0 — see [CHANGELOG](./CHANGELOG.md)

## License

MIT
