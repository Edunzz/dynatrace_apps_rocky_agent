#!/usr/bin/env bash
# Build-time installer for a pinned dtctl release.
#
# Usage: install-dtctl.sh <destination-dir>
# Required environment: DTCTL_VERSION (for example 0.45.0), TARGETARCH (amd64|arm64)
# Optional pinned digests: DTCTL_SHA256_AMD64, DTCTL_SHA256_ARM64
#
# The archive must match both the pinned digest (when provided) and the
# release checksums.txt. No remote script is executed.

set -Eeuo pipefail

dest="${1:?usage: install-dtctl.sh <destination-dir>}"
version="${DTCTL_VERSION:?DTCTL_VERSION is required}"
version="${version#v}"
arch="${TARGETARCH:-$(dpkg --print-architecture 2>/dev/null || uname -m)}"
case "$arch" in
  amd64 | x86_64) arch=amd64; pinned="${DTCTL_SHA256_AMD64:-}" ;;
  arm64 | aarch64) arch=arm64; pinned="${DTCTL_SHA256_ARM64:-}" ;;
  *) echo "install-dtctl: unsupported architecture '$arch'" >&2; exit 1 ;;
esac

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install-dtctl: DTCTL_VERSION must be X.Y.Z" >&2; exit 1; }

base="https://github.com/dynatrace-oss/dtctl/releases/download/v${version}"
archive="dtctl_${version}_linux_${arch}.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/$archive" "$base/$archive"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/checksums.txt" "$base/checksums.txt"

actual="$(sha256sum "$work/$archive" | awk '{print $1}')"
published="$(awk -v f="$archive" '$2 == f || $2 == "*"f {print $1}' "$work/checksums.txt")"
if [[ -z "$published" || "$actual" != "$published" ]]; then
  echo "install-dtctl: checksum mismatch against checksums.txt for $archive" >&2
  exit 1
fi
if [[ -n "$pinned" && "$actual" != "$pinned" ]]; then
  echo "install-dtctl: checksum mismatch against the pinned digest for $archive" >&2
  exit 1
fi
[[ -n "$pinned" ]] || echo "install-dtctl: warning: no pinned digest for $arch; verified against checksums.txt only" >&2

tar -xzf "$work/$archive" -C "$work" dtctl
install -D -m 0755 "$work/dtctl" "$dest/dtctl"
"$dest/dtctl" version
