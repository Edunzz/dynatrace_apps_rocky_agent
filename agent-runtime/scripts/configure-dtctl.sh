#!/usr/bin/env bash
# Writes the dtctl configuration for the runtime user.
#
# The container has no OS keyring, so dtctl keeps the token in its config file.
# The file is created with mode 0600 inside the runtime user's home, and the
# token is written by the shell (never passed as a process argument).

set -Eeuo pipefail
umask 077

: "${DT_PLATFORM_URL:?DT_PLATFORM_URL is required}"
: "${DT_PLATFORM_TOKEN:?DT_PLATFORM_TOKEN is required}"
safety="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/dtctl"
config_file="$config_dir/config"

# Values were validated by validate-environment.sh; re-check what reaches YAML.
[[ "$DT_PLATFORM_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]] || { echo "configure-dtctl: invalid DT_PLATFORM_URL" >&2; exit 1; }
[[ "$DT_PLATFORM_TOKEN" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "configure-dtctl: invalid token format" >&2; exit 1; }
[[ "$safety" =~ ^(readonly|readwrite-mine|readwrite-all)$ ]] || { echo "configure-dtctl: invalid DTCTL_SAFETY_LEVEL" >&2; exit 1; }

mkdir -p "$config_dir"
chmod 700 "$config_dir"
tmp="$(mktemp "$config_dir/.config.XXXXXX")"
{
  printf 'apiVersion: v1\n'
  printf 'kind: Config\n'
  printf 'current-context: rocky\n'
  printf 'contexts:\n'
  printf '  - name: rocky\n'
  printf '    context:\n'
  printf "      environment: '%s'\n" "${DT_PLATFORM_URL%/}"
  printf '      token-ref: rocky-platform-token\n'
  printf '      safety-level: %s\n' "$safety"
  printf "      description: 'Rocky Agent runtime context'\n"
  printf 'tokens:\n'
  printf '  - name: rocky-platform-token\n'
  printf "    token: '%s'\n" "$DT_PLATFORM_TOKEN"
  printf 'preferences:\n'
  printf '  output: table\n'
} >"$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$config_file"
echo "configure-dtctl: context 'rocky' configured for ${DT_PLATFORM_URL%/} (safety level: $safety)"
