---
name: refresh
parent: threads-coach
description: |
  每日 / 每週把帳號最新貼文 + 留言 + metrics 拉進 tracker.json，
  增量更新而不是全量重抓。寫入 refresh.log 給 review sub-skill 用。
allowed-tools: Read, Glob, Bash, Write
---

# threads-coach / refresh

## 與 setup 的差別

| | setup | refresh |
|---|---|---|
| 用途 | 第一次接帳號 | 日常增量更新 |
| 範圍 | 所有可達歷史 | 只抓比 latest_post 新的 |
| 副產出 | tracker + style_guide + concept_library | 只更新 tracker + 重算分群（人類讀檔不重生）|
| 頻率 | 一次性 | 每天 / 每週 |

## 流程

### Step 1：讀現有 tracker

```js
const tracker = JSON.parse(fs.readFileSync('data/threads/<handle>/tracker.json'));
const latestPostTs = tracker.meta.latest_post_ts;
```

### Step 2：scrape 增量

```bash
node scripts/playwright-scrape.mjs \
  --handle <handle> \
  --since <latest_post_ts> \
  --include-comments
```

如果 since 距今 > 7 天，建議跑全量重抓（避免漏掉中間 metrics 變化）。

### Step 3：合併進 tracker

- 新貼文 append
- 既有貼文 metrics 更新（views / likes / replies / sends 都會隨時間變）
- 既有貼文留言 merge（新留言 append，既有留言不動）

### Step 4：重算 derived fields

- semantic_clusters 重新分群
- topic_freshness 全部重算
- account_centroid_embedding 重算

### Step 5：寫 refresh.log

```jsonl
{"ts":"2026-04-23T03:50","handle":"symbiosis11503","new_posts":2,"updated_metrics":47,"new_comments":18,"clusters_changed":1,"duration_sec":34}
```

## 排程建議

如果走 Helix task pipeline：

```js
{
  type: 'cron',
  schedule: '0 */6 * * *',     // 每 6 小時一次
  task: 'threads_coach_refresh',
  payload: { handle: 'symbiosis11503' },
}
```

每 6 小時夠抓住 24 小時內 predict 對照所需的 metrics 變化，不會 over-scrape 觸發 ban。

## 失敗處理

- playwright timeout：重試 1 次，仍失敗就把這次排程標 fail，不寫進 tracker
- Threads cookie 失效：通知 user 重新跑 `playwright-threads.mjs login`
- 帳號被短期 ban scrape：等下次 cron，連續 3 次 fail 升級警告

## 與 Helix 整合

每次 refresh 寫 event：

```js
{
  event_type: 'threads_coach_refresh',
  account: '...',
  new_posts: 2,
  updated_metrics: 47,
  duration_ms: 34000,
  ts: <iso>,
}
```

## Idempotency

- 同一時間戳重跑只會更新 metrics 不會重複新增 posts
- 下次 refresh 從 tracker.meta.latest_post_ts 接著跑
