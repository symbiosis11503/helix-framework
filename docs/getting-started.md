# Getting Started

## What is Helix?

Helix is a local-first AI agent framework. It gives your agents tools, memory, reasoning, and governance — all running on your machine with zero cloud dependency.

## Quick Install

```bash
# Install globally
npm install -g helix-agent-framework

# Or use npx
npx helix-agent-framework init
```

## 1. Initialize a Project

```bash
mkdir my-agent && cd my-agent
helix init
```

This creates:
- `helix.config.js` — configuration
- `data/skills/` — skill definitions
- `.helix/` — runtime data (SQLite DB, logs)

## 2. Set Your API Key

```bash
helix login
```

Enter your API key (Gemini, OpenAI, or Anthropic). Or set it manually:

```bash
# In helix.config.js
export default {
  model: 'gemini-2.5-flash',
  apiKeyEnv: 'GEMINI_API_KEY',
};
```

```bash
# In your shell
export GEMINI_API_KEY=your-key-here
```

## 3. Start the Runtime

```bash
helix start
```

Output:
```
[helix-lite] Helix Agent Runtime vX.Y.Z (lite mode)
[helix-lite] http://127.0.0.1:18860
[helix-lite] Built-in hooks registered (command-safety, injection-defense)
```

## 4. Chat with an Agent

```bash
helix agent chat default
```

Or via API:
```bash
curl -X POST http://localhost:18860/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"agent": "default", "message": "Hello, what can you do?"}'
```

## 5. Check Health

```bash
helix doctor
```

```
🩺 Helix Doctor
  ✅ Node.js: v22.x
  ✅ API Key: gemini
  ✅ better-sqlite3: available
  ✅ Shared Core: 21/21 modules
```

## Core Concepts

### Agents
Agents are AI entities that can chat, use tools, remember context, and execute tasks.

```bash
# List agents
curl http://localhost:18860/api/agents/instances

# Spawn a new agent
curl -X POST http://localhost:18860/api/agent/chat \
  -d '{"agent": "researcher", "message": "Find info about Node.js 22"}'
```

### Sessions & Memory
Every conversation is persisted. Agents remember across sessions.

```bash
# View sessions
curl http://localhost:18860/api/sessions?agent_id=default

# Search memory
curl -X POST http://localhost:18860/api/memory/v2/recall \
  -d '{"agent_id": "default", "query": "what did we discuss?"}'
```

### Skills
Skills are markdown files that teach agents new abilities.

Create `data/skills/research/web-search/SKILL.md`:
```markdown
---
name: web-search
description: Search the web for information
tags: [web, search]
---
# Instructions
Search the web for the given query and return structured results.
```

Skills are auto-discovered on startup.

### Tools
Tools are programmatic capabilities. Use the tool registry:

```bash
# List available tools
curl http://localhost:18860/api/tools

# Execute a tool
curl -X POST http://localhost:18860/api/tools/execute \
  -d '{"name": "shell_exec", "params": {"command": "echo hello"}}'
```

### Reasoning
For complex tasks, use the reasoning loop (Plan → Act → Observe):

```bash
curl -X POST http://localhost:18860/api/agent/reason \
  -d '{"task": "Analyze the current directory structure and suggest improvements"}'
```

### Streaming
Get real-time responses via Server-Sent Events:

```bash
curl -N -X POST http://localhost:18860/api/agent/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"agent": "default", "message": "Write a haiku about coding"}'
```

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

## Evaluation & Benchmarks

Run built-in safety and quality benchmarks:

```bash
# Via CLI (works offline — no server needed)
helix eval run command-safety
helix eval run prompt-injection

# View history
helix eval history
```

```bash
# Via API
curl -X POST http://localhost:18860/api/eval/run \
  -H "Content-Type: application/json" \
  -d '{"suite": "command-safety"}'
```

Available suites: `command-safety` (11 cases), `prompt-injection` (12 cases), `memory-recall` (3 cases).

## Security

Helix includes built-in security:
- **Command Safety** — blocks dangerous shell commands (rm -rf, DROP TABLE, etc.)
- **Prompt Injection Defense** — detects injection attempts in prompts
- **2FA** — TOTP-based two-factor authentication
- **RBAC** — role-based access control (admin/operator/viewer)

## Dashboard

Access the web dashboard at `http://localhost:18860/v2/`:
- **System Overview** — agent count, tasks, memory stats, tools
- **Quick Actions** — spawn agents, chat, run evals
- **Debug Tools** — trace viewer, reasoning inspector, memory explorer (`/v2/debug.html`)

## Next Steps

- [Core Guide](./core-guide.md) — Deep dive into each module
- [Config Reference](./CONFIG_REFERENCE.md) — All configuration options
- [FAQ](./FAQ.md) — Common questions
- [Examples](../examples/) — Copy-paste-ready sample agents (chatbot / research / cmd-runner)
