---
name: draft
parent: threads-coach
description: |
  從一個主題（topics 模組產出，或使用者直接給）生成 Threads 草稿。
  使用者口吻優先、style_guide 為驅動、algorithm-base 為過濾。
  輸出 1-3 個版本給使用者挑，不單方面決定。
allowed-tools: Read, Glob, Grep
---

# threads-coach / draft

## 操作模式

`draft` 是從 0 到 1 的草稿生成，不是改寫已有貼文（那是 analyze 的事）。

**硬規則**：

1. **必讀 brand_voice.md / style_guide.md**。沒這兩個就先請使用者跑 `/voice` 或 `/setup`。
2. **不重新發明使用者口吻**。draft 出來必須能通過「這像是這人寫的」測試。
3. **每次出 1-3 個版本**，明白標差異。不要只給 1 個版本逼使用者接受。
4. **草稿一定先過 algorithm-base 紅線**。R1-R12 任一命中要在輸出時警告 + 修正版本。
5. **不替使用者拍板**。輸出後說「你覺得哪個方向對？要不要我們在某個版本上再調？」

## 必讀

- `tracker.json`（必要 — 抓近期同主題參考文）
- `style_guide.md`（必要）
- `brand_voice.md`（必要 — 沒有就先跑 `/voice`）
- `concept_library.md`（觀察用）
- `Glob **/knowledge/algorithm-base.md`

## 流程

### Step 1：理解主題

從使用者輸入或 topics 候選提取：
- topic（主題）
- angle（切角）
- target signal（想觸發 sends / replies / time_spent 中的哪個）
- target audience tier（核心粉 / 路人 / 跨 surface 三選一）

如果這 4 項使用者沒給齊，先問清楚。不要靠猜。

### Step 2：抽參考樣本

從 tracker 找：
- 近期同主題鄰域內互動率前 30% 的 3-5 篇
- 同 hook 類型的高互動範例 1-2 篇
- 反例：同主題但低互動的 1 篇（理解什麼不該做）

### Step 3：組裝 3 個草稿版本

不要出一個融合版，要出**明顯差異的 3 個方向**：

**版本 A：直球 hook**
- 第一句反直覺 / 強斷言
- 中段 1-2 個論證或案例
- 結尾開放問句

**版本 B：故事帶入**
- 第一段個人情境（具體時間 / 地點 / 人）
- 第二段普遍化的觀察
- 結尾用情境延伸給讀者

**版本 C：框架整理**
- 第一句點出共通問題
- 中段 list 出 3-5 點解法
- 結尾收一個底層原則 + 「你會怎麼分」

每個版本控制在 280 字內（Threads 上限考量）。

### Step 4：紅線預掃

每個版本逐項過 R1-R12，命中即標警告：

```markdown
## 版本 A
[草稿內容]

⚠️ R5 風險：跟你 4 月 21 日「Bun SEA 心得」主題鄰域重疊 70%。
   如果這篇本週發，2 篇都會被 diversity enforcement 壓。
   建議：拉開到下週發，或加 1-2 句明顯不同切角。
```

### Step 5：信號評分

每個版本給快速 S1/S2/S3 預估：

```markdown
## 版本 A 信號評分
- S1 sends：高（反直覺 + 框架雙具備）
- S2 replies：中（結尾問句設計可改更具體觸發）
- S3 time spent：中（中段論證再加 1 個案例會更穩）
```

### Step 6：drift 觀察

對照 brand_voice，標哪裡偏離：

```markdown
## brand_voice drift
- 「我覺得」在你過去 50 篇出現 8 次，本版 A 用了 3 次（偏多 — 你習慣用「我發現」）
- 收尾「你會怎麼分？」是你常用 pattern（n=11）✅
```

## 輸出格式

```markdown
# Draft — <topic>

## 主題確認
- Topic: ...
- Angle: ...
- Target signal: ...
- Target audience: ...
- 用了 N 篇參考樣本

---

## 版本 A：直球 hook
[280 字內草稿]

⚠️ 紅線：[如有命中]
信號預估：S1=... S2=... S3=...
brand_voice drift：[如有]

---

## 版本 B：故事帶入
...

---

## 版本 C：框架整理
...

---

## 我的初步判斷
基於你的 target signal = replies + B2B niche audience，建議走 B 或 C。
A 走 sends 路線但你的受眾不太互傳。

要不要在 B 或 C 上再調？或你想要不同切角？
```

## B2B / 利基帳號特化

- 草稿不要塞 hashtag stuffing，最多 1-2 個
- 不討讚、不討分享、不 tag 朋友
- 結尾問句要具體（「你怎麼處理 X？」）不要泛問（「你覺得呢？」）
- 寧願窄受眾講深，不要寬受眾講淺

## 反規則

- ❌ 不要單方面送 1 個版本說「就用這個」
- ❌ 不要套通用爆文模板（「99% 的人不知道」這種）
- ❌ 不要寫使用者 brand_voice 沒有的句式
- ❌ 不要在使用者明確說 target signal = replies 時優化 sends

## 與 Helix 整合

draft 完成寫 event：

```js
{
  event_type: 'threads_coach_draft',
  account: 'symbiosis11503',
  topic: '...',
  versions_generated: 3,
  red_lines_warn: ['R5'],
  ts: <iso>,
}
```
