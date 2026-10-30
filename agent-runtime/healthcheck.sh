#!/usr/bin/env bash
# Docker HEALTHCHECK: authenticated GET /global/health.
# Credentials are passed to curl on stdin, never as process arguments.

set -euo pipefail

port="${OPENCODE_PORT:-4096}"
user="${OPENCODE_SERVER_USERNAME:-opencode}"
pass="${OPENCODE_SERVER_PASSWORD:-}"
if [[ -z "$pass" && "${NODE_ENV:-production}" != "production" ]]; then
  pass="edunzzxgundam79"
fi

escape() {
  local value="${1//\\/\\\\}"
  printf '%s' "${value//\"/\\\"}"
}

printf 'user = "%s:%s"\n' "$(escape "$user")" "$(escape "$pass")" |
  curl -fsS --max-time 5 -K - "http://127.0.0.1:${port}/global/health" |
  grep -q '"healthy":true'
