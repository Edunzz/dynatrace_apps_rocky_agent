#!/usr/bin/env bash
# Runtime checks against the CI compose environment (deploy/local/docker-compose.ci.yml).
# Requires the stack to be up; uses only the CI placeholder credentials.

set -Eeuo pipefail
COMPOSE=(docker compose -f deploy/local/docker-compose.ci.yml)
URL="${ROCKY_IT_URL:-http://127.0.0.1:4096}"
PASSWORD="${ROCKY_IT_PASSWORD:-ci-integration-password-0123}"
failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
authed() { printf 'user = "opencode:%s"\n' "$PASSWORD" | curl -fsS --max-time 20 -K - "$@"; }

# Wait for the gateway and for Docker to report the container healthy.
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 "$URL/rocky/v1/livez" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$URL/rocky/v1/livez" >/dev/null && pass "liveness probe" || fail "liveness probe"

container="$("${COMPOSE[@]}" ps -q rocky-agent)"
for _ in $(seq 1 60); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  [[ "$health" == "healthy" ]] && break
  sleep 3
done
[[ "$health" == "healthy" ]] && pass "Docker HEALTHCHECK reports healthy" || fail "Docker health is '$health'"

# Extended status: degraded Dynatrace mode, skills discovered, no secrets.
status="$(authed "$URL/rocky/v1/status")"
jq -e '.opencode.status == "ready"' <<<"$status" >/dev/null && pass "OpenCode ready" || fail "OpenCode not ready"
jq -e '.dynatrace.status == "unavailable"' <<<"$status" >/dev/null && pass "Dynatrace degraded mode reported as unavailable" || fail "unexpected Dynatrace status: $(jq -c .dynatrace <<<"$status")"
jq -e '.dtctl.status == "ready"' <<<"$status" >/dev/null && pass "dtctl ready" || fail "dtctl not ready"
jq -e '.skills.status == "installed" and .skills.count >= 21' <<<"$status" >/dev/null && pass "skills discoverable by OpenCode ($(jq .skills.count <<<"$status"))" || fail "skills: $(jq -c '.skills | {status, count, missing}' <<<"$status")"
jq -e '.workspace.status == "ready"' <<<"$status" >/dev/null && pass "workspace ready" || fail "workspace not ready"
grep -q "$PASSWORD" <<<"$status" && fail "status leaks the password" || pass "status contains no password"

# Secrets are not visible to agent processes.
# OpenCode processes are identified by argv[0] (native binary) or argv[1] (npm
# launcher run by node); matching on the command text would also match this
# checker, whose environment comes from `docker exec`.
leaks="$("${COMPOSE[@]}" exec -T rocky-agent bash -c '
  found=0; checked=0
  for p in /proc/[0-9]*; do
    mapfile -d "" -t argv < "$p/cmdline" 2>/dev/null || continue
    a0="${argv[0]##*/}"; a1="${argv[1]##*/}"
    [[ "$a0" == opencode* || ( "$a0" == node && "$a1" == opencode* ) ]] || continue
    checked=$((checked + 1))
    if tr "\0" "\n" < "$p/environ" 2>/dev/null | grep -E -q "^(DT_PLATFORM_TOKEN=|OPENCODE_SERVER_PASSWORD=ci-integration)"; then found=1; fi
  done
  echo "$checked $found"')"
if [[ "$leaks" =~ ^[1-9][0-9]*\ 0$ ]]; then
  pass "OpenCode processes have neither the platform token nor the client password"
else
  fail "OpenCode process environment check (processes checked, leak found): $leaks"
fi
"${COMPOSE[@]}" exec -T rocky-agent bash -c 'stat -c "%a" ~/.config/dtctl/config' | grep -q '^600$' && pass "dtctl config is 0600" || fail "dtctl config permissions"

# RCA skill prerequisite gate inside the container (offline: no tenant access).
gate="$("${COMPOSE[@]}" exec -T -w /workspace rocky-agent python3 .opencode/skills/dt-custom-rca-jromero/scripts/check_prereqs.py --offline --json || true)"
for check in "Skills Dynatrace for AI" "Skill drawio" "draw.io Desktop (CLI)" "Python"; do
  state="$(jq -r --arg n "$check" '[.. | objects | select(.nombre? == $n) | .estado] | first // "missing"' <<<"$gate")"
  [[ "$state" == "OK" || "$state" == "AVISO" ]] && pass "RCA gate: $check = $state" || fail "RCA gate: $check = $state"
done

# draw.io: build, validate and export a PNG headlessly.
if "${COMPOSE[@]}" exec -T -w /workspace rocky-agent bash -c '
  set -e
  cat > /tmp/spec.json <<EOF
{"title":"CI diagram","nodes":[{"id":"a","label":"Service A","kind":"error","root":true},{"id":"b","label":"Service B","kind":"degraded"}],"edges":[{"source":"a","target":"b","kind":"failure"}],"legend":true}
EOF
  node .opencode/skills/drawio/scripts/drawio-build.mjs /tmp/spec.json -o artifacts/drawio/ci.drawio
  node .opencode/skills/drawio/scripts/drawio-validate.mjs artifacts/drawio/ci.drawio
  drawio -x -f png -e -s 1 -b 10 -o artifacts/drawio/ci.png artifacts/drawio/ci.drawio >/dev/null
  head -c 8 artifacts/drawio/ci.png | od -An -tx1 | grep -q "89 50 4e 47"
'; then
  pass "draw.io XML generated, validated and exported to PNG"
else
  fail "draw.io generation or export"
fi

if ((failures > 0)); then
  printf '%d runtime check(s) failed\n' "$failures"
  exit 1
fi
echo "All runtime checks passed"
