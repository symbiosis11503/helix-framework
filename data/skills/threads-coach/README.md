# threads-coach

Threads 經營決策系統。Helix 0.12 內建技能。

## 設計訴求

針對「想穩定累積一條主題線的小至中型 Threads 帳號」，提供 8 個 sub-skill 構成的閉環顧問流程。判讀基礎是 Meta 過去 5 年的公開規則 + 申請專利 + 洩露文件，不是靈感、不是模板、不是 KOL 經驗談。

## 跟 ak-threads-booster 的關係

本技能涵蓋範圍與 [AK SEO Labs / AK-Threads-Booster](https://gitlab.com/akseolabs/AK-Threads-booster)（MIT）有重疊。**程式碼與內容皆完全自寫**。共通點僅限：兩者皆基於 Meta 公開資料，所以結論方向會自然趨同。

差異：
- threads-coach 整合 Helix task pipeline + playwright scraper（不需 Meta API token）
- 強調 B2B / 利基帳號權重調整（小受眾、深轉換）
- 預測模型輸出 calibration metrics 而非單點數字
- 寫入 events log（`threads_coach_*` event types），可被 review 後續比對

## 結構

```
data/skills/threads-coach/
├── SKILL.md                         # 入口 + intent routing
├── README.md                        # 本檔
├── sub-skills/
│   ├── setup.md                     # 第一次接帳號
│   ├── refresh.md                   # 增量更新 tracker
│   ├── voice.md                     # brand_voice fingerprint
│   ├── topics.md                    # 從歷史挖下一篇主題
│   ├── draft.md                     # 從主題生 1-3 個草稿
│   ├── analyze.md                   # 發前診斷（3 輪掃描）
│   ├── predict.md                   # 24h 表現預測
│   └── review.md                    # 發後復盤 + calibration
├── knowledge/
│   ├── algorithm-base.md            # 12 紅線 + 14 信號（標 Meta 公告 / 專利編號）
│   ├── psychology.md                # 受眾行為 reasoning
│   └── data-confidence.md           # tier rubric
└── scripts/
    └── playwright-scrape.mjs        # tracker 抓取（包 sbs-vps playwright-threads.mjs）
```

## 工具註冊（給 Helix）

```js
import { registerThreadsCoachTool } from './src/tools/threads-coach.js';
await registerThreadsCoachTool(registry);
// → threads.coach.{setup, refresh, analyze, topics, draft, predict, review, voice}
```

## 典型使用流程

### 第一次接帳號

```
threads.coach.setup({ handle: 'symbiosis11503' })
  → tracker.json 建立
threads.coach.voice({ handle: 'symbiosis11503' })
  → brand_voice.md 建立
```

### 寫一篇新文

```
threads.coach.topics({ handle: 'symbiosis11503' })
  → 5 個候選主題
threads.coach.draft({ handle, topic: '...', target_signal: 'replies' })
  → 3 個版本
threads.coach.predict({ handle, post_text: '<final draft>' })
  → 24h 表現範圍
```

### 發後復盤

```
threads.coach.refresh({ handle })           # 24h 後拉最新 metrics
threads.coach.review({ handle, post_id, actual_metrics })
  → predict vs actual + 教訓 + style_guide 建議更新
```

## B2B / 利基帳號權重調整

對小受眾、技術深、轉換深的帳號，sub-skill 會自動調整：

- S1 sends weight ↓（受眾不互傳是正常的）
- S2 replies weight ↑（5+ 詞留言是核心 KPI）
- S5 likes 忽略
- S7 / S8 weight ↑（語意鄰域 + Trust Graph 比觸及更重要）
- 結尾問句要求更具體（避免「你覺得呢？」）
- 草稿不塞 hashtag、不討互動

## 演算法判讀來源

`knowledge/algorithm-base.md` 引用：

- **Meta 官方公告**（2017-2026 共 9 篇）
- **US Patent**（14 個申請專利編號）
- **Facebook Papers / Frances Haugen 洩露文件 2021**
- **第三方研究**（Buffer 2026 跨平台 52M+ 貼文分析）

每條紅線 / 信號都標來源編號，可交叉查證。

## 整合 Helix events

完成任一 sub-skill 寫一筆 event，可被後續 review 比對：

```js
{
  event_type: 'threads_coach_<sub_skill_name>',
  account: '<handle>',
  // sub-skill specific fields
  ts: '<iso>',
}
```

## 已知限制

- `playwright-scrape.mjs` 走 ssh sbs-vps 包 `playwright-threads.mjs`，需要 sbs-vps SSH 可達 + Threads 登入 cookie 有效
- 目前 scrape 受 profile sweep 限制只能拿到頂層 N 篇可見貼文，深 scroll 待加
- Meta API path（`--use-api`）尚未實作，目前只走 Path B（playwright scrape）和 Path C（手動貼歷史）
- `predict.log` / `review.log` 雙寫機制尚未串到 Helix events DB

## 版本

v0.1.0（2026-04-23）— 初始版本
