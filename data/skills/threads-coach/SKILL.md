---
name: threads-coach
version: 0.1.0
description: |
  Threads 經營決策系統。針對單一帳號的歷史貼文、互動數據和語意鄰域，
  提供「主題挖掘 → 草稿 → 發前診斷 → 24 小時預測 → 發後復盤」的閉環顧問。
  以 Meta 公開的演算法說明、申請專利、官方公告為依據；不靠靈感、不靠通則。
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
parameters:
  account_handle:
    description: Threads 帳號 handle（不含 @）
    required: false
  data_dir:
    description: tracker / posts / comments 資料夾路徑
    default: ./threads-data
---

# Threads Coach（Helix 內建技能）

這支技能的服務對象是「想穩定累積一條主題線的小至中型 Threads 帳號」，
不是要做 viral 爆文工廠。它的判讀基礎是 Meta 過去 5 年的公開規則和專利，
不是靈感、不是模板、不是 KOL 經驗談。

## 它解決什麼

| 你想做的事 | 對應 sub-skill | 用什麼資料 |
|---|---|---|
| 第一次接帳號，先把歷史拉下來、學會這人的口吻 | `setup` | playwright scrape + 你提供的舊文 |
| 寫好一篇還沒發，想看會不會被壓 | `analyze` | 你的歷史 + Meta 演算法知識庫 |
| 沒題材了，想知道下一篇寫什麼 | `topics` | 你的概念庫 + 近期語意鄰域使用率 |
| 寫完想預測 24 小時表現 | `predict` | 同主題歷史貼文表現 |
| 發完了，想知道哪些信號真的有效 | `review` | 實際數據 vs predict 的差距 |
| 想盤點自己的口吻特徵 | `voice` | 歷史貼文的句式、開頭、結尾 pattern |

## 設計原則

1. **不寫範文**。`analyze` 給診斷不給重寫；`draft` 起新文時才會生草稿，但結構由使用者拍板。
2. **資料優先於通則**。沒有歷史資料就直說「沒資料、降級判讀」，不假裝。
3. **演算法判讀只引可驗證來源**。每條紅線 / 信號標註 Meta 公告、專利或洩露文件編號。
4. **不是爆文工廠**。S8 Trust Graph 是核心 KPI，不是按讚數。
5. **B2B / 利基帳號優先**。受眾規模小、轉換深、技術深的帳號邏輯，跟一般 KOL 不同。

## 路由規則

收到使用者請求時：

1. 看 intent 屬於哪個 sub-skill，開對應檔。
2. 不要從 SKILL.md 直接回答能 routing 到 sub-skill 的問題。
3. 多步驟流程的合理組合：
   - 新帳號接手：`setup` → `voice`
   - 從歷史寫新文：`topics` → `draft`
   - 發前流程：`analyze` → `predict`（若使用者要範圍）
   - 發後流程：`review`
4. 任何階段，若 `tracker.json` 不存在，先 ask user 補資料或走 `setup`。

## 工作目錄資料

預期會找到：

- `tracker.json` — 機器讀的歷史資料 + 每篇 metrics
- `style_guide.md` — 由 `voice` 產出
- `concept_library.md` — 由 `setup` 從歷史 thread 抽出的主題清單
- `posts_by_date.md` / `posts_by_topic.md` — 人類讀的封存
- `freshness.log` / `refresh.log` — `analyze` / `topics` / `review` 的 audit trail

若舊版資料缺，`setup` 可以從 playwright scrape 補。

## 與 Helix Framework 的整合

- 透過 `helix-framework/src/tools/threads-coach.js` 暴露為工具，可被 task pipeline 呼叫
- 寫入 `helix-framework/data/threads/<account>/` 為帳號資料家
- `analyze` 結果寫進 events log（event_type: `threads_analyze`），方便事後 review
- `predict` vs `actual` 偏差計入 model calibration log，用於改進預測模型

## 與 ak-threads-booster 的關係

本技能的覆蓋範圍與 AK SEO Labs 公開的 `ak-threads-booster`（GitLab，MIT License）
有重疊，但**程式碼與內容皆完全自寫**。共通點僅限於：兩者皆基於 Meta 公開資料，
所以結論方向會自然趨同。差異：

- threads-coach 整合 Helix task pipeline + playwright scraper（不需 Meta API token）
- 強調 B2B / 利基帳號邏輯（小受眾、深轉換）
- 預測模型輸出 calibration metrics 而非單點數字
