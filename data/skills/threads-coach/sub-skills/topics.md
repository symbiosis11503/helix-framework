---
name: topics
parent: threads-coach
description: |
  從歷史貼文 + 留言 + concept library 找下一篇值得寫的主題。
  輸出 3-5 個候選，每個附 freshness、engagement projection、橋接路徑。
allowed-tools: Read, Glob, Grep
---

# threads-coach / topics

## 目標

不是腦力激盪，是**資料驅動的選題**。從使用者自己的歷史和留言中，找：

1. 已有暗示需求但還沒寫到的主題
2. 高互動主題的可延伸切角
3. 與帳號語意鄰域相容的新拓展

## 必讀

- `tracker.json`（必要）
- `concept_library.md`（必要）
- `style_guide.md`（觀察用）
- `Glob **/knowledge/algorithm-base.md` — S7 語意鄰域 + S14 freshness budget 是核心

## 流程

### Step 1：盤點留言區的「未答問題」

掃 `tracker.json` 全部 comments，找：

- 留言中包含問句（？/ ?）但作者沒回的
- 留言中提到「想了解 / 怎麼做 / 細節 / 教學」但原文沒展開的
- 高互動貼文留言區衍生出的子主題

每個列入 `unmet_demand_topics` 候選。

### Step 2：高互動主題的延伸切角

對 tracker 中互動率前 20% 的貼文，分析：

- 主題（從 concept_library 對照）
- 切角（個人經驗 / 框架整理 / 工具評測 / 反直覺斷言）
- 哪些切角還沒寫過

每個列入 `extend_topics` 候選。

### Step 3：freshness budget 過濾

對每個候選，跑：

```
freshness_score = f(
  days_since_last_similar_post,    # 越久越高
  recent_cluster_frequency,         # 越低越高
  semantic_distance_to_recent       # 越遠越高
)
```

如果 `freshness_score < 40` 或 `fatigue_risk = High`，從候選剔除。

S14 的判讀規則直接搬：「同領域可以一直講，同語意群 + 同切角 + 同承諾句型 = 快速消耗新鮮度」。

### Step 4：與帳號語意鄰域相容性

對每個候選，計算：

```
neighborhood_compatibility = cosine_similarity(
  candidate_embedding,
  account_centroid_embedding
)
```

- > 0.7：核心主題，可直接寫
- 0.4-0.7：邊緣主題，需要橋接（用既有主題引出新主題）
- < 0.4：跳得太遠，建議改天再寫，或先用 1-2 篇橋接內容鋪路

### Step 5：engagement projection

從 tracker 抽近 N 篇同主題鄰域的中位互動率，給範圍：

```
projected_engagement_rate: { p25, p50, p75 }
projected_likely_top_signal: 'sends' | 'replies' | 'time_spent'
```

不是預言，是「歷史上同類貼文的中位表現」。

## 輸出格式

```markdown
# Topic Suggestions — 2026-04-23

## 候選 1：「為什麼我把 LINE@ 當入口而不是終點」
- 來源：unmet_demand_topics（lin.li.hsin / 4 個其他留言提到 LINE@ 但沒展開）
- 切角：個人經驗 + 反直覺斷言（你目前主要寫框架整理，這切角少用）
- Freshness：85（30 天內無相關文）
- Neighborhood compatibility：0.82（核心主題）
- Projected engagement：p25=8 / p50=15 / p75=28（基於近 6 篇商業策略類文）
- Likely top signal：replies（B2B 受眾愛留實戰意見）
- 建議句首：「LINE@ 是入口，不是終點 — 這是我幫工廠導入後最痛的領悟」
- 為什麼值得寫：S2 高（會引發「我也是」/「我反而覺得」留言）；S8 強化既有信任資產

## 候選 2：「Bun SEA 在生產環境踩到的 3 個雷」
- 來源：extend_topics（你寫了 Bun SEA POC 但沒寫實戰問題）
- 切角：技術坑分享（這切角你過去 5 篇平均互動 +40%）
- Freshness：100（從沒寫過實戰問題）
- Neighborhood compatibility：0.91（核心 AI 工程鄰域）
- Projected engagement：p25=12 / p50=22 / p75=45
- Likely top signal：sends + replies（技術同行愛轉 + 補自己案例）
- 建議句首：「Bun SEA 表面看完美，但這 3 個雷你部署前最好先知道」
- 為什麼值得寫：你是少數實際 SEA 跑生產的人，B2B 技術同行會立刻轉

## 候選 3：「為什麼我們做 Helix 不做 LangChain」
- 來源：extend_topics（Helix 主題你寫過 12 次但都在介紹功能，沒寫過 positioning）
- ...
```

## 反規則

- ❌ 不要憑空建議「最近 X 很紅你可以蹭」— 這是 KOL 邏輯，不是利基帳號邏輯
- ❌ 不要建議跨太遠的主題（< 0.4 compatibility）即使 freshness 很高
- ❌ 不要把熱門 topic tag 直接當主題建議

## B2B / 利基帳號特化

- 留言中的「未答問題」權重最高 — 這些是已有受眾的需求
- 高 sends 不是核心 KPI，高 replies + 留言區深度才是
- 拓展新主題要保守，每月最多 1 個邊緣鄰域實驗
