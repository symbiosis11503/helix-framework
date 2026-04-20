# Helix Configuration Reference

## helix.config.js

```js
export default {
  // LLM model — auto-detects provider from name
  // Gemini: 'gemini-2.5-flash', 'gemini-2.5-pro'
  // Claude: 'claude-sonnet-4-6', 'claude-haiku-4-5'
  // OpenAI: 'gpt-4o', 'gpt-4o-mini'
  model: 'gemini-2.5-flash',

  // API key env var — auto-detected from model if omitted
  // Gemini: GEMINI_API_KEY
  // Claude: ANTHROPIC_API_KEY
  // OpenAI: OPENAI_API_KEY
  apiKeyEnv: 'GEMINI_API_KEY',

  // Database — SQLite (default) or PostgreSQL
  database: {
    type: 'sqlite',           // 'sqlite' | 'pg'
    path: '.helix/helix.db',  // SQLite file path
    // pg: { host: 'localhost', port: 5432, user: 'helix', database: 'helix', password: '...' }
  },

  // Agent role definitions
  agents: [
    {
      id: 'assistant',
      name: 'Assistant',
      systemPrompt: 'You are a helpful AI assistant.',
      // model: 'claude-sonnet-4-6',  // override per agent
      // key_env: 'ANTHROPIC_API_KEY', // override per agent
    },
  ],

  // Server settings
  server: {
    port: 18860,
    host: '127.0.0.1',
  },
};
```

## ~/.helix/auth.json

Stored by `helix login`. Contains API keys per provider.

```json
{
  "GEMINI_API_KEY": "your-key-here",
  "provider": "gemini",
  "updated_at": "2026-04-19T00:00:00.000Z"
}
```

Multiple providers can coexist:

```json
{
  "GEMINI_API_KEY": "...",
  "ANTHROPIC_API_KEY": "...",
  "OPENAI_API_KEY": "...",
  "provider": "gemini",
  "updated_at": "..."
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key | If using Gemini |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | If using Claude |
| `OPENAI_API_KEY` | OpenAI API key | If using OpenAI |
| `ADMIN_TOKEN` | Admin API authentication | Recommended |

## File Locations

| Path | Description | Git tracked? |
|------|-------------|-------------|
| `helix.config.js` | Project configuration | Yes |
| `.helix/` | SQLite DB + local cache | No |
| `~/.helix/auth.json` | API keys (machine-level) | No |
| `CLAUDE.md` | AI workflow guide | Yes |
| `AI_CONTEXT.md` | Project context | Yes |
| `.agents/memory.md` | Agent memory | Yes |
| `.agents/skills/` | SOP templates | Yes |
| `docs/` | Knowledge base | Yes |
