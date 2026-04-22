#!/usr/bin/env bash
# Helix single-binary installer.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/helix-symbiosis/helix-agent-framework/main/scripts/install-binary.sh | bash
#
# Downloads the Helix binary matching your platform, verifies SHA256,
# and places it at ${HELIX_INSTALL_DIR:-/usr/local/bin}/helix.
#
# Env overrides:
#   HELIX_INSTALL_DIR      default: /usr/local/bin
#   HELIX_VERSION          default: latest (e.g. v0.11.0)
#   HELIX_RELEASE_REPO     default: helix-symbiosis/helix-agent-framework

set -euo pipefail

REPO="${HELIX_RELEASE_REPO:-helix-symbiosis/helix-agent-framework}"
VERSION="${HELIX_VERSION:-latest}"
INSTALL_DIR="${HELIX_INSTALL_DIR:-/usr/local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in
  darwin) os_tag="darwin" ;;
  linux)  os_tag="linux"  ;;
  *) echo "Unsupported OS: $os"; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch_tag="arm64" ;;
  x86_64|amd64)  arch_tag="x64"   ;;
  *) echo "Unsupported arch: $arch"; exit 1 ;;
esac
asset="helix-${os_tag}-${arch_tag}"

if [ "$VERSION" = "latest" ]; then
  tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name":' | cut -d'"' -f4)
else
  tag="$VERSION"
fi
[ -z "${tag:-}" ] && { echo "Could not resolve release tag"; exit 1; }

url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
sha_url="${url}.sha256"

echo "Downloading $asset ($tag) ..."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/$asset"

if curl -fsSLI "$sha_url" >/dev/null 2>&1; then
  expected=$(curl -fsSL "$sha_url" | awk '{print $1}')
  actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
  if [ "$expected" != "$actual" ]; then
    echo "SHA256 mismatch!"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    exit 1
  fi
  echo "SHA256 verified."
fi

chmod +x "$tmp/$asset"
if [ -w "$INSTALL_DIR" ]; then
  mv "$tmp/$asset" "$INSTALL_DIR/helix"
else
  echo "Writing $INSTALL_DIR/helix requires sudo."
  sudo mv "$tmp/$asset" "$INSTALL_DIR/helix"
fi

echo ""
"$INSTALL_DIR/helix" --version
echo ""
echo "Installed to $INSTALL_DIR/helix"
echo "Next: helix init"
