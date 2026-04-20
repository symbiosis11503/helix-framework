#!/bin/bash
# Build a portable Helix bundle for the current host OS/arch.
# Output: dist/helix-portable-<os>-<arch>.tar.gz
#
# Contents (unpacks to ./helix-portable/):
#   node           — Node.js runtime binary (copied from system)
#   helix          — launcher shell script
#   helix-bundle.mjs    — esbuild-bundled Helix (ESM, 1.4 MB)
#   node_modules/  — better-sqlite3 + pg with native prebuilds for this OS/arch
#   README.txt     — quick start for end user

set -e

OS=$(uname -s | tr '[:upper:]' '[:lower:]')  # darwin / linux
ARCH=$(uname -m)                              # arm64 / x86_64
TARGET="${OS}-${ARCH}"
OUT_DIR="dist/helix-portable-${TARGET}"

echo "==> Building portable Helix for ${TARGET}"

# 1. Always rebuild bundle (cheap at 40ms; avoids stale-bundle bugs)
echo "==> Running esbuild bundle"
npm run build:bundle

# 2. Clean + create output
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/node_modules"

# 3. Copy node binary
cp "$(which node)" "${OUT_DIR}/node"
chmod +x "${OUT_DIR}/node"

# 4. Copy bundle + package.json (server-lite reads version from it at runtime)
cp dist/helix-bundle.mjs "${OUT_DIR}/helix-bundle.mjs"
cp package.json "${OUT_DIR}/package.json"

# 5. Copy native dep modules (the whole package so prebuild-install artifacts travel)
for dep in better-sqlite3 bindings file-uri-to-path pg pg-types pg-connection-string pg-protocol pg-pool pgpass split2 xtend postgres-interval postgres-date postgres-bytea postgres-array; do
  if [ -d "node_modules/${dep}" ]; then
    mkdir -p "${OUT_DIR}/node_modules/${dep}"
    cp -r "node_modules/${dep}"/* "${OUT_DIR}/node_modules/${dep}/" 2>/dev/null || true
  fi
done

# 6. Launcher script
cat > "${OUT_DIR}/helix" <<'EOF'
#!/bin/bash
# Helix portable launcher — resolves its own directory + runs bundled helix
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SELF}/node" "${SELF}/helix-bundle.mjs" "$@"
EOF
chmod +x "${OUT_DIR}/helix"

# 7. README
cat > "${OUT_DIR}/README.txt" <<EOF
Helix Portable — ${TARGET}
================================

Quick start:
  ./helix init      # initialize project
  ./helix login     # set API key
  ./helix start     # start runtime (http://localhost:18860/v2/)

Add to PATH (optional):
  export PATH="\$(pwd):\$PATH"

This bundle includes Node.js ${TARGET} + helix ESM bundle + native modules.
No separate installation needed.

Website: https://symbiosis.tw/helix/
npm:     https://www.npmjs.com/package/helix-agent-framework
GitHub:  https://github.com/symbiosis11503/helix-framework
EOF

# 8. Tarball
cd dist
tar -czf "helix-portable-${TARGET}.tar.gz" "helix-portable-${TARGET}"
SIZE=$(du -h "helix-portable-${TARGET}.tar.gz" | cut -f1)
cd ..

echo "==> Done: dist/helix-portable-${TARGET}.tar.gz (${SIZE})"
echo "==> Test locally:"
echo "    mkdir -p /tmp/helix-portable-test && cd /tmp/helix-portable-test"
echo "    tar -xzf \$(pwd)/dist/helix-portable-${TARGET}.tar.gz"
echo "    ./helix-portable-${TARGET}/helix --version"
