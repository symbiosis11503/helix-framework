# Helix — Local-first AI Agent Framework

[![npm version](https://img.shields.io/npm/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![node](https://img.shields.io/node/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![license](https://img.shields.io/npm/l/helix-agent-framework.svg)](./LICENSE)

**[繁體中文版 →](./README.zh-TW.md)**

> Build and run AI agents locally. No cloud required, no PostgreSQL required.

Helix is a standalone AI agent framework for project workspaces. It runs entirely on your machine with SQLite — no external services needed.

## Install

```bash
npm install -g helix-agent-framework
```

See [distribution paths](./docs/distribution.md) for all options (npm / portable tarball / PWA / planned Tauri desktop).

## Quick Start

```bash
# 1. Initialize project
helix init

# 2. Set your API key
helix login --provider gemini --api-key YOUR_KEY

# 3. Start the runtime
helix start

# Open http://localhost:18860/v2/
```

## What You Get

- **Agent Runtime** — Spawn, manage, and run AI agents with persistent memory
- **10 LLM Providers** — Gemini, Claude, OpenAI, Kimi, Mistral, DeepSeek, Groq, Qwen, OpenRouter, Ollama
- **SSE Streaming** — Real-time streaming for all providers
- **Plan-Act-Observe Reasoning** — Recursive decision loop with tool execution
- **Three-tier Memory** — Episodic/semantic/procedural with importance decay and pgvector support
- **Session Store** — Per-message persistence with FTS search and auto-compression
- **Workflow Engine** — DAG-based with parallel branches and conditional logic
- **Delegation OS** — Isolated child agents with tool restrictions and depth limits
- **Knowledge Governance** — Atom CRUD with promotion pipeline and deterministic lint
- **Command Safety** — 35+ dangerous patterns with Unicode normalization
- **Prompt Injection Defense** — 7 detection patterns with hook integration
- **2FA / RBAC / OAuth** — TOTP authenticator, role-based access, multi-provider OAuth 2.0
- **Eval Framework** — Built-in benchmarks with regression gates
- **Messaging Integration** — Telegram, Discord, LINE, Slack adapters
- **Alerting** — Rule-based alerts with webhook/email/log channels
- **Observability** — Run/Span/Metrics tracing
- **MCP Client** — Connect to any MCP server (stdio transport)
- **Skills System** — Markdown-based skill definitions with auto-discovery
- **Dashboard** — Web UI with debug tools

## CLI Commands

| Command | Description |
|---------|-------------|
| `helix init` | Initialize project scaffold |
| `helix login` | Configure API key |
| `helix start` | Start agent runtime |
| `helix doctor` | Check environment (21 modules) |
| `helix status` | Show runtime status |
| `helix agent list` | List all agents |
| `helix agent chat [id]` | Interactive chat with agent |
| `helix memory stats [id]` | Memory statistics |
| `helix memory recall <id> <q>` | Search agent memory |
| `helix gateway status` | Messaging platform status |
| `helix eval run [suite]` | Run benchmark (command-safety, prompt-injection, memory-recall) |
| `helix eval history` | View eval history |
| `helix export` | Export workspace data (JSON) |
| `helix import <file>` | Import workspace data |

## Supported LLM Providers

| Provider | Model Examples | Env Variable |
|----------|---------------|-------------|
| Google Gemini | gemini-2.5-flash | GEMINI_API_KEY |
| Anthropic | claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o | OPENAI_API_KEY |
| Moonshot Kimi | moonshot-v1-128k | KIMI_API_KEY |
| Mistral | mistral-large-latest | MISTRAL_API_KEY |
| DeepSeek | deepseek-chat | DEEPSEEK_API_KEY |
| Groq | llama-3.3-70b | GROQ_API_KEY |
| Qwen | qwen-max | QWEN_API_KEY |
| OpenRouter | any model | OPENROUTER_API_KEY |
| Local (Ollama) | ollama/llama3 | (none needed) |

## Architecture

```
helix start
  └── server-lite.js (Express + SQLite)
        ├── db.js              — PG/SQLite dual adapter
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
        ├── gateway-adapter.js — TG/DC/LINE/Slack adapters
        ├── auth.js            — RBAC (admin/operator/viewer)
        ├── two-factor.js      — TOTP 2FA
        ├── oauth.js           — OAuth 2.0 multi-provider
        ├── alerts.js          — Rule-based alerting
        ├── trace-lite.js      — Run/Span/Metrics tracing
        ├── eval-lite.js       — Benchmark runner + regression gate
        ├── edit-tool.js       — File edit (exact string match)
        └── mcp-client.js      — MCP client (stdio)
```

21 shared-core modules, ~100 KB packaged.

## Version

0.9.1

## License

MIT
