# Chatbot 範例

[English](./README.md)

最精簡的單一 agent 設定。很適合作為第一次接觸 Helix 的起點。

## 啟動方式

```bash
helix login --provider gemini --api-key YOUR_KEY
helix start
```

接著你可以用任一方式互動：

- **Web**：打開 `http://localhost:18860/v2/` → spawn `assistant` → 送出訊息
- **CLI**：`helix repl` 或 `helix agent chat assistant`

## 你會得到什麼

- Session memory 會跨重啟保存（存在 `.helix/helix.db`）
- 對話超過門檻時自動做 compression
- 每一則訊息都會留下 trace 與 token 使用紀錄，可在 `/v2/debug.html` 查看

## 如何客製

編輯 `helix.config.js`：

- 把 `model` 換成 `claude-sonnet-4-6`、`gpt-4o` 等（provider 會依名稱自動判斷）
- 把 `apiKeyEnv` 改成對應環境變數
- 重寫 `systemPrompt`，讓 agent 有不同人格或任務定位

## 如何重設

```bash
# CLI 內輸入 /reset
# 或直接刪掉資料庫：
rm -rf .helix/
```
