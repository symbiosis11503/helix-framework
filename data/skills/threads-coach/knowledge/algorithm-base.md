# Threads / Meta 演算法判讀基礎（threads-coach 內建知識庫）

> 本文件由 helix-framework 維護，依據 Meta 公開資料原文撰寫。
> 最後更新：2026-04-23
> 來源驗證原則：每條規則必須能對應到 Meta 官方公告、申請專利、洩露文件或第三方研究。
> 任何「KOL 觀察」一律不入此檔。

---

## 怎麼用這份知識庫

兩個區塊：

- **R 系列（Red Lines / 紅線）** — 命中即降權，不是建議是警告。
- **S 系列（Signals / 信號）** — 不是硬規則，是動態評分依據。

每條後面標 `[來源]`，給編號方便交叉查證；`[評估點]` 標哪個 sub-skill 會用。

---

## R 系列：紅線（命中即降權）

### R1. Engagement Bait（互動誘導）

**規則**：禁止用「按愛心如果你 X」「Tag 一個朋友」「留言 +1」等句式直接索取互動。

**Meta 怎麼偵測**：機器學習模型，覆蓋 25+ 語言，圖內文字也會 OCR 進去。

**典型 5 種**：
- React bait — 「按愛心如果你同意」
- Vote bait — 「按愛心選 A，按哈哈選 B」
- Share bait — 「分享給需要的朋友」
- Tag bait — 「Tag 一個會用到的人」
- Comment bait — 「留言 YES」「+1」

**累犯機制**：多次觸發後不只該篇被壓，整個帳號的觸及都會被壓。

**[來源]** Meta 2017-12-18 News Feed FYI: Fighting Engagement Bait
**[評估點]** analyze sub-skill 第一輪掃描

---

### R2. Clickbait（標題殺人）

**規則**：首句不得使用聳動誘騙句式（「你絕對不會相信」「99% 的人不知道」），不得過量驚嘆號，首句承諾必須在正文兌現。

**Meta 怎麼偵測**：對首句和整體語氣做模式比對，並追蹤「點開後停留時間」與承諾的落差。

**[來源]** Meta 2017-05-17 News Feed Update: Reducing Clickbait Headlines
**[評估點]** analyze sub-skill 第一輪掃描

---

### R3. 首句與正文不一致

**規則**：hook 可以強，但不能詐。首句說「大家都搞錯了 X」，正文就要證明哪裡錯。

**Meta 怎麼想**：2025 年 4 月 Cracking Down on Spammy Content 公告明確點名「caption 與內容不符」是要打擊的目標。雖然該公告主軸是 Facebook，但 Meta 推薦系統的整體方向是同步收斂。

**[來源]** Meta 2025-04 Cracking Down on Spammy Content on Facebook
**[評估點]** analyze sub-skill 第一輪掃描，比對首句語意 vs 正文重點

---

### R4. 低品質原創 / 搬運

**規則**：與帳號近期貼文相似度 70%+ 觸發警告。轉發別人內容若沒有實質新增（自己的分析、結論、實測、框架），會被歸為低品質原創。

**會被判搬運的特徵**：
- 帶其他平台浮水印
- 高相似度重發（換幾個字再發）
- 加 logo / 字幕 / BGM 不算高品質轉化

**[來源]** Meta Recommendation Guidelines（2020-08-11 publish，持續更新）
**[評估點]** analyze sub-skill 第一輪掃描，需 tracker 比對近 N 篇

---

### R5. 連續同主題（Diversity Enforcement）

**規則**：短時間內發語意過於相近的內容，會被多樣性機制壓觸及。

**核心精神**：
- 同領域可以
- 同角度不行
- 同結論換包裝也不行

**Meta 內部機制**：US9336553B2 專利公開「Diversity Enforcement」推薦多樣性策略。

**[來源]** US Patent US9336553B2 Diversity in Content Item Recommendations
**[評估點]** analyze 用 tracker 比對近 3-5 篇；topics 用語意鄰域查重

---

### R6. 低品質外部連結

**規則**：Meta 對廣告過多、載入慢、SEO 垃圾頁的連結長期負面態度。

**判讀**：能不靠連結就講清楚的，先在貼文內講清楚。真要放連結，優先高信譽來源。

**[來源]** Meta 2017-05-17 News Feed Update: New Updates to Reduce Clickbait
**[評估點]** analyze 第一輪掃描

---

### R7. 敏感主題的聳動表述

**規則**：政治 / 健康 / 財務 / 性暗示 / 仇恨等主題受推薦限制，即便沒有違規也可能降分發。

