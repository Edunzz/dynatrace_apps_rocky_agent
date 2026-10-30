#!/usr/bin/env bash
# Read-only Dynatrace connectivity check. Never creates, updates or deletes
# anything and never prints the platform token.
#
# Writes ${ROCKY_STATE_DIR}/dynatrace-status.json for the gateway status endpoint.
# Exit code: 0 connected, 1 unavailable (the runtime may continue in degraded mode).

set -uo pipefail

STATE_DIR="${ROCKY_STATE_DIR:-/tmp/rocky}"
STATUS_FILE="${STATE_DIR}/dynatrace-status.json"
DT_PLATFORM_URL="${DT_PLATFORM_URL:-}"
TIMEOUT="${ROCKY_DT_CHECK_TIMEOUT:-15}"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

dtctl_installed=false
dtctl_version=""
safety_level="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"
status="unavailable"
detail=""

host=""
if [[ "$DT_PLATFORM_URL" =~ ^https://([^/:]+) ]]; then host="${BASH_REMATCH[1]}"; fi

if command -v dtctl >/dev/null 2>&1; then
  dtctl_installed=true
  dtctl_version="$(dtctl version 2>/dev/null | awk 'NR==1 {print $NF}')"
fi

if [[ -z "$DT_PLATFORM_URL" ]]; then
  status="not_configured"
  detail="DT_PLATFORM_URL is not set"
elif [[ "$dtctl_installed" != true ]]; then
  status="unavailable"
  detail="dtctl is not installed"
else
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "${DT_PLATFORM_URL%/}/" 2>/dev/null || true)"
  if [[ -z "$http_code" || "$http_code" == "000" ]]; then
    status="unavailable"
    detail="The Dynatrace environment is not reachable from the runtime (network, DNS or TLS)"
  elif timeout "$TIMEOUT" dtctl auth whoami --plain --no-agent >/dev/null 2>&1; then
    status="connected"
    detail="Authenticated with the platform token"
    # Harmless read-only query that touches no stored data.
    if ! timeout "$TIMEOUT" dtctl query 'data record(rocky = "ok")' --plain --no-agent >/dev/null 2>&1; then
      detail="Authenticated, but the read-only DQL check failed; verify the token scopes"
    fi
  else
    status="authentication_failed"
    detail="The environment is reachable but authentication failed; verify DT_PLATFORM_TOKEN and its scopes"
  fi
fi

tmp="$(mktemp "${STATE_DIR}/.dynatrace-status.XXXXXX")"
jq -n \
  --arg status "$status" \
  --arg detail "$detail" \
  --arg host "$host" \
  --arg version "$dtctl_version" \
  --arg safety "$safety_level" \
  --argjson installed "$dtctl_installed" \
  --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{status: $status, detail: $detail, environmentHost: $host, dtctlInstalled: $installed,
    dtctlVersion: (if $version == "" then null else $version end), safetyLevel: $safety, checkedAt: $checkedAt}' >"$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$STATUS_FILE"

printf 'Dynatrace connection: %s (%s)\n' "$status" "$detail"
[[ "$status" == "connected" ]]
