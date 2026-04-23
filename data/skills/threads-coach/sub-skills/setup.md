---
name: setup
parent: threads-coach
description: |
  第一次接帳號，把歷史貼文 + 留言 + metrics 拉成 tracker.json，
  並產出 style_guide.md / concept_library.md 兩份人類讀的封存。
allowed-tools: Read, Glob, Bash, Write
---

# threads-coach / setup

## 目標

從零開始建立帳號的可分析資料家，輸出：

```
data/threads/<handle>/
├── tracker.json              # 機器讀，所有後續模組的真值
├── style_guide.md            # 人類讀，口吻 / 結構 / 開頭結尾 pattern
├── concept_library.md        # 人類讀，主題清單 + 鄰域分群
├── posts_by_date.md          # 人類讀，時間序列封存
├── posts_by_topic.md         # 人類讀，主題分群封存
├── comments.md               # 人類讀，全留言封存
└── refresh.log               # audit
```

## 資料來源優先序

### Path A：Meta Threads API（如果使用者有 token）

```bash
node scripts/playwright-scrape.mjs --handle <handle> --use-api --token-env THREADS_API_TOKEN
```

優點：metrics 完整（views / likes / replies / reposts / quotes）、insights 拿得到 discovery surface
缺點：需要 Meta Developer App + 60 天 long-lived token、每小時 250 calls 上限

### Path B：playwright scrape（預設）

```bash
node scripts/playwright-scrape.mjs --handle <handle>
```

走我們已有的 `/opt/symbiosis-helix/scripts/playwright-threads.mjs` 的 `check-replies` + `fetch-post` 組合，scrape 公開可見的內容。

優點：不用 Meta App、不吃 rate limit
缺點：metrics 只能拿到部分（views 不公開、reactions 部分可見）

### Path C：使用者自己貼歷史

如果 A 和 B 都不行，跟使用者要：
- 5-20 篇代表性歷史貼文純文字
- 任何手上有的 metrics 截圖
- 前 5 篇置頂 / 主推內容

從這建臨時 tracker.json，明白標 `data_path: "C"`、`confidence: "weak"`。

## 流程

### Step 1：抓所有可達歷史貼文

`playwright-scrape.mjs` 從 `https://www.threads.com/@<handle>` 進入，往下捲到底，提取每篇：
- 貼文 ID
- 發文時間
- 全文（不截斷）
- 圖片 URL（如果有）
- 留言展開後的全部 reply 內容

寫成 `tracker.json`：

```json
{
  "meta": {
    "handle": "...",
    "scraped_at": "...",
    "data_path": "B",
    "post_count": 47,
    "comment_count": 312,
    "earliest_post": "2025-08-01",
    "latest_post": "2026-04-23"
  },
  "posts": [
    {
      "id": "DXbryXJifQa",
      "url": "...",
      "ts": "...",
      "text": "...",
      "images": [],
      "metrics": {
        "likes": 12,
        "replies": 3,
        "reposts": 1,
        "quotes": 0,
        "views": null
      },
      "comments": [
        {"author": "...", "text": "...", "ts": "..."}
      ]
    }
  ]
}
```

### Step 2：產 style_guide.md

統計分析後寫人類讀的：

```markdown
# <handle> Style Guide

## 開頭 hook 統計（前 100 篇）
- 標題式：23 篇（避免）
- 反直覺斷言：18 篇（建議多用，平均互動率 +40%）
- 數字開頭：12 篇（建議用於 list 文）
- 個人故事：9 篇（高深度留言觸發）
- 問句：8 篇

## 結尾 pattern
- 列點收尾（無 hook）：35 篇
- 開放問句：22 篇（深度留言 +60%）
- 結論斷言：18 篇

## 高頻句式
- 「...的時候，...」（45 次）
- 「我們的做法是...」（38 次，建議改用「我發現...」更個人化）

## 偏好用詞
- 「跑」（n=67）「弄」（n=43）「搞」（n=21）— 偏口語
- 「實作」（n=89）「整合」（n=54） — 技術導向

## 不會用的詞
- 「加油」（n=0）「努力」（n=0）「夢想」（n=0） — 不走勵志風
```

### Step 3：產 concept_library.md

從所有貼文文字 + 留言抽 entity / topic：

```markdown
# <handle> Concept Library

## 主題鄰域（自動分群）
- AI 工程（n=23 篇）
  - Agent 框架、記憶系統、MCP、向量搜尋
- 商業策略（n=12 篇）
  - LINE@、訂閱模式、客戶轉換
- 工具評測（n=8 篇）
  - Bun、Playwright、Whisper

## 核心概念（高頻 + 高互動）
- "Helix Framework"（n=15 篇，平均互動 +52%）
- "Threads 經營"（n=8 篇，平均互動 +38%）

## 提到的人 / 工具 / 公司
- Anthropic / Claude（n=24）
- OpenAI（n=11）
- Mosseri（n=3）

## 主題鄰域距離矩陣
（給 topics sub-skill 判斷新主題能否橋接）
```

### Step 4：寫 audit log

`refresh.log` 記每次 setup / refresh 的時間、來源、scrape 結果：

```
2026-04-23T03:40:12Z setup handle=symbiosis11503 path=B posts=47 comments=312 ok
```

## 失敗處理

- playwright timeout → 重試 1 次，仍失敗就改用使用者貼的歷史走 Path C
- Threads 短期 ban scrape → 用 cookie auth + 隨機 user-agent，仍不行就請使用者明天再來
- 帳號隱私設定阻擋 → 直接告訴使用者要 token-based API path

## Idempotency

- 第二次跑只 scrape 比 `latest_post` 新的內容
- style_guide / concept_library 重新生成，但保留 user 手動編輯的 `## Manual Refinements` 區塊

## 與 Helix 整合

setup 完成寫 event：

```js
{
  event_type: 'threads_coach_setup',
  account: 'symbiosis11503',
  data_path: 'B',
  post_count: 47,
  ts: <iso>,
}
```
