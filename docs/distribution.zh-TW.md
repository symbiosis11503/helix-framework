# 取得與安裝方式

[English](../README.md)

Helix 目前有 4 條分發路線，分別適合不同使用者：

1. **npm 全域安裝** — 最適合開發者與已安裝 Node.js 的使用者
2. **portable tarball** — 最適合不想自己整理專案依賴、想快速解壓即跑的人
3. **PWA installable web app** — 最適合想把 Web Console 安裝到 Dock / 桌面的使用者
4. **Tauri native desktop（規劃中）** — 真正桌面安裝包，下個 sprint 處理

> 目前對外正式可用的是：**npm**、**portable tarball**、**PWA installable web app**。

---

## 1. npm 全域安裝

### 適合誰
- 已有 Node.js 環境
- 想直接用 `helix` 指令
- 會自己建立專案、修改 `helix.config.js`

### 安裝

```bash
npm install -g helix-agent-framework
```

### 啟動

```bash
helix init
helix login --provider gemini --api-key YOUR_KEY
helix start
```

### 優點
- 最直接、最標準的安裝方式
- 升級簡單：重新 `npm install -g`
- CLI / REPL / Web Console 都可用

### 缺點
- 需要先有 Node.js
- 若本機缺 native build 依賴，`better-sqlite3` 可能要先補 build tools

---

## 2. portable tarball

### 適合誰
- 不想先處理 Node.js 專案環境
- 想要「下載 → 解壓 → 執行」
- 想在單機或 ops / devops 場景快速測試

### 內容
portable tarball 內含：
- Node.js runtime
- `helix` launcher
- `helix-bundle.mjs`
- 目前 OS/arch 對應的 native modules
- `README.txt`

### 使用方式

```bash
# 1. 解壓
mkdir my-helix
cd my-helix
tar -xzf helix-portable-<os>-<arch>.tar.gz
cd helix-portable-<os>-<arch>

# 2. 啟動
./helix init
./helix login --provider gemini --api-key YOUR_KEY
./helix start
```

### 優點
- 不需要另外先安裝 Node.js
- 解壓即可跑
- 很適合做 clean-machine smoke 或內部測試分發

### 注意
- 目前是 **portable tarball**，不是單檔 binary
- 不同 OS / 架構需要對應包
- 之後 GitHub Actions matrix 會產出多平台版本

---

## 3. PWA installable web app

### 適合誰
- 已經跑起 Helix runtime
- 想把 Web Console 裝到 Dock / 桌面 / 啟動器
- 想要接近桌面 app 的使用感，但仍接受它本質是 web app

### 使用方式
1. 先跑：
   ```bash
   helix start
   ```
2. 打開：
   - `http://localhost:18860/v2/`
3. 在 Chrome / Edge 使用網址列的 **安裝** 按鈕
4. 安裝後會出現在 Dock / App Launcher / Start Menu（依平台而異）

### 目前能力
- manifest.json
- service worker
- standalone display
- icon 與 theme-color
- 可安裝為 **installable web app**

### 注意
- 這不是 native desktop app
- 它仍然依賴本機正在運行的 Helix runtime
- Safari / Chrome / Edge 的安裝體驗會略有差異

---

## 4. Tauri native desktop（規劃中）

### 目標
未來會提供：
- `.dmg`
- `.exe`
- `.AppImage`

### 預期定位
- 給偏桌面使用者的正式安裝包
- 會重用目前 PWA / webview 能力
- 後端仍與現有 runtime / binary 路徑整合

### 目前狀態
- **尚未對外發布**
- 屬於下個 sprint 的工作

---

## 我該選哪一條？

### 如果你是開發者
選：**npm 全域安裝**

### 如果你想快速下載即跑
選：**portable tarball**

### 如果你想把 Console 放到 Dock / 桌面
選：**PWA installable web app**

### 如果你想要真正桌面安裝包
等：**Tauri native desktop**

---

## 建議採用順序

### 路線 A：標準開發者路徑
```bash
npm install -g helix-agent-framework
helix init
helix login --provider gemini --api-key YOUR_KEY
helix start
```

### 路線 B：低摩擦體驗路徑
1. 下載 portable tarball
2. 解壓執行 `./helix start`
3. 再把 `/v2/` 安裝成 PWA

---

## 延伸閱讀
- [README.zh-TW](../README.zh-TW.md)
- [快速開始指南](./getting-started.zh-TW.md)
- [設定檔參考](./CONFIG_REFERENCE.zh-TW.md)
- [常見問題 FAQ](./FAQ.zh-TW.md)
- [範例專案](../examples/README.zh-TW.md)
