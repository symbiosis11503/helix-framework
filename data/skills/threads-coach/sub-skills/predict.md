---
name: predict
parent: threads-coach
description: |
  發前 24 小時表現預測。基於同主題鄰域 + 同 hook 類型的歷史中位數，
  輸出 p25/p50/p75 範圍 + 主信號預測，並給 calibration 偏差紀錄。
allowed-tools: Read, Glob, Grep
---

# threads-coach / predict

## 不是什麼

- ❌ 不是占星 — 不會預測「絕對破萬」這種數字
- ❌ 不是模型 — 沒有訓練 LLM，只用統計
- ❌ 不是承諾 — 給的是範圍 + 信心區間，不是承諾

## 是什麼

從 tracker.json 抽歷史上同類貼文（同主題鄰域 + 同 hook 類型 + 同切角），
計算中位互動率，給 24 小時內可能的表現範圍。

每次 predict 必須留 `calibration log`，讓 review sub-skill 後續算「我們的預測偏差有多大」。

## 必讀

- `tracker.json`（必要）
- `Glob **/knowledge/algorithm-base.md` — S1-S5 信號權重
- 該帳號歷史 `predict.log`（如果有）— 看過去 calibration 偏差

## 流程

### Step 1：分類待預測貼文

提取：
- 主題鄰域（從 concept_library 對照）
- hook 類型
- 切角
- 字數
- 是否含圖
- 預期發文時段
- 是否含 topic tag

### Step 2：撈 N=10 同類參考樣本

從 tracker 過濾：
- 同主題鄰域 cosine similarity > 0.7
- 同 hook 類型
- 發文時間相隔 < 6 個月
- 有完整 metrics

如果 N < 5，明白標 `confidence: low`，predict 範圍會很寬。

### Step 3：計算中位數 + IQR

對 likes / replies / sends（如有）/ reposts / quotes 各算：

```
p25, p50, p75 of recent_N_similar_posts
```

### Step 4：判主信號

從 S1-S5 權重 + 該貼文設計判斷主信號：

```
if 結尾有開放問句 + 反直覺斷言 → main_signal: replies
if 有可分享框架 + 反直覺結論 → main_signal: sends
if 長文 + 多段資訊密度 → main_signal: time_spent
if 有圖 + 視覺化 → secondary_signal: time_spent
```

### Step 5：標 calibration 信心

```
confidence:
  N >= 10: high
  N = 5-9: medium
  N < 5: low

caveats:
  - 過去 7 天內發過同主題（diversity 風險，預估偏低 30%）
  - 含敏感主題（推薦受限，預估偏低 50%）
  - 帳號近 30 天平均互動驟降（趨勢偏低，預估偏低 20%）
```

### Step 6：寫 calibration log

```jsonl
{"ts":"2026-04-23T03:45","account":"symbiosis11503","topic":"AI 記憶系統","predicted":{"replies":{"p25":3,"p50":7,"p75":15},"sends":{"p25":1,"p50":3,"p75":8}},"main_signal":"replies","N":8,"confidence":"medium","caveats":["近 7 天內發過 2 篇同主題"]}
```

review sub-skill 後續會抓這個 log + 實際 metrics 算偏差。

## 輸出格式

```markdown
# Predict — <topic 或 post_id>

## 比對基礎
- N=8 同類歷史貼文
- 主題鄰域：AI 工程 / 記憶系統
- Hook 類型：標題式
- 切角：技術整理
- Confidence: medium

## 24 小時預測範圍

| 信號 | p25 | p50 | p75 | 歷史最佳 |
|---|---|---|---|---|
| Likes | 5 | 12 | 25 | 58 |
| Replies（5+ 詞） | 1 | 3 | 7 | 12 |
| Sends（私訊分享） | 0 | 1 | 3 | 8 |
| Reposts | 0 | 1 | 2 | 5 |

## 主信號預測
**replies**（B2B 受眾愛留實戰意見，這篇結尾若加問句會更穩）

## Caveats（已扣權重）
- 近 7 天內發過 2 篇 AI 記憶相關 → diversity enforcement 風險，p50 已下修 30%
- 標題式開頭 → 在你帳號上歷史互動率比反直覺開頭低 40%

## 建議
- 發文時段：你過去 2 個月互動高峰是 21:00-23:00（中位 +35%），明早 10:00 發會稍差
- 改首句到反直覺斷言 + 加架構圖，可把 p50 往 p75 推

## Calibration log 已寫入
`data/threads/symbiosis11503/predict.log`
```

## B2B / 利基帳號特化

- Likes 預測值降到參考級，不影響主信號判讀
- Sends 對 B2B 受眾極弱，p75 通常都很低 — 不要當失望指標
- Replies 是核心 KPI，p50 達 5+ 就算成功
- 帳號規模因素：fans < 1000 的帳號預測值要乘 0.6-0.8 折扣

## 反規則

- ❌ 不要給單一數字（給範圍）
- ❌ 不要給 N < 5 還假裝 confidence 高
- ❌ 不要把外界爆文當參考（只用該帳號自己的歷史）

## 與 Helix 整合

```js
{
  event_type: 'threads_coach_predict',
  account: '...',
  topic: '...',
  predicted: { replies: {p25, p50, p75}, ... },
  main_signal: '...',
  confidence: 'medium',
  N: 8,
  ts: <iso>,
}
```
