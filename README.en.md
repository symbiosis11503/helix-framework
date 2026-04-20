# Helix — Local-first AI Agent Framework

> Build and run AI agents locally. No cloud required, no PostgreSQL required.

Helix is a standalone AI agent framework for project workspaces. It runs entirely on your machine with SQLite — no external services needed.

## Install

```bash
npm install -g helix-agent-framework
```

## Quick Start

```bash
# 1. Initialize project
helix init

# 2. Set your API key
helix login --provider gemini --api-key YOUR_KEY

# 3. Start the runtime
helix start

# Open http://localhost:18860
```

## Features

- **Agent Runtime** — Spawn, manage, and run AI agents with persistent memory
- **Agent Chat** — LLM-powered conversations with session continuity (Gemini/Claude/OpenAI)
- **Session Store** — Per-message conversation persistence with FTS search and auto-compression
- **Task Queue** — Create, assign, and track tasks across agents
- **Memory System** — Per-agent episodic memory with search and recall
- **Workflow Engine** — DAG-based workflow execution with parallel branches
- **Delegation** — Isolated child agent execution with tool restrictions and depth limits
- **Command Safety** — 35+ dangerous pattern detection with Unicode normalization
- **Hook Lifecycle** — Interceptable before/after hooks with prompt injection defense
- **Tool Registry** — Dynamic tool registration with capability binding
- **MCP Client** — Connect to external MCP servers via stdio transport
- **Edit Tool** — Exact string match file editing with uniqueness check
- **Dashboard** — Web UI at localhost:18860

## Supported LLM Providers

| Provider | Models | API Key Env |
|----------|--------|-------------|
| Gemini (default) | gemini-2.5-flash, gemini-2.5-pro | GEMINI_API_KEY |
| Claude | claude-sonnet-4-6, claude-haiku-4-5 | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o, gpt-4o-mini | OPENAI_API_KEY |

Provider is auto-detected from model name.

## CLI Commands

| Command | Description |
|---------|-------------|
| `helix init` | Initialize project scaffold |
| `helix login` | Configure API key |
| `helix start` | Start agent runtime (SQLite) |
| `helix doctor` | Check environment (8 modules) |
| `helix status` | Show runtime status |
| `helix agent list` | List all agents |
| `helix agent chat [id]` | Interactive chat with agent |

## Architecture

```
helix start
  └── server-lite.js (Express + SQLite)
        ├── db.js            — PG/SQLite dual adapter
        ├── session-store.js — Context OS (sessions, messages, FTS, compression)
        ├── delegation.js    — Delegation OS (child isolation, depth limits)
        ├── command-safety.js — Execution Safety (35+ danger patterns)
        ├── hooks.js         — Hook Lifecycle (interceptable before/after)
        ├── edit-tool.js     — Edit Tool (exact string match)
        ├── mcp-client.js   — MCP Client (stdio transport)
        ├── llm-provider.js — Multi-provider LLM
        └── tool-registry.js — Tool Registry
```

## Security

- L1/L2/L3 tool permission levels with interrupt-resume approval
- Hook lifecycle can abort any tool call
- Command safety engine with 35+ dangerous patterns
- Prompt injection defense (7 patterns)
- WebSocket authentication (external connections require token)
- Admin auth with HttpOnly cookie support
- CSP headers (object-src none, frame-ancestors self)

## License

MIT
