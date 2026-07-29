#!/usr/bin/env bash
set -euo pipefail

# Installs the latest video-link-debugger release for this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.sh | bash
#
# Pass arguments to run it immediately after installing:
#
#   curl -fsSL https://raw.githubusercontent.com/TorBox-App/video-link-debugger/main/install.sh | bash -s -- test https://example.com/video.mp4
#
# Environment overrides:
#   VERSION      release tag to install, e.g. v1.1.0 (default: latest stable release)
#   INSTALL_DIR  where to put the binary (default: ~/.local/bin)

REPO="TorBox-App/video-link-debugger"
NAME="video-link-debugger"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

error() { printf 'error: %s\n' "$1" >&2; exit 1; }

os="$(uname -s)"
arch="$(uname -m)"
ext=""

case "$os" in
  Darwin)
    # Only an Apple Silicon build is published; also catch arm64 Macs running under Rosetta.
    if [ "$arch" = "arm64" ] || [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
      asset="$NAME-darwin-arm64"
    else
      error "no macOS Intel build is published (Apple Silicon only)"
    fi
    ;;
  Linux)
    case "$arch" in
      x86_64|amd64)
        # CPUs without AVX2 need the baseline build.
        if grep -qi avx2 /proc/cpuinfo 2>/dev/null; then
          asset="$NAME-linux-x64"
        else
          asset="$NAME-linux-x64-baseline"
        fi
        ;;
      aarch64|arm64) asset="$NAME-linux-arm64" ;;
      *) error "unsupported Linux architecture: $arch" ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ext=".exe"
    case "$arch" in
      x86_64|amd64) asset="$NAME-windows-x64.exe" ;;
      aarch64|arm64) asset="$NAME-windows-arm64.exe" ;;
      *) error "unsupported Windows architecture: $arch" ;;
    esac
    ;;
  *)
    error "unsupported OS: $os (on native Windows, use install.ps1 instead)"
    ;;
esac

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/$REPO/releases/latest/download/$asset"
else
  url="https://github.com/$REPO/releases/download/$VERSION/$asset"
fi

bin="$INSTALL_DIR/$NAME$ext"
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

printf 'Downloading %s (%s)...\n' "$asset" "$VERSION" >&2
if command -v curl >/dev/null 2>&1; then
  curl -fSL --progress-bar -o "$tmp" "$url" || error "download failed: $url"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url" || error "download failed: $url"
else
  error "need curl or wget to download"
fi

chmod +x "$tmp"
mv "$tmp" "$bin"
trap - EXIT

# macOS Gatekeeper blocks unsigned quarantined binaries.
if [ "$os" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$bin" 2>/dev/null || true
fi

printf 'Installed %s\n' "$bin" >&2

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    printf '\nNote: %s is not on your PATH. Add it with:\n' "$INSTALL_DIR" >&2
    printf '  export PATH="%s:$PATH"\n' "$INSTALL_DIR" >&2
    ;;
esac

if [ $# -gt 0 ]; then
  exec "$bin" "$@"
fi

printf '\nRun it with:\n  %s test https://example.com/video.mp4\n' "$NAME" >&2
