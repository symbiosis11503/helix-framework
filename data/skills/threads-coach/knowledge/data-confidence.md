# Data Confidence Rubric（threads-coach 共用）

> 所有 sub-skill 在輸出前都要標一個 confidence tier。
> 這份檔案定義 tier 的判讀標準。

## Tier 定義

| Tier | 同類樣本 N | 時間跨度 | 特徵 |
|---|---|---|---|
| Directional | < 3 | 不限 | 只能說方向，不能說數字 |
| Weak | 3-5 | < 30 天 | 給範圍但寬，不給單點 |
| Usable | 5-10 | < 90 天 | 中位數可信，IQR 可參考 |
| Strong | 10-30 | < 6 個月 | 可做 calibration |
| Deep | 30+ | < 12 個月 | 可做帳號專屬模型微調 |

## 應用規則

### analyze sub-skill
- Directional：只給紅線判讀，信號評分省略
- Weak：紅線 + 信號方向，不給數字
- Usable+：完整三輪輸出

### predict sub-skill
- Directional：拒絕預測，建議補資料
- Weak：給範圍但 p25-p75 寬度 > 4 倍 p50
- Usable：標準 p25/p50/p75 輸出
- Strong+：加 calibration metrics

### topics sub-skill
- 候選清單長度受 tier 影響：Weak 給 3 個，Strong 給 5-7 個
- freshness budget 在 Weak tier 不可信，加注意警告

### review sub-skill
- 沒對應 predict 紀錄時 tier 自動降為 Directional
- 連續 3 次 deviation > 1.5 觸發 sample 重選

## 時間衰減

老資料權重要遞減：

```
weight = exp(-days_old / 90)
```

180 天前的貼文權重 = 0.13，超過 365 天通常排除（除非帳號主題完全沒變）。

## 不能用 tier 偷渡

「我有 N=12 樣本所以 confidence 高」是錯的，要追問：

- 這 N 篇主題鄰域是否真的相近？（cosine > 0.7 才算）
- 時間跨度是否合理？（< 90 天才算 Strong）
- 該帳號近期是否有風格 / 主題大轉向？（有的話舊資料權重歸零）
- metrics 是否完整？（只有 likes 沒 replies 不算 Strong）
