# Research Agent Example

[繁體中文](./README.zh-TW.md)

Multi-step agent with web search, long-term memory, and skill invocation.

## Run

```bash
helix login --provider claude --api-key YOUR_KEY
helix start
```

Then:

```bash
helix agent chat researcher
> 研究一下 2026 年主流開源 AI Agent 框架的差異
```

## What you get

- **Web search skill** — built-in, no API key needed for basic queries
- **Three-tier memory** — researcher remembers prior work across restarts
- **Memory recall** — cite past findings before re-searching
- **Structured output** — notes saved to episodic memory per finding

## Inspect memory

```bash
# CLI
helix memory stats researcher
helix memory recall researcher "agent framework"

# Web
# Open http://localhost:18860/v2/ → stats card shows entry count
```

## Customize

- `agents[].systemPrompt` — change the research methodology
- `skills.enabled` — drop `web-search` if you want a pure reasoning agent
- `memory.decay` — `false` to keep all memories forever

## Tune for your domain

For deep-dive research in one area, raise `importance` thresholds in the system prompt so only high-signal findings become semantic memory. For broad scanning, lower them.