| 主題 | 風險 | 怎麼寫 |
|---|---|---|
| 政治 / 公民議題 | 個人化分發限制 | 主題明確、受眾明確、語氣克制、觀點有根據 |
| 健康聲明 | 嚴格審查 | 不武斷、不誇大、不像保證 |
| 財務聲明 | 嚴格審查 | 避免未經證實的回報承諾 |
| 性暗示 / 血腥 / 邊緣仇恨 | 推薦限制 | 即使沒被刪也可能降分發 |

**Meta 2025-01-07 公告**：政治 / civic content 改為更個人化分發，這類內容更吃「受眾本來就對此有興趣」的信號。

**[來源]** Meta 2025-01-07 More Speech and Fewer Mistakes
**[評估點]** analyze 第一輪掃描，遇敏感主題觸發附加檢查

---

### R8. 容易引發 Negative Feedback

**規則**：Meta 提供 Not Interested / Hidden Words / Recommendations Reset 等控制工具，這些顯性偏好直接餵推薦訓練。

**最該避免的不是沒互動，是讓不對的人快速按 Not Interested**。

**容易引發負面回饋的寫法**：
- 首句太聳動但正文很空
- 首句講 A 但內容講 B
- 同樣論點一直重講
- 跟受眾預期嚴重不符

**[來源]** Meta 2024-11-19 Reshape Your Instagram With a Recommendations Reset; Meta 2026-02-11 Threads Dear Algo
**[評估點]** analyze 第二輪預判

---

### R9. 主題混雜

**規則**：一篇文只打一個主題中心。前半講 SEO 後半跳創業心法 = 系統判讀混亂。

**Threads 官方 2025**：帶 topic 的貼文通常拿到更多 views。背後不只是「加標籤」而是系統能更快判定這篇在講什麼。

**[來源]** Meta 2025-03 New Threads Features for a More Personalized Experience
**[評估點]** analyze 第二輪預判

---

### R10. AI 內容未標示

**規則**：Meta 對 AI 寫實內容（圖片 / 影片）有標示要求，欺騙性高的風險最大。可發布 ≠ 可被推薦。

**[來源]** Meta AI Content Disclosure Policy（持續更新）
**[評估點]** analyze 第一輪掃描

---

### R11. 圖文不一致

**規則**：圖片 / 影片 / 首句 / 正文不能各講各的。

圖片應該做以下三種事之一：
- 視覺化一個重點
- 提供案例證據
- 提高可理解度

**[來源]** Meta Recommendation Guidelines
**[評估點]** analyze 第一輪掃描，需多模態判讀

---

### R12. 軟性降權項（累積才嚴重）

**規則**：以下單項命中不致命，但 2 項以上同時出現會被歸到低品質分發桶：

- 內容像為演算法寫，不像為人寫
- 太多泛用廢話、無資訊增量
- 留言區全是短句灌水（M8 追蹤）
- 連續幾篇講幾乎一樣的東西
- 被動瀏覽比例偏高（M8 追蹤；通常代表第一行沒抓住人）

**[來源]** Meta 2025-04 Cracking Down on Spammy Content; US Patent US9959412B2 Content Quality Evaluation
**[評估點]** analyze 第二輪預判

---

## S 系列：信號（動態評分）

### S1. 私訊分享（Sends / DM Shares）— 最強信號

**權重**：Mosseri 2025 年確認，私訊分享的權重是按讚的 3-5 倍。

**為什麼最強**：使用者願意拿自己的社交關係去背書你的內容。

**最容易被私訊分享的內容特徵**：
- 幫人講出他說不清的觀點
- 幫人省時間的整理
- 反直覺但有根據的結論
- 可以拿去當談資的框架

**[來源]** Mosseri 2025 公開訪談（多次重申）
**[評估點]** analyze 第三輪信號評估

---

### S2. 深度留言（5+ 詞）

**歷史權重**：MSI 計分歷史值（2018 洩露），有意義留言（5+ 詞或含圖片影片）= 30 分，Like = 1 分。**一則 5+ 詞的留言歷史上值 30 個 Like**。

2020 年修正後留言權重沒降，代表 Meta 長期認為留言是最真實的互動信號。

**最好引發的留言類型**：
- 「我不同意，因為...」
- 「我遇過更極端的版本...」
- 「如果換成某個情境呢？」

**最差**：
- 「你覺得呢？」（討留言）
- 「留言告訴我」（comment bait，紅線）
- 「+1」

**[來源]** Facebook Papers / Frances Haugen 洩露文件 2021；CNN / Washington Post 確認
**[評估點]** analyze 第三輪；review 追蹤實際 5+ 詞留言比例

---

### S3. 停留時間（Watch Time / Reading Time）

**Meta 重視**：US Patent US10404817B2 Time Spent Measurement。

**規則**：長文不是問題，無效長文才是問題。每段必須有資訊增量，重複換句話說會被標記。

**怎麼設計**：
- 前 1-2 句讓人停下來
- 中間有節點讓人想繼續讀
- 每一段都在推進，不要重複

