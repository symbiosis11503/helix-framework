# Research Agent 範例

[English](./README.md)

一個多步驟研究型 agent，內建 web search、長期記憶與技能呼叫。

## 啟動方式

```bash
helix login --provider claude --api-key YOUR_KEY
helix start
```

接著：

```bash
helix agent chat researcher
> 研究一下 2026 年主流開源 AI Agent 框架的差異
```

## 你會得到什麼

- **Web search skill** — 內建技能，基本查詢不需額外 API key
- **三層記憶** — researcher 可跨重啟記住先前研究內容
- **Memory recall** — 重查前先引用過往結論
- **Structured output** — 每個 finding 會整理後寫入 episodic memory

## 如何查看記憶

```bash
# CLI
helix memory stats researcher
helix memory recall researcher "agent framework"

# Web
# 打開 http://localhost:18860/v2/ → stats card 會顯示 entry 數量
```

## 如何客製

- `agents[].systemPrompt` — 改研究方法與輸出格式
- `skills.enabled` — 若想要純推理 agent，可拿掉 `web-search`
- `memory.decay` — 設成 `false` 可永久保留所有記憶

## 如何針對你的領域調參

如果你是在單一領域做深度研究，可以在 system prompt 裡提高 `importance` 門檻，讓只有高價值 finding 才進 semantic memory。

如果你是在做廣泛掃描，則可把門檻調低，讓記憶覆蓋更廣。
