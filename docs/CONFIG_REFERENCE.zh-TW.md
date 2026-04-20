# Helix 設定檔參考

[English](./CONFIG_REFERENCE.md)

## helix.config.js

```js
export default {
  // LLM 模型 — 依模型名稱自動偵測 provider
  // Gemini: 'gemini-2.5-flash', 'gemini-2.5-pro'
  // Claude: 'claude-sonnet-4-6', 'claude-haiku-4-5'
  // OpenAI: 'gpt-4o', 'gpt-4o-mini'
  model: 'gemini-2.5-flash',

  // API key 環境變數名 — 省略則依模型名自動推斷
  // Gemini: GEMINI_API_KEY
  // Claude: ANTHROPIC_API_KEY
  // OpenAI: OPENAI_API_KEY
  apiKeyEnv: 'GEMINI_API_KEY',

  // 資料庫 — SQLite（預設）或 PostgreSQL
  database: {
    type: 'sqlite',           // 'sqlite' | 'pg'
    path: '.helix/helix.db',  // SQLite 檔案路徑
    // pg: { host: 'localhost', port: 5432, user: 'helix', database: 'helix', password: '...' }
  },

  // Agent 角色定義
  agents: [
    {
      id: 'assistant',
      name: '助理',
      systemPrompt: '你是一個友善的 AI 助理。',
      // model: 'claude-sonnet-4-6',  // 單一 agent 覆寫
      // key_env: 'ANTHROPIC_API_KEY', // 單一 agent 覆寫
    },
  ],

  // Server 設定
  server: {
    port: 18860,
    host: '127.0.0.1',
  },
};
```

## ~/.helix/auth.json

由 `helix login` 寫入，儲存各 provider 的 API key。

```json
{
  "GEMINI_API_KEY": "your-key-here",
  "provider": "gemini",
  "updated_at": "2026-04-19T00:00:00.000Z"
}
```

多個 provider 可同時並存：

```json
{
  "GEMINI_API_KEY": "...",
  "ANTHROPIC_API_KEY": "...",
  "OPENAI_API_KEY": "...",
  "provider": "gemini",
  "updated_at": "..."
}
```

## 環境變數

| 變數 | 說明 | 必要 |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key | 用 Gemini 時必要 |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | 用 Claude 時必要 |
| `OPENAI_API_KEY` | OpenAI API key | 用 OpenAI 時必要 |
| `ADMIN_TOKEN` | Admin API 認證 token | 建議設定 |

## 檔案位置

| 路徑 | 說明 | Git 追蹤？ |
|---|---|---|
| `helix.config.js` | 專案設定檔 | 是 |
| `.helix/` | SQLite DB + 本地快取 | 否 |
| `~/.helix/auth.json` | API keys（機器層級） | 否 |
| `CLAUDE.md` | AI 工作流指南 | 是 |
| `AI_CONTEXT.md` | 專案背景 | 是 |
| `.agents/memory.md` | Agent 記憶 | 是 |
| `.agents/skills/` | SOP 模板 | 是 |
| `docs/` | 知識庫 | 是 |
