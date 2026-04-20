# 快速開始

[English](./getting-started.md)

## Helix 是什麼？

Helix 是一套 local-first 的 AI Agent 框架。它把工具、記憶、推理與治理能力整合在一起，全部都可以直接跑在你的機器上，不必依賴雲端後端才能開始使用。

## 快速安裝

```bash
# 全域安裝
npm install -g helix-agent-framework

# 或直接用 npx
npx helix-agent-framework init
```

## 1. 初始化專案

```bash
mkdir my-agent && cd my-agent
helix init
```

這會建立：
- `helix.config.js` — 設定檔
- `data/skills/` — 技能定義
- `.helix/` — runtime 資料（SQLite、logs）

## 2. 設定 API Key

```bash
helix login
```

依提示輸入你的 API key（Gemini、OpenAI 或 Anthropic）。也可以手動設定：

```bash
# 在 helix.config.js
export default {
  model: 'gemini-2.5-flash',
  apiKeyEnv: 'GEMINI_API_KEY',
};
```

```bash
# 在 shell 中
export GEMINI_API_KEY=***
```

## 3. 啟動 Runtime

```bash
helix start
```

輸出範例：
```bash
[helix-lite] Helix Agent Runtime vX.Y.Z (lite mode)
[helix-lite] http://127.0.0.1:18860
[helix-lite] Built-in hooks registered (command-safety, injection-defense)
```

## 4. 和 Agent 對話

```bash
helix agent chat default
```

或用 API：
```bash
curl -X POST http://localhost:18860/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"agent": "default", "message": "Hello, what can you do?"}'
```

## 5. 檢查系統健康度

```bash
helix doctor
```

```text
🩺 Helix Doctor
  ✅ Node.js: v22.x
  ✅ API Key: gemini
  ✅ better-sqlite3: available
  ✅ Shared Core: 21/21 modules
```

## 核心概念

### Agents
Agent 是可對話、可用工具、可保留上下文並執行任務的 AI 實體。

```bash
# 列出 agents
curl http://localhost:18860/api/agents/instances

# 送訊息給 agent
curl -X POST http://localhost:18860/api/agent/chat \
  -d '{"agent": "researcher", "message": "Find info about Node.js 22"}'
```

### Sessions 與 Memory
每段對話都會持久化保存；Agent 可以跨 session 記住上下文。

```bash
# 查看 sessions
curl http://localhost:18860/api/sessions?agent_id=default

# 搜尋記憶
curl -X POST http://localhost:18860/api/memory/v2/recall \
  -d '{"agent_id": "default", "query": "what did we discuss?"}'
```

### Skills
Skills 是教 Agent 新能力的 Markdown 文件。

建立 `data/skills/research/web-search/SKILL.md`：
```markdown
---
name: web-search
description: Search the web for information
tags: [web, search]
---
# Instructions
Search the web for the given query and return structured results.
```

Helix 啟動時會自動掃描技能。

### Tools
Tools 是可程式化呼叫的能力，透過 tool registry 管理：

```bash
# 列出可用工具
curl http://localhost:18860/api/tools

# 執行工具
curl -X POST http://localhost:18860/api/tools/execute \
  -d '{"name": "shell_exec", "params": {"command": "echo hello"}}'
```

### Reasoning
複雜任務可使用推理迴圈（Plan → Act → Observe）：

```bash
curl -X POST http://localhost:18860/api/agent/reason \
  -d '{"task": "Analyze the current directory structure and suggest improvements"}'
```

### Streaming
透過 Server-Sent Events 取得即時回應：

```bash
curl -N -X POST http://localhost:18860/api/agent/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"agent": "default", "message": "Write a haiku about coding"}'
```

## 支援的 LLM Providers

| Provider | 模型範例 | 環境變數 |
|---|---|---|
| Google Gemini | gemini-2.5-flash | GEMINI_API_KEY |
| Anthropic | claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o | OPENAI_API_KEY |
| Moonshot Kimi | moonshot-v1-128k | KIMI_API_KEY |
| Mistral | mistral-large-latest | MISTRAL_API_KEY |
| DeepSeek | deepseek-chat | DEEPSEEK_API_KEY |
| Groq | llama-3.3-70b | GROQ_API_KEY |
| Qwen | qwen-max | QWEN_API_KEY |
| OpenRouter | any model | OPENROUTER_API_KEY |
| Local (Ollama) | ollama/llama3 | （不需） |

## Evaluation 與 Benchmarks

執行內建安全與品質 benchmark：

```bash
# CLI（離線可跑，不必先起 server）
helix eval run command-safety
helix eval run prompt-injection

# 查看歷史
helix eval history
```

```bash
# API
curl -X POST http://localhost:18860/api/eval/run \
  -H "Content-Type: application/json" \
  -d '{"suite": "command-safety"}'
```

可用 suites：`command-safety`（11 cases）、`prompt-injection`（12 cases）、`memory-recall`（3 cases）。

## 安全性

Helix 內建：
- **Command Safety** — 阻擋危險 shell 指令（如 `rm -rf`、`DROP TABLE`）
- **Prompt Injection Defense** — 偵測 prompt 注入攻擊
- **2FA** — TOTP 雙因素驗證
- **RBAC** — 角色權限控制（admin / operator / viewer）

## Dashboard

Web 控制台位於 `http://localhost:18860/v2/`：
- **System Overview** — agent 數量、tasks、memory、tools
- **Quick Actions** — spawn agents、chat、run evals
- **Debug Tools** — trace viewer、reasoning inspector、memory explorer（`/v2/debug.html`）

## 下一步

- [核心模組導覽](./core-guide.zh-TW.md) — 深入模組架構
- [設定檔參考](./CONFIG_REFERENCE.zh-TW.md) — 完整設定選項
- [常見問題 FAQ](./FAQ.zh-TW.md) — 常見問題
- [取得與安裝方式](./distribution.zh-TW.md) — npm / portable tarball / PWA / 未來桌面版
- [範例專案](../examples/README.zh-TW.md) — 可直接複製使用的 sample agents（chatbot / research / cmd-runner)