**[來源]** US Patent US10404817B2; Meta News Feed FYI: Counting Time Spent on Posts
**[評估點]** analyze 第三輪

---

### S4. 互動者身份（關係信號）

**核心**：Facebook Papers 與多份專利（US9286575B2、US10733254B2）顯示，平台不只看互動量，更看誰在互動。核心粉絲、歷史互動者的信號比路人強。

**怎麼用**：你不是要討所有人喜歡。先讓最懂你的人願意回。寫法上敢有立場、不要把邊界磨平。

**[來源]** Facebook Papers; US Patents US9286575B2, US10733254B2
**[評估點]** review 用 tracker 拆「核心粉絲互動 vs 路人互動」比例

---

### S5. 按讚（弱信號）

**真相**：Like 一直不是最有價值的互動。高讚低留言的文不一定是好文。只會讓人快速點讚的文，通常不夠撐第二輪分發。

| 互動類型 | 歷史 MSI 分數 | 備註 |
|---|---|---|
| Like | 1 | 基準線 |
| Reaction emoji | 5 | 怒怒後降為 0 |
| Reshare（不加文字） | 5 → 1.5（2020修正） | 大幅下調，防低品質轉發 |
| RSVP 活動 | 15 | — |
| 有意義留言（5+ 詞） | 30 | 最高權重 |

**權重排序（建議優先追求）**：有意義留言 >> 私訊分享 >> 分享 > 按讚。

**[來源]** Facebook Papers MSI 2018 洩露版
**[評估點]** review 不作為核心 KPI

---

### S6. 圖文組合

**Buffer 2026 跨平台 52M+ 貼文分析**：Threads 上圖片貼文中位互動率比純文字高約 60%，比含連結貼文高 37%。

**規則**：不是每篇都硬塞圖。圖的作用是增加停留 + 理解度，不是裝飾。截圖、數據表、示意圖優於 stock photo。

**[來源]** Buffer Threads Engagement Analysis 2026
**[評估點]** analyze 第三輪建議是否加圖

---

### S7. 語意鄰域一致性

**核心**：Threads 用 AI 把帳號歸類到內容 neighbourhoods，基於反覆使用的關鍵詞和主題。

**規則**：
- 持續強化帳號的語意鄰域，不要偶爾跳完全無關的主題
- 要拓展新主題用「橋接」（從已知主題延伸），不要硬跳

**[來源]** Meta 2025-03 Threads Personalization Update
**[評估點]** analyze 第三輪；topics 拓展時觸發橋接判定

---

### S8. Trust Graph（2026 重點）

**Mosseri 2025 年底年終公開信**：Meta 從 Social Graph → Interest Graph → 現在進入 Trust Graph（看誰值得被信任）。

**AI 內容氾濫時代，能持續展現「真人、有立場、有歷史紀錄」的帳號會越來越被優待。**

**實戰意義**：
- 持續用一致的人設和主題發文，比追熱點更重要
- 歷史貼文紀錄就是信任資產，不要為了短期流量破壞一致性
- 跨平台行為也會影響理解：同一個人設、同一群受眾、同一套主題宇宙比每個平台各講各的更容易累積信號

**對 B2B / 利基帳號特別重要**：受眾基本盤本來就小，Trust Graph 比追熱點更該優先打。

**[來源]** Mosseri 2025 年終公開信（多平台同步發布）
**[評估點]** review 長期追蹤帳號一致性指標

---

### S9. 可發布 vs 可被推薦

**Meta Recommendation Guidelines** 區分「沒違規」與「會被推薦」。

| 內容類型 | 推薦狀態 |
|---|---|
| 一般知識 / 案例 / 觀點 | 容易被推薦 |
| 政治 / 社會議題 | 個人化限制 |
| 健康 / 財務聲明 | 嚴格看待 |
| 性暗示 / 血腥 / 邊緣仇恨 | 推薦限制 |
| AI 寫實內容未標示 | 風險最大 |

**核心提問**：不要只問「會不會違規」，要問「就算過審，系統會不會想把它推薦給陌生人」。

**[來源]** Meta Recommendation Guidelines
**[評估點]** analyze 邊緣內容附加提醒

---

### S10. 小帳號初始曝光

**Meta US Patent US10540359B2** Small Account Boosting：小帳號常有初始曝光加成，但前提是內容過基本品質線。

**[來源]** US Patent US10540359B2
**[評估點]** review 帳號成長階段判讀

---

### S11. Discovery Surface（內容從哪被看見）

**為什麼要拆來源面**：同樣 1000 views，來源不同代表機制完全不同。

| 來源 | 代表 |
|---|---|
| Threads feed | 主題語意 + 帳號信任都還可以 |
| Instagram / Facebook | 跨 app 興趣圖譜接到 |
| Profile | follower-fit / 已有信任 |
| Topic feed | 主題標記 + 主題辨識清楚 |

