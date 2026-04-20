# Chatbot Example

[繁體中文](./README.zh-TW.md)

Minimal single-agent setup. Good first contact with Helix.

## Run

```bash
helix login --provider gemini --api-key YOUR_KEY
helix start
```

Then either:

- **Web**: open http://localhost:18860/v2/ → spawn `assistant` → Send a message
- **CLI**: `helix repl` or `helix agent chat assistant`

## What you get

- Session memory persists across restarts (`.helix/helix.db`)
- Auto-compression when session grows past threshold
- Trace of every message + token usage at `/v2/debug.html`

## Customize

Edit `helix.config.js`:

- Change `model` to `claude-sonnet-4-6`, `gpt-4o`, etc. (provider auto-detected from name)
- Change `apiKeyEnv` to match
- Rewrite `systemPrompt` to give your agent a different personality

## Reset

```bash
# In CLI: type /reset
# Or remove DB:
rm -rf .helix/
```
