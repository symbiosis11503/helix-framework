#!/usr/bin/env bash
# Smoke test for the cmd-runner example.
# Verifies the config parses, helix CLI is reachable, and (if an API key is set)
# the agent runtime can boot.

set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)

step() { printf '\n▶ %s\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
skip() { printf '  ⊝ %s (skipped: %s)\n' "$1" "$2"; }

step "Config parse"
node --check "$HERE/helix.config.js"
ok "helix.config.js syntax"

step "CLI available"
if command -v helix >/dev/null 2>&1; then
  HELIX=helix
elif [ -f "$HERE/../../bin/helix.js" ]; then
  HELIX="node $HERE/../../bin/helix.js"
else
  echo "helix CLI not found — install with: npm install -g helix-agent-framework"
  exit 1
fi
$HELIX --version
ok "helix CLI responds ($HELIX)"

step "Doctor"
(cd "$HERE" && $HELIX doctor || true)
ok "helix doctor ran"

step "Runtime boot"
if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
  skip "helix start" "no LLM API key set"
  exit 0
fi

(cd "$HERE" && $HELIX start --port 18862 &)
PID=$!
sleep 3
if curl -fsS --max-time 3 http://127.0.0.1:18862/api/health >/dev/null 2>&1; then
  ok "runtime responds on :18862"
else
  echo "  ✗ runtime did not come up on :18862"
  kill $PID 2>/dev/null || true
  exit 1
fi
kill $PID 2>/dev/null || true

echo
echo "✅ cmd-runner smoke passed"