**規則**：沒有 discovery data 時不要假裝精準，只能說「未知」。

**[來源]** Threads Creator Insights 介面（2025-2026 持續推出）
**[評估點]** review 結合實際 insights 拆來源

---

### S12. Topic Graph Strength

**核心**：不是「有沒有 tag」而是系統能不能很快判斷這篇在講什麼。

**高分特徵**：
- 首句兩句內就能知道主題
- 全文只推一個中心問題
- topic tag 和正文高度一致
- 主題和帳號既有信任圖譜相容

**低分特徵**：
- 前半講 A，後半跳 B
- tag 很熱但正文不是在講那個
- 帳號平常講 SEO，突然講不相干主題

**[來源]** Meta 2025-03 Threads Topic Update
**[評估點]** analyze 第三輪 + topics 主題清晰度

---

### S13. Originality / Spam Risk Spectrum

**Meta 2025-04 Cracking Down on Spammy Content** 明確：不是只有違規才被壓，低價值、錯配、像鑽系統漏洞的內容也會在推薦層被壓。

**追蹤欄位**（用於 tracker.json）：
- `caption_content_mismatch`
- `hashtag_stuffing_risk`
- `duplicate_cluster_risk`
- `minor_edit_repost_risk`
- `low_value_reaction_risk`
- `fake_engagement_pattern_risk`

**判讀**：多個弱風險同時累積會讓系統把你歸到低品質分發桶。

**[來源]** Meta 2025-04 Cracking Down on Spammy Content
**[評估點]** analyze 第二輪 + review 累積追蹤

---

### S14. Topic Freshness Budget（題材疲勞）

**核心**：不是只看「同一關鍵字」。真正會壓觸及的是連續發**語意很近、切角也很近**的內容。

**判讀規則**：
- 同領域可以一直講
- 同語意群可以重複出現
- 同語意群 + 同切角 + 同承諾句型 = 快速消耗新鮮度

**追蹤欄位**：
- `semantic_cluster`
- `similar_recent_posts`
- `recent_cluster_frequency`
- `days_since_last_similar_post`
- `freshness_score`（0-100）
- `fatigue_risk`（Low / Medium / High）

**對小帳號特別重要**：探索分發更容易被「最近都在講一樣的東西」卡住。

**[評估點]** topics 推薦下一篇主題；analyze 第三輪 freshness budget

---

## 北極星

不管結構怎麼變，這 4 件事是最終 KPI（不是讚數）：

1. 這篇文有沒有讓**對的人**停下來？
2. 這篇文有沒有讓人願意寫**完整一句話**？
3. 這篇文有沒有讓人想把它**丟進私訊**？
4. 這篇文有沒有讓**留言區變成第二內容場**？

---

## 證據索引

### Meta 官方公告

- 2017-05-17 News Feed Update: Reducing Clickbait Headlines
- 2017-12-18 News Feed FYI: Fighting Engagement Bait
- 2020-08-11 Recommendation Guidelines
- 2021-04-22 Incorporating More Feedback Into News Feed Ranking
- 2024-11-19 Reshape Your Instagram With a Recommendations Reset
- 2025-01-07 Meta More Speech and Fewer Mistakes
- 2025-03 New Threads Features for a More Personalized Experience
- 2025-04 Cracking Down on Spammy Content on Facebook
- 2026-02-11 Threads Dear Algo

### 洩露 / 訴訟 / 媒體

- Facebook Papers / Frances Haugen 洩露文件，2021
- CNN / Washington Post 報導與美國國會證詞
- New York Attorney General multistate lawsuit against Meta，2023-10

### Meta 申請專利（US Patent）

- US9378529B2 Expected Value Scoring
- US9286575B2 Adaptive Ranking Model
- US10909454B2 / US11657253B1 Multi-task Neural Network Ranking
- US10635732B2 Content Reselection / Second-chance Dynamics
- US10733254B2 Click-based Interest Tiers
- US9959412B2 Content Quality Evaluation
- US20190095544A1 Behavioral Quality Signals
- US10120945B2 Human Rater Quality Criteria
- US9582812B2 Pairwise Quality Prediction
- US10540359B2 Small Account Boosting
- US10063513B2 Temporal Relevance
- US9336553B2 Diversity Enforcement
- US9152675B2 Comment / Reply Ranking
- US10404817B2 Time Spent Measurement

### 第三方研究

- Buffer Threads Engagement Analysis 2026（52M+ 貼文）
- Mosseri 2025 年終公開信（Trust Graph 概念）

---

## 待持續追蹤

- Threads 官方是否會明確公開 sends / replies / time spent 排序口徑
- Topic Tags 實際最佳用法
- Threads Insights discovery surface 是否會公開更多細節
- AI 內容標示 vs 未標示的實際分發差異
