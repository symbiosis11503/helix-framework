# Helix 常見問題

[English](./FAQ.md)

## 安裝

### `npm install` 出現 `better-sqlite3` build error
```bash
# 先安裝 build tools
# macOS:
xcode-select --install
# Ubuntu/Debian:
sudo apt-get install build-essential python3
# 然後重試：
npm install -g helix-agent-framework
```

### `helix init` 出現 `SyntaxError: Unexpected token 'export'`
你的專案需要啟用 ESM。重新執行 `helix init`，它會自動在 `package.json` 裡設好 `"type": "module"`。

如果你原本的 `package.json` 是 `"type": "commonjs"`，`helix init` 也會幫你改成 `"module"`。這是必要的，因為 `helix.config.js` 使用的是 `export default`。

---

## 設定

### 怎麼切換 LLM provider？
編輯 `helix.config.js`：
```js
export default {
  model: 'claude-sonnet-4-6',  // 或 'gpt-4o'、'gemini-2.5-flash'
  apiKeyEnv: 'ANTHROPIC_API_KEY',  // 會依 model 名稱自動判斷
};
```

然後設定 API key：
```bash
helix login --provider claude --api-key YOUR_KEY
```

Provider 會依 model 名稱自動推斷。你也可以在 `agents` 陣列中幫不同 agent 指定不同 model。

### API key 存在哪裡？
存放在 `~/.helix/auth.json`（機器層級，不在你的專案內）。檔案權限會設成 600，只允許擁有者讀寫。

### 可以同時使用多個 provider 嗎？
可以。每個 agent 都可以有自己的 `model` 與 `key_env`：
```js
agents: [
  { id: 'assistant', model: 'gemini-2.5-flash' },
  { id: 'reviewer', model: 'claude-sonnet-4-6', key_env: 'ANTHROPIC_API_KEY' },
]
```

---

## Runtime

### Port 18860 已被占用
```bash
helix start --port 18899
```

### `helix doctor` 顯示 `better-sqlite3 not installed`
```bash
npm install better-sqlite3
```

### 怎麼重設某個 agent 的對話？
```bash
# CLI:
helix agent chat assistant
# 然後輸入：
/reset

# API:
curl -X POST http://localhost:18860/api/agent/reset-session \
  -H "Content-Type: application/json" \
  -d '{"agent":"assistant"}'
```

### Agent chat 回傳 `[no API key: GEMINI_API_KEY]`
執行 `helix login` 設定 API key，或直接設環境變數：
```bash
export GEMINI_API_KEY=***
helix start
```

---

## 資料庫

### 可以用 PostgreSQL 取代 SQLite 嗎？
可以。編輯 `helix.config.js`：
```js
database: {
  type: 'pg',
  pg: { host: 'localhost', port: 5432, user: 'helix', database: 'helix', password: '...' }
}
```

### SQLite 資料庫在哪裡？
位於你的專案目錄中的 `.helix/helix.db`。這個資料夾會自動被 gitignore。

### 怎麼備份資料？
```bash
cp .helix/helix.db .helix/helix.db.backup
```

---

## 安全

### admin token 是什麼？
設定 `ADMIN_TOKEN` 環境變數後，可以保護 admin API endpoints：
```bash
ADMIN_TOKEN=*** helix start
```

設定後，請求需要帶：
- `Authorization: Bearer ***`
- 或 `X-Admin-Token: <token>`

### command safety 怎麼運作？
Helix 在執行前，會先檢查 shell 指令是否命中 35+ 危險 pattern（如 `rm -rf`、`DROP TABLE`、`git push --force` 等）。
- 危險指令：直接阻擋
- 高風險但未直接阻擋者：要求批准或至少留下告警/紀錄

---

## 疑難排解

### Dashboard 一直顯示 `loading...`
1. 先確認 server 是否有啟動：`curl http://localhost:18860/api/health`
2. 檢查瀏覽器 console 是否有 error
3. 嘗試強制重新整理：`Ctrl+Shift+R`（Mac 用 `Cmd+Shift+R`）

### 出現 `Database not initialized`
請確認你目前所在目錄有 `helix.config.js`。如果沒有，先執行 `helix init`。

### Session compression 沒生效
Compression 需要 Gemini API key（因為會用 LLM 做摘要壓縮）。如果沒有，會退回較簡單的字串拼接方式。設定 `GEMINI_API_KEY` 後壓縮效果會更好。
