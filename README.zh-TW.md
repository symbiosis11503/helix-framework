# Helix — 本地優先的 AI Agent 框架

[![npm version](https://img.shields.io/npm/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![node](https://img.shields.io/node/v/helix-agent-framework.svg)](https://www.npmjs.com/package/helix-agent-framework)
[![license](https://img.shields.io/npm/l/helix-agent-framework.svg)](./LICENSE)

**[English →](./README.md)**

> 繁中介面 × 輕量系統 × 簡單直覺。在你自己的機器上建立並執行 AI Agent，不需雲端、不需 PostgreSQL。

Helix 是為專案工作區設計的獨立 AI Agent 框架，完全在本機用 SQLite 執行，不依賴任何外部服務。

## 安裝

```bash
npm install -g helix-agent-framework
```

## 快速開始

```bash
# 1. 初始化專案骨架
helix init

# 2. 設定 API key（自動依模型名稱偵測 provider）
helix login --provider gemini --api-key YOUR_KEY

# 3. 啟動 runtime
helix start

# 開啟 http://localhost:18860/v2/
```

## 功能總覽

- **Agent Runtime** — Spawn / manage / chat 多個 agent 實例，含持久化記憶
- **10 家 LLM 支援** — Gemini、Claude、OpenAI、Kimi、Mistral、DeepSeek、Groq、Qwen、OpenRouter、Ollama
- **SSE 串流** — 所有 provider 即時串流
- **Plan-Act-Observe 推理** — 遞迴決策迴圈 + 工具執行
- **三層記憶** — Episodic / Semantic / Procedural，含重要性衰減與 pgvector 支援
- **Session Store** — 逐訊息持久化 + FTS 全文搜尋 + 自動壓縮
- **Workflow 引擎** — 基於 DAG，支援平行分支與條件邏輯
- **Delegation OS** — 隔離的子 agent，工具白名單 + 遞迴深度限制
- **知識治理** — Atom CRUD + 提升管線 + 確定性 lint
- **指令安全** — 35+ 危險 pattern 偵測 + Unicode 正規化
- **Prompt Injection 防禦** — 7 種 pattern + hook 整合
- **2FA / RBAC / OAuth** — TOTP 雙因素、角色權限、多家 OAuth 2.0
- **Eval 框架** — 內建 benchmark + 迴歸閘門
- **訊息平台整合** — Telegram / Discord / LINE / Slack adapter
- **告警** — 規則式告警 + webhook / email / log 通道
- **可觀測性** — Run / Span / Metrics 追蹤
- **MCP Client** — 連接任何 MCP server（stdio transport）
- **Skills 系統** — Markdown 定義的 skill，自動發現
- **Dashboard** — Web UI 含 debug tools，可安裝為 PWA 到 Dock

## CLI 指令

| 指令 | 說明 |
|---|---|
| `helix init` | 初始化專案骨架 |
| `helix login` | 設定 API key |
| `helix start` | 啟動 agent runtime |
| `helix doctor` | 檢查環境（21 模組） |
| `helix status` | 查看 runtime 狀態 |
| `helix agent list` | 列出所有 agent |
| `helix agent chat [id]` | 與 agent 互動對話 |
| `helix memory stats [id]` | 記憶統計 |
| `helix memory recall <id> <q>` | 搜尋 agent 記憶 |
| `helix gateway status` | 訊息平台狀態 |
| `helix eval run [suite]` | 跑 benchmark（command-safety / prompt-injection / memory-recall） |
| `helix eval history` | 查看 eval 歷史 |
| `helix trace runs [--limit N]` | 列出近期 trace runs |
| `helix trace stats [--hours N]` | Trace 統計摘要 |
| `helix export` | 匯出工作區資料（JSON） |
| `helix import <file>` | 匯入工作區資料 |

## 支援的 LLM

| Provider | 範例模型 | 環境變數 |
|---|---|---|
| Google Gemini | gemini-2.5-flash | GEMINI_API_KEY |
| Anthropic | claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o | OPENAI_API_KEY |
| Moonshot Kimi | moonshot-v1-128k | KIMI_API_KEY |
| Mistral | mistral-large-latest | MISTRAL_API_KEY |
| DeepSeek | deepseek-chat | DEEPSEEK_API_KEY |
| Groq | llama-3.3-70b | GROQ_API_KEY |
| Qwen | qwen-max | QWEN_API_KEY |
| OpenRouter | 任何模型 | OPENROUTER_API_KEY |
| 本地（Ollama） | ollama/llama3 | 不需 key |

Provider 依模型名稱前綴自動偵測。

## 架構

```
helix start
  └── server-lite.js (Express + SQLite)
        ├── db.js              — PG/SQLite 雙 adapter
        ├── llm-provider.js    — 10 家 LLM + SSE 串流
        ├── agent-reasoning.js — Plan-Act-Observe 迴圈
        ├── agent-autonomy.js  — 長任務 + 自我優化 + 發現
        ├── session-store.js   — Context OS（sessions、壓縮）
        ├── memory-manager.js  — 三層記憶 + pgvector
        ├── delegation.js      — Delegation OS（子代理隔離）
        ├── workflow.js        — DAG workflow 引擎
        ├── knowledge.js       — 知識 atom 治理
        ├── skills.js          — Skill 自動發現
        ├── tool-registry.js   — 工具 manifest + 執行
        ├── command-safety.js  — Shell 指令安全（35+ pattern）
        ├── hooks.js           — 可攔截生命週期 hook
        ├── gateway-adapter.js — TG/DC/LINE/Slack adapter
        ├── auth.js            — RBAC（admin/operator/viewer）
        ├── two-factor.js      — TOTP 2FA
        ├── oauth.js           — OAuth 2.0 多 provider
        ├── alerts.js          — 規則式告警
        ├── trace-lite.js      — Run/Span/Metrics 追蹤
        ├── eval-lite.js       — Benchmark 執行器 + 迴歸閘門
        ├── edit-tool.js       — 檔案編輯（exact string match）
        └── mcp-client.js      — MCP client（stdio）
```

25 個共享核心模組，打包後 ~121 KB。

## 範例專案

複製貼上就能跑的 3 套範例：

- [`examples/chatbot/`](./examples/chatbot/) — 最小單 agent（Gemini）
- [`examples/research-agent/`](./examples/research-agent/) — 多步驟研究助手（Claude + 三層記憶 + 工具）
- [`examples/cmd-runner/`](./examples/cmd-runner/) — 執行 shell 的 agent（OpenAI + safety hook）

## 更多文件

- [快速開始指南](./docs/getting-started.md)
- [核心模組導覽](./docs/core-guide.md)
- [設定檔參考](./docs/CONFIG_REFERENCE.md)
- [常見問題](./docs/FAQ.md)

## 版本

0.8.1

## 授權

MIT
