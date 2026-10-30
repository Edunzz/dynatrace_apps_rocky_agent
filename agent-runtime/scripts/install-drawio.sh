#!/usr/bin/env bash
# Build-time installer for a pinned, headless draw.io Desktop CLI.
#
# Usage: install-drawio.sh <root-dir>
# Produces <root-dir>/opt/drawio-desktop and the wrapper <root-dir>/usr/local/bin/drawio.
#
# draw.io is only used as a command-line exporter (PNG/SVG/PDF) under a virtual
# X server. Diagrams are always authored as .drawio XML; no GUI is opened.
#
# Environment: DRAWIO_VERSION, TARGETARCH, DRAWIO_SHA256_AMD64, DRAWIO_SHA256_ARM64

set -Eeuo pipefail

root="${1:?usage: install-drawio.sh <root-dir>}"
version="${DRAWIO_VERSION:?DRAWIO_VERSION is required}"
arch="${TARGETARCH:-$(dpkg --print-architecture)}"
case "$arch" in
  amd64 | x86_64) arch=amd64; pinned="${DRAWIO_SHA256_AMD64:?DRAWIO_SHA256_AMD64 is required}" ;;
  arm64 | aarch64) arch=arm64; pinned="${DRAWIO_SHA256_ARM64:?DRAWIO_SHA256_ARM64 is required}" ;;
  *) echo "install-drawio: unsupported architecture '$arch'" >&2; exit 1 ;;
esac

deb="drawio-${arch}-${version}.deb"
base="https://github.com/jgraph/drawio-desktop/releases/download/v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/$deb" "$base/$deb"
curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$work/hashes.txt" "$base/Files-SHA256-Hashes.txt"

actual="$(sha256sum "$work/$deb" | awk '{print $1}')"
published="$(tr -d '\r' <"$work/hashes.txt" | awk -v f="$deb" '$2 == f {print tolower($1)}')"
[[ "$actual" == "$pinned" ]] || { echo "install-drawio: digest mismatch against the pinned value" >&2; exit 1; }
[[ "$actual" == "$published" ]] || { echo "install-drawio: digest mismatch against Files-SHA256-Hashes.txt" >&2; exit 1; }

dpkg-deb -x "$work/$deb" "$work/extract"
mkdir -p "$root/opt" "$root/usr/local/bin"
mv "$work/extract/opt/drawio" "$root/opt/drawio-desktop"
# The SUID sandbox helper is not used (--no-sandbox below); drop its setuid bit.
chmod 0755 "$root/opt/drawio-desktop/chrome-sandbox" 2>/dev/null || true

cat >"$root/usr/local/bin/drawio" <<'EOF'
#!/usr/bin/env bash
# Headless draw.io Desktop CLI (export only). Example:
#   drawio -x -f png -e -s 2 -b 10 -o diagram.png diagram.drawio
set -euo pipefail
export ELECTRON_DISABLE_SECURITY_WARNINGS=true
exec xvfb-run -a --server-args="-screen 0 1920x1080x24 -nolisten tcp" \
  /opt/drawio-desktop/drawio --no-sandbox --disable-gpu --disable-dev-shm-usage "$@" 2> >(grep -v -E 'dbus|Fontconfig|GPU|gpu_' >&2)
EOF
chmod 0755 "$root/usr/local/bin/drawio"
echo "install-drawio: draw.io ${version} (${arch}) staged under $root"
