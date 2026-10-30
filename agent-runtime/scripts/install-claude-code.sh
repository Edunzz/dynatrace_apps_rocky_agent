#!/usr/bin/env bash
# Build-time installer for a pinned Claude Code release (native binary).
#
# Usage: install-claude-code.sh <destination-dir>
# Required environment: CLAUDE_CODE_VERSION (for example 2.1.308), TARGETARCH (amd64|arm64)
# Optional pinned digests: CLAUDE_CODE_SHA256_AMD64, CLAUDE_CODE_SHA256_ARM64
#
# Verification, as documented at https://code.claude.com/docs/en/setup:
#   1. manifest.json is signed with Anthropic's release key (fingerprint below);
#   2. the binary matches the manifest checksum and, when provided, the pinned digest.
# No remote script is executed.

set -Eeuo pipefail

dest="${1:?usage: install-claude-code.sh <destination-dir>}"
version="${CLAUDE_CODE_VERSION:?CLAUDE_CODE_VERSION is required}"
arch="${TARGETARCH:-$(dpkg --print-architecture 2>/dev/null || uname -m)}"
case "$arch" in
  amd64 | x86_64) platform=linux-x64; pinned="${CLAUDE_CODE_SHA256_AMD64:-}" ;;
  arm64 | aarch64) platform=linux-arm64; pinned="${CLAUDE_CODE_SHA256_ARM64:-}" ;;
  *) echo "install-claude-code: unsupported architecture '$arch'" >&2; exit 1 ;;
esac
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install-claude-code: CLAUDE_CODE_VERSION must be X.Y.Z" >&2; exit 1; }

FINGERPRINT="31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE"
base="https://downloads.claude.ai/claude-code-releases/${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fetch() { curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1"; }

fetch "$base/manifest.json" "$work/manifest.json"
fetch "$base/manifest.json.sig" "$work/manifest.json.sig"
fetch "https://downloads.claude.ai/keys/claude-code.asc" "$work/key.asc"

# gpgv checks a detached signature against a keyring file; no gpg-agent needed.
export GNUPGHOME="$work/gnupg"
mkdir "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
gpg --batch --dearmor -o "$work/key.gpg" "$work/key.asc"
status="$(gpgv --status-fd 1 --keyring "$work/key.gpg" "$work/manifest.json.sig" "$work/manifest.json" 2>/dev/null || true)"
if ! grep -q "^\[GNUPG:\] VALIDSIG ${FINGERPRINT} " <<<"$status"; then
  echo "install-claude-code: manifest.json is not signed by the Claude Code release key ${FINGERPRINT}" >&2
  exit 1
fi

[[ "$(jq -r .version "$work/manifest.json")" == "$version" ]] || { echo "install-claude-code: manifest version mismatch" >&2; exit 1; }
published="$(jq -r --arg p "$platform" '.platforms[$p].checksum // empty' "$work/manifest.json")"
[[ "$published" =~ ^[0-9a-f]{64}$ ]] || { echo "install-claude-code: no checksum for $platform in the manifest" >&2; exit 1; }

fetch "$base/$platform/claude" "$work/claude"
actual="$(sha256sum "$work/claude" | awk '{print $1}')"
if [[ "$actual" != "$published" ]]; then
  echo "install-claude-code: checksum mismatch against the signed manifest for $platform" >&2
  exit 1
fi
if [[ -n "$pinned" && "$actual" != "$pinned" ]]; then
  echo "install-claude-code: checksum mismatch against the pinned digest for $platform" >&2
  exit 1
fi
[[ -n "$pinned" ]] || echo "install-claude-code: warning: no pinned digest for $arch; verified against the signed manifest only" >&2

install -D -m 0755 "$work/claude" "$dest/claude"
DISABLE_AUTOUPDATER=1 "$dest/claude" --version
