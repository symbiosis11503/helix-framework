# Helix Tauri 桌面原型

[English](./README.md)

這個目錄放的是 Helix 第一個 **attach-first** Tauri MVP 原型。

## 目前能做什麼
- 開啟原生桌面殼
- 檢查 `127.0.0.1:18860` 是否可連線
- runtime ready 後，把 `http://127.0.0.1:18860/v2/` 載進內嵌 iframe

## 目前還不能做什麼
- 自動啟動或內建打包 Helix runtime
- 提供已簽章 / 已 notarize 的公開桌面版本
- 提供 auto-update、tray mode、深度 OS integration
- `spawn mode` 不在 `0.10.0`，正式延到 `0.10.1+`

## 開發指令
在 repo root 執行：

```bash
npm run tauri:dev
npm run tauri:build -- --bundles app
```

## Truth boundary
這條目前只屬於 `0.10.0` 探索中的 prototype。未有刻意發布的真 desktop artifact 前，不要先把它掛到官網下載卡。
