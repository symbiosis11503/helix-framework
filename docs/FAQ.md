# Helix FAQ

## Installation

### `npm install` fails with "better-sqlite3" build error
```bash
# Install build tools first
# macOS:
xcode-select --install
# Ubuntu/Debian:
sudo apt-get install build-essential python3
# Then retry:
npm install -g helix-agent-framework
```

### `helix init` says "SyntaxError: Unexpected token 'export'"
Your project needs ESM support. Run `helix init` again — it will automatically set `"type": "module"` in your `package.json`.

If you already have a `package.json` with `"type": "commonjs"`, `helix init` will change it to `"module"`. This is required because `helix.config.js` uses `export default`.

---

## Configuration

### How do I switch LLM providers?
Edit `helix.config.js`:
```js
export default {
  model: 'claude-sonnet-4-6',  // or 'gpt-4o', 'gemini-2.5-flash'
  apiKeyEnv: 'ANTHROPIC_API_KEY',  // auto-detected from model name
};
```

Then set the API key:
```bash
helix login --provider claude --api-key YOUR_KEY
```

Provider is auto-detected from model name. You can also set per-agent models in the `agents` array.

### Where are API keys stored?
In `~/.helix/auth.json` (machine-level, not in your project). File permissions are set to 600 (owner-only read/write).

### Can I use multiple providers at once?
Yes. Each agent can have its own `model` and `key_env`:
```js
agents: [
  { id: 'assistant', model: 'gemini-2.5-flash' },
  { id: 'reviewer', model: 'claude-sonnet-4-6', key_env: 'ANTHROPIC_API_KEY' },
]
```

---

## Runtime

### Port 18860 is already in use
```bash
helix start --port 18899
```

### `helix doctor` shows "better-sqlite3 not installed"
```bash
npm install better-sqlite3
```

### How do I reset an agent's conversation?
```bash
# Via CLI:
helix agent chat assistant
# Then type:
/reset

# Via API:
curl -X POST http://localhost:18860/api/agent/reset-session \
  -H "Content-Type: application/json" \
  -d '{"agent":"assistant"}'
```

### Agent chat returns "[no API key: GEMINI_API_KEY]"
Run `helix login` to set your API key, or set the environment variable directly:
```bash
export GEMINI_API_KEY=your-key-here
helix start
```

---

## Database

### Can I use PostgreSQL instead of SQLite?
Yes. Edit `helix.config.js`:
```js
database: {
  type: 'pg',
  pg: { host: 'localhost', port: 5432, user: 'helix', database: 'helix', password: '...' }
}
```

### Where is the SQLite database?
At `.helix/helix.db` in your project directory. This directory is automatically gitignored.

### How do I backup my data?
```bash
cp .helix/helix.db .helix/helix.db.backup
```

---

## Security

### What is the admin token?
Set `ADMIN_TOKEN` environment variable to protect admin API endpoints:
```bash
ADMIN_TOKEN=your-secret-token helix start
```

Without it, admin endpoints are open. With it, requests need `Authorization: Bearer <token>` or `X-Admin-Token: <token>` header.

### How does command safety work?
Helix inspects shell commands for 35+ dangerous patterns (rm -rf, DROP TABLE, git push --force, etc.) before execution. Dangerous commands are blocked; risky ones require approval.

---

## Troubleshooting

### Dashboard shows "loading..." and never loads
1. Check if the server is running: `curl http://localhost:18860/api/health`
2. Check browser console for errors
3. Try hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

### "Database not initialized" error
Make sure you're running from a directory with `helix.config.js`. Run `helix init` if needed.

### Session compression not working
Compression requires a Gemini API key (for LLM-powered summarization). Without it, a fallback concatenation method is used. Set `GEMINI_API_KEY` for better compression.
