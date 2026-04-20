# 貢獻 Helix

[English](./CONTRIBUTING.md)

感謝你對 Helix 有興趣！

## 開始

```bash
git clone https://github.com/symbiosis11503/helix-framework.git
cd helix-framework
npm install
```

## 開發

```bash
# 啟動 dev server
node bin/helix.js start --port 18899

# 跑測試
npm test

# 語法檢查
node --check src/*.js
```

## 專案結構

```
bin/helix.js          — CLI entry point
src/
  db.js               — PG/SQLite 雙 adapter
  server-lite.js      — Express server（33+ endpoints）
  session-store.js    — Context OS
  delegation.js       — Delegation OS
  command-safety.js   — 指令安全引擎
  hooks.js            — Hook lifecycle
  edit-tool.js        — Edit tool
  mcp-client.js       — MCP client
  llm-provider.js     — 多 provider LLM
  tool-registry.js    — Tool registry
```

## 規範

- **Shared Core 模組**必須同時支援 PG 與 SQLite
- 所有工具執行必須走 hook pipeline
- HTML 輸出用 `esc()` / `_esc()`（防 XSS）
- 前端頁面用 `toast.*()` 不要用 `alert()`
- 改完跑 `helix doctor` 驗證

## Pull Request

1. Fork 這個 repo
2. 開一個 feature branch
3. 改動後跑 `npm test`
4. 提 PR 並寫清楚改了什麼、為什麼
5. 英文文件有改的話，同步更新 `.zh-TW.md` 對應版本（硬規則：英中雙語同步）

## 授權

MIT
