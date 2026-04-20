# Contributing to Helix

[繁體中文](./CONTRIBUTING.zh-TW.md)

Thank you for your interest in contributing to Helix!

## Getting Started

```bash
git clone https://github.com/symbiosis-tw/helix-framework.git
cd helix-framework
npm install
```

## Development

```bash
# Start dev server
node bin/helix.js start --port 18899

# Run tests
node --test tests/

# Check syntax
node --check src/*.js
```

## Project Structure

```
bin/helix.js          — CLI entry point
src/
  db.js               — PG/SQLite dual adapter
  server-lite.js      — Express server (33+ endpoints)
  session-store.js    — Context OS
  delegation.js       — Delegation OS
  command-safety.js   — Execution Safety
  hooks.js            — Hook Lifecycle
  edit-tool.js        — Edit Tool
  mcp-client.js       — MCP Client
  llm-provider.js     — Multi-provider LLM
  tool-registry.js    — Tool Registry
```

## Guidelines

- **Shared Core modules** must work with both PG and SQLite
- All tool execution must go through the hook pipeline
- Use `esc()` or `_esc()` for HTML output (XSS prevention)
- Use `toast.*()` instead of `alert()` in frontend pages
- Test with `helix doctor` after changes

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `node --test tests/`
5. Submit a PR with a clear description

## License

MIT
