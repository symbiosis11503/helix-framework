# Helix Examples

[繁體中文](./README.zh-TW.md)

Three copy-paste-ready sample agents. Each subdirectory is a self-contained project — copy it out, run `helix start`, and you have a working agent.

## Which one to start with

| Example | Best for | Stack |
|---|---|---|
| [chatbot/](./chatbot/) | Simplest — a single conversational agent | Gemini, session memory |
| [research-agent/](./research-agent/) | Multi-step with tools and long-term memory | Claude, memory-v2, skills |
| [cmd-runner/](./cmd-runner/) | Agent that runs shell commands with safety guards | OpenAI, command-safety hook |

## How to use one

```bash
# 1. Install helix (once)
npm install -g helix-agent-framework

# 2. Copy the example
cp -r node_modules/helix-agent-framework/examples/chatbot my-bot
cd my-bot

# 3. Set API key + start
helix login --provider gemini --api-key YOUR_KEY
helix start

# Open http://localhost:18860/v2/
```

Or, from a clone of this repo:

```bash
cd examples/chatbot
helix login --provider gemini --api-key YOUR_KEY
helix start
```

## Smoke test (verify your install)

Each example ships a `smoke.sh` that checks config parse + CLI reachability + runtime boot. Safe to run in CI.

```bash
bash examples/chatbot/smoke.sh
bash examples/cmd-runner/smoke.sh
bash examples/research-agent/smoke.sh
```

If no API key is set, the script verifies the static parts (config, CLI, doctor) and skips the runtime-boot step rather than failing.

## Building your own

After running an example, copy its `helix.config.js` into your own project directory and customize `agents[]`, `skills[]`, and `hooks[]` to fit.

Full config reference: [`docs/CONFIG_REFERENCE.md`](../docs/CONFIG_REFERENCE.md).
