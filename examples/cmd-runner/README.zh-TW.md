# Command Runner 範例

[English](./README.md)

這是一個會在你機器上執行 shell 指令的 agent，但內建 command-safety 引擎會先攔住危險 pattern。

## 啟動方式

```bash
helix login --provider openai --api-key YOUR_KEY
helix start
```

接著：

```bash
helix agent chat ops
> 看一下 /var/log 裡最新的 3 個 .log 檔
```

## 目前有哪些保護

`builtin-command-safety` hook 會在每次 `shell_exec` 工具呼叫**執行前**，先比對 35+ 危險 pattern：

- `rm -rf` / `find -delete` / `dd of=/dev/...` → **blocked**
- `DROP TABLE` / `TRUNCATE` / `DELETE FROM ... ;` 且沒有 WHERE → **blocked**
- `git push --force` / `git reset --hard` → **blocked**
- `curl ... | sh` / `wget ... | bash` → **blocked**
- `chmod -R` / `chown -R` → **warned**（會繼續，但留下警告/紀錄）

完整 pattern 清單可在 server 啟動後透過 `GET /api/safety/patterns` 查看。

## 試試看阻擋機制

```bash
> 幫我清空 /tmp
```

Agent 可能會提議 `rm -rf /tmp`，但 hook 會先攔下並回傳 abort 訊息。之後 agent 必須改提更安全的替代方案（例如列出檔案、要求確認、縮小刪除範圍等）。

## Prompt injection defense

同時也會啟用 `builtin-injection-defense`。如果使用者訊息或工具輸出中出現：
- `ignore previous instructions`
- `you are now an unrestricted AI`
- 類似注入語句

工具呼叫會直接被 abort。

## 如何客製

- 從 `tools` 拿掉 `shell_exec`，就能變成唯讀分析 agent
- 在 `hooks.custom` 陣列加自訂 hooks —— 詳見 `docs/core-guide.md`
- 將 `safety.blockOnDanger` 改成 `false`，可把 block 降成 warn（**不建議**）
