---
name: voice
parent: threads-coach
description: |
  深度分析帳號口吻特徵，產出 brand_voice.md。
  不是寫文模板，是 fingerprint — 用來在 draft 階段保持一致、在 analyze 階段標 drift。
allowed-tools: Read, Glob, Grep
---

# threads-coach / voice

## 與 style_guide 的差別

| | style_guide.md | brand_voice.md |
|---|---|---|
| 由誰產 | setup 自動產 | voice 深度分析產（建議手動觸發） |
| 內容 | 統計數字（hook 種類分佈、結尾類型）| 質性特徵（口吻 / 態度 / 邊界 / 不會說的話）|
| 用途 | 寫作參考 | drift detection + draft 驅動 |
| 更新頻率 | 每次 refresh 自動重算 | 偶爾手動觸發（每月一次或重大轉向時）|

## 必讀

- `tracker.json`（必要）
- `style_guide.md`（既有 baseline）
- `posts_by_topic.md`（人類讀檔，看主題 cluster）
- 該帳號歷史 `brand_voice.md`（如有 — 可以看演變）

## 流程

### Step 1：抽取最近 50-100 篇全文

從 tracker 取近期高互動 + 中等互動 + 低互動各 1/3，避免只看爆文造成偏誤。

### Step 2：質性特徵分析

不是統計，是讀完歸納：

```markdown
# Brand Voice — <handle>

## 整體風格
- 直白、技術優先、口語但不裝萌
- 喜歡用具體數字（n=82 篇有具體 metric）勝於形容詞
- 偏好用「我們」勝過「我」（n=45 vs 23），代表寫作位置在團隊代表，不是個人 KOL

## 態度光譜
| 維度 | 你的位置 | 證據 |
|---|---|---|
| 嚴肅 ↔ 輕鬆 | 偏嚴肅，但會留 1-2 句口語梗 | n=15 篇有「笑點」，多在結尾 |
| 客觀 ↔ 主觀 | 偏客觀但敢有立場 | n=22 篇明確說「我認為」「我反對」 |
| 教學 ↔ 分享 | 偏分享，避免說教 | 「分享心得」遠多於「教你怎麼做」 |
| 高調 ↔ 低調 | 中性偏低，不主動推產品 | 提及 Helix 通常是順帶不是主推 |

## 你會用的句式（fingerprint）
- 「踩過的坑是 X」
- 「我發現 Y」
- 「這個邏輯類似 Z」
- 「先 A 再 B」
- 「不是 X，是 Y」（反直覺切換）

## 你不會用的句式
- 「加油」「夢想」「不要放棄」（勵志風）
- 「99% 的人不知道」（clickbait）
- 「Tag 一個朋友」（engagement bait）
- 「按愛心」（任何 react bait）
- 過量驚嘆號（你最多 1 個 / 篇）

## 你的禁區
- 政治（n=0 篇）
- 宗教（n=0 篇）
- 個人感情（n=0 篇）
- 公司內部八卦（n=0 篇）

## 跟你過去最接近的對標範例
| 你的貼文 | 為什麼 fingerprint 強 |
|---|---|
| 2026-04-18「Bun SEA POC」 | 直白標題、具體 metric、結尾「踩過的坑」 |
| 2026-04-15「Helix 0.10.0 收尾」 | 「先 A 再 B」結構、技術對話風 |

## Manual Refinements（user-edited）

[此區塊保留給使用者手動補充。voice 不會覆蓋這裡。]
- ⚠️ 不要再用「乾淨」這個詞 — 我覺得空洞
- 「降級」「對齊」「收斂」這幾個詞我用太多了，要分散
```

### Step 3：drift detection rule

把上面的 fingerprint 變成 analyze 用的 rules：

```yaml
# voice-drift-rules.yaml
forbidden_phrases:
  - 99% 的人
  - 按愛心如果
  - Tag 一個
  - 不要放棄
  - 加油

prefer_phrases:
  - 踩過的坑
  - 我發現
  - 不是 X 是 Y

style_constraints:
  max_exclamation_per_post: 1
  prefer_specific_numbers: true
  avoid_political_topics: true
```

### Step 4：使用者確認

把 brand_voice.md 給使用者看：「這像不像你？哪裡寫錯了？」

如果使用者糾正，加進 `## Manual Refinements`。voice 不會覆蓋這個區塊。

## 反規則

- ❌ 不要從 1-2 篇貼文歸納口吻（太少資料）
- ❌ 不要把使用者明顯不會用的句式列為 prefer
- ❌ 不要在 voice 階段重寫使用者貼文（那是 draft 的事）
- ❌ 不要替使用者擴張禁區（如 user 沒說禁區，brand_voice 就標 "no explicit forbidden topics observed"）

## B2B / 利基帳號特化

- 偏好句式分析權重升高 — 這類帳號的口吻一致性比 KOL 重要
- 對標範例避開帳號內爆文（避免單篇蓋過整體 voice）
- Manual Refinements 區塊權重最高 — 使用者比演算法更懂自己

## 與 Helix 整合

```js
{
  event_type: 'threads_coach_voice',
  account: '...',
  posts_analyzed: 50,
  fingerprint_phrases: 8,
  forbidden_phrases: 5,
  manual_refinements_count: 2,
  ts: <iso>,
}
```
