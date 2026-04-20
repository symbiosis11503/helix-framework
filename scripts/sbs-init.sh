#!/bin/bash
# SBS Project Bootstrap Harness
# Install AI collaboration scaffold into any project repo
# Usage: bash scripts/sbs-init.sh (run from project root)

set -e

echo "🚀 SBS Project Bootstrap Harness v1.0"
echo "======================================"

# Prevent running inside SBS itself
if [ -f "src/agent-core.js" ] || [ -f "src/index.js" ] && grep -q "symbiosis-helix" package.json 2>/dev/null; then
  echo "❌ 不能在 SBS Helix 自己的 repo 裡安裝"
  exit 1
fi

# Files to create
MANAGED_FILES=(
  "CLAUDE.md"
  "AI_CONTEXT.md"
  ".agents/memory.md"
  ".agents/skills/debug-pipeline.md"
  ".agents/skills/deploy-checklist.md"
  "docs/knowledge/.gitkeep"
  "docs/raw/.gitkeep"
)

# Check existing files
EXISTING=()
for f in "${MANAGED_FILES[@]}"; do
  [ -f "$f" ] && EXISTING+=("$f")
done

if [ ${#EXISTING[@]} -gt 0 ]; then
  echo "⚠️ 以下檔案已存在，會被覆蓋："
  printf '  %s\n' "${EXISTING[@]}"
  read -p "繼續？ (y/N) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
fi

# Create directories and .gitkeep files
mkdir -p .agents/skills docs/knowledge docs/raw
touch docs/knowledge/.gitkeep docs/raw/.gitkeep

# CLAUDE.md — Master Router
cat > CLAUDE.md << 'TEMPLATE'
# AI 協作指南

## 身份
你是這個專案的 AI 協作夥伴。

## 工作流
1. 先讀 AI_CONTEXT.md 了解專案背景
2. 檢查 .agents/memory.md 了解最近進度
3. 有 SOP 就用 .agents/skills/ 裡的
4. 完成後更新 memory.md

## 規則
- 不要改已標記 do_not_rerun 的項目
- 先讀再改，不要猜
- 改完要測
TEMPLATE

# AI_CONTEXT.md — Project Facts
cat > AI_CONTEXT.md << 'TEMPLATE'
# 專案背景

## 專案名稱
(填入專案名)

## 技術棧
(填入使用的技術)

## 目錄結構
(填入關鍵目錄說明)

## 重要規則
(填入不可違反的規則)
TEMPLATE

# Memory
cat > .agents/memory.md << 'TEMPLATE'
# Agent 記憶

## 最近完成
(每次 session 結束時更新)

## 待辦
(下次 session 要做的事)

## 教訓
(做錯的事和學到的教訓)
TEMPLATE

# Skills
cat > .agents/skills/debug-pipeline.md << 'TEMPLATE'
# Debug Pipeline SOP

1. 重現問題（找到最小重現步驟）
2. 檢查日誌（錯誤訊息、stack trace）
3. 定位根因（不要猜，要有證據）
4. 修復並驗證
5. 更新 memory.md
TEMPLATE

cat > .agents/skills/deploy-checklist.md << 'TEMPLATE'
# Deploy Checklist

- [ ] 所有測試通過
- [ ] 沒有新的 lint warnings
- [ ] 環境變數確認
- [ ] 資料庫 migration 已跑
- [ ] 部署後 smoke test
- [ ] 更新 VERSION 或 changelog
TEMPLATE

echo ""
echo "✅ SBS 協作骨架已安裝："
echo "  CLAUDE.md          — AI 工作流路由"
echo "  AI_CONTEXT.md      — 專案背景事實"
echo "  .agents/memory.md  — 跨 session 記憶"
echo "  .agents/skills/    — SOP 流程範本"
echo "  docs/knowledge/    — 結構化知識庫"
echo "  docs/raw/          — 原始研究筆記"
echo ""
echo "下一步：編輯 AI_CONTEXT.md 填入你的專案資訊"
