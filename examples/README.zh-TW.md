# Helix 範例

[English](./README.md)

這裡提供 3 套可直接複製使用的 sample agents。每個子目錄都是獨立專案模板 —— 複製出去、執行 `helix start`，就能得到一個可運作的 agent。

## 先從哪一個開始？

| 範例 | 適合誰 | 技術組合 |
|---|---|---|
| [chatbot/](./chatbot/) | 最簡單，先體驗單一對話 agent | Gemini、session memory |
| [research-agent/](./research-agent/) | 需要多步驟研究、工具、長期記憶 | Claude、memory-v2、skills |
| [cmd-runner/](./cmd-runner/) | 想讓 agent 執行 shell 指令，並受安全機制保護 | OpenAI、command-safety hook |

## 如何使用其中一個範例

```bash
# 1. 先安裝 helix（只需一次）
npm install -g helix-agent-framework

# 2. 複製範例
cp -r node_modules/helix-agent-framework/examples/chatbot my-bot
cd my-bot

# 3. 設定 API key 並啟動
helix login --provider gemini --api-key YOUR_KEY
helix start

# 打開 http://localhost:18860/v2/
```

如果你是從 repo clone 下來，也可以這樣跑：

```bash
cd examples/chatbot
helix login --provider gemini --api-key YOUR_KEY
helix start
```

## 如何延伸成自己的專案

先跑一個範例，再把它的 `helix.config.js` 複製到你自己的專案裡，接著調整：
- `agents[]`
- `skills[]`
- `hooks[]`

完整設定請看：[`docs/CONFIG_REFERENCE.md`](../docs/CONFIG_REFERENCE.md)
