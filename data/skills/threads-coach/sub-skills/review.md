---
name: review
parent: threads-coach
description: |
  發文後復盤。比對 predict 的範圍 vs 實際 metrics，
  抽哪些信號真的觸發、哪些落差大、下次該調什麼。
allowed-tools: Read, Glob, Grep
---

# threads-coach / review

## 何時跑

- 發文後 24 小時：第一次 review，看是否落入 predict 範圍
- 發文後 7 天：第二次 review，看 long-tail 表現 + Trust Graph 累積
- 任何時候 user 主動 ask review

## 必讀

- `tracker.json`（必要 — 該貼文 metrics 必須已 refresh）
- `predict.log`（如果有 — 拉對應的預測紀錄）
- `freshness.log`（看當時是否標過警告）
- `Glob **/knowledge/algorithm-base.md`

## 流程

### Step 1：抓對應的 predict 紀錄

從 `predict.log` 找該貼文 / 該主題的 predict 紀錄。如果沒有（用戶沒走 predict 直接發），改成「無預測對照」模式，只做事後分析。

### Step 2：對照 predict vs actual

```
| 信號 | Predicted (p25-p75) | Actual | 落點 |
|---|---|---|---|
| Likes | 5-25 | 18 | 落入 IQR ✅ |
| Replies | 1-7 | 12 | 高於 p75 ✅ |
| Sends | 0-3 | 0 | 落入下界（B2B 預期）|
```

### Step 3：拆 actual 來源面（如有 insights）

如果 user 提供 Threads Insights 截圖或拿到 Discovery Surface：

```
Discovery Surface：
- Threads feed: 62%
- Profile: 28%
- Topic feed: 8%
- Instagram / Facebook: 2%
```

對照 algorithm-base S11，給判讀：

- profile 高 → follower-fit / 已有信任群
- topic_feed 有量 → 主題辨識成功
- 跨 surface 弱 → 主題太垂直（B2B 帳號正常）

### Step 4：算 calibration 偏差

```
deviation_score = abs(actual - predicted_p50) / (predicted_p75 - predicted_p25)
```

- < 0.5：predict 準
- 0.5-1.5：predict 略偏
- > 1.5：predict 嚴重偏，要回頭檢查樣本選擇

寫進 `predict.log`：

```jsonl
{"ts":"...","post_id":"DXbryXJifQa","predicted_p50":7,"actual":12,"deviation":1.4,"main_signal_match":true}
```

長期 deviation 累積會用來調整 predict 的樣本權重。

### Step 5：留言區深度分析

掃該貼文留言區：

- 總留言數 vs 5+ 詞留言數比例
- 留言中是否有「我也是」/「我反而」/「如果換成」這類深度回應
- 自己回覆的留言佔比 + 自回品質

對照 P1-P4（algorithm-base 發文後策略）：

```
- 第一小時內回了 N 則高品質留言 ✅
- 自回有提供新案例 / 接住反對意見 ✅
- 留言區是否變成第二內容場：是 / 部分 / 沒有
```

### Step 6：抽教訓

不抽空泛的，要具體：

```
教訓：
1. 反直覺首句確實提升 replies（這次 actual 高於 p75，跟 hook 改寫有關）
2. 「你會怎麼分」結尾在你帳號上效果穩定（n=4 篇，全部 replies 高於 p50）
3. 沒加圖損失預估 30% time_spent — 下次有架構類內容務必加圖
4. R5 警告（與「記憶宮殿」鄰域 80%+）實際導致 reach 比 baseline 低 25%
```

## 輸出格式

```markdown
# Review — <post_id>

## 發文時間 + 24 小時 / 7 天節點
- 發文：2026-04-20 21:30
- 本次 review：2026-04-21 21:35（24h）

## Predict vs Actual
[表格]

## Discovery Surface（如有）
[拆分]

## Calibration
- Main signal match: ✅
- Deviation score: 1.4（略偏，actual 高於 predict）
- 偏因推測：標題式 hook 換成反直覺後實際表現超出歷史中位

## 留言區深度
- 總留言：18
- 5+ 詞留言：11（61% — 高於你帳號平均 42%）✅
- 深度回應 pattern：「我也是」x4、「如果換成」x2
- 自回品質：你回了 6 則，4 則接住反對意見、2 則延伸案例 ✅

## 演算法判讀
- ✅ S2 觸發成功 — replies 高於 p75，主信號達標
- ⚠️ S6 缺圖 — 預估損失 30% time_spent，下次有結構內容加圖
- ⚠️ R5 risk 實現 — diversity enforcement 確實壓了 25% reach（vs 你帳號 baseline）

## 教訓（抽具體不抽空泛）
1. 反直覺首句在你帳號 +40% replies — 加進 style_guide.md
2. 「你會怎麼分」結尾連續 4 篇有效 — pattern 確認
3. 同主題鄰域連發 < 7 天有 25% 折扣 — 加入 freshness budget caveat

## 寫入
- predict.log calibration 已更新
- review.log 新增本次教訓
- style_guide.md 建議補上「反直覺首句 +40%」（待 user 確認）
```

## B2B / 利基帳號特化

- Sends 偏低不是失敗，是受眾結構問題
- Replies 5+ 詞比例 > 50% 算超強表現
- Profile surface 佔比 > 30% 是健康訊號（核心粉持續打開）
- 跨 surface 弱不是問題，是利基帳號的特徵

## 與 Helix 整合

```js
{
  event_type: 'threads_coach_review',
  account: '...',
  post_id: '...',
  predicted_p50: 7,
  actual: 12,
  deviation: 1.4,
  main_signal_match: true,
  insights_found: ['反直覺首句 +40%', '同鄰域連發 -25%'],
  ts: <iso>,
}
```
