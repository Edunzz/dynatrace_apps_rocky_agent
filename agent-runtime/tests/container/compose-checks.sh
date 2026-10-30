#!/usr/bin/env bash
# Runtime checks against the CI compose environment (deploy/local/docker-compose.ci.yml):
# the real image with Claude Code talking to the mock Anthropic API.
# Requires the stack to be up; uses only the CI placeholder credentials.

set -Eeuo pipefail
COMPOSE=(docker compose -f deploy/local/docker-compose.ci.yml)
URL="${ROCKY_IT_URL:-http://127.0.0.1:4096}"
PASSWORD="${ROCKY_IT_PASSWORD:-ci-integration-password-0123}"
failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
authed() { printf 'user = "rocky:%s"\n' "$PASSWORD" | curl -fsS --max-time 20 -K - "$@"; }
in_container() { "${COMPOSE[@]}" exec -T rocky-agent bash -c "$1"; }

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

# Extended status: Claude Code ready and signed in (mock key), degraded Dynatrace, skills, no secrets.
status="$(authed "$URL/rocky/v1/status")"
jq -e '.agent.status == "ready" and (.agent.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' <<<"$status" >/dev/null &&
  pass "Claude Code ready ($(jq -r .agent.version <<<"$status"))" || fail "agent: $(jq -c .agent <<<"$status")"
jq -e '.claude.status == "connected" and .claude.authMethod == "api_key"' <<<"$status" >/dev/null &&
  pass "Claude credential detected" || fail "claude: $(jq -c .claude <<<"$status")"
jq -e '.dynatrace.status == "unavailable"' <<<"$status" >/dev/null && pass "Dynatrace degraded mode reported as unavailable" || fail "unexpected Dynatrace status: $(jq -c .dynatrace <<<"$status")"
jq -e '.dtctl.status == "ready"' <<<"$status" >/dev/null && pass "dtctl ready" || fail "dtctl not ready"
jq -e '.skills.status == "installed" and .skills.count >= 21' <<<"$status" >/dev/null && pass "skills installed for Claude Code ($(jq .skills.count <<<"$status"))" || fail "skills: $(jq -c '.skills | {status, count, missing}' <<<"$status")"
jq -e '.workspace.status == "ready"' <<<"$status" >/dev/null && pass "workspace ready" || fail "workspace not ready"
grep -q "$PASSWORD" <<<"$status" && fail "status leaks the password" || pass "status contains no password"

# The gateway process holds neither the platform token nor the runtime password.
gateway_env="$(in_container 'for p in /proc/[0-9]*; do
  mapfile -d "" -t argv < "$p/cmdline" 2>/dev/null || continue
  [[ "${argv[0]##*/}" == node && "${argv[1]}" == */gateway/server.mjs ]] || continue
  tr "\0" "\n" < "$p/environ"
done')"
if [[ -n "$gateway_env" ]] && ! grep -E -q '^(DT_PLATFORM_TOKEN|ROCKY_SERVER_PASSWORD)=' <<<"$gateway_env"; then
  pass "gateway environment has neither the platform token nor the runtime password"
else
  fail "gateway environment check (empty or leaking)"
fi
in_container 'ls /tmp/rocky/.gateway-secret.* 2>/dev/null | wc -l' | grep -q '^0$' &&
  pass "gateway secret file removed after startup" || fail "gateway secret file still present"
in_container 'stat -c "%a" ~/.config/dtctl/config' | grep -q '^600$' && pass "dtctl config is 0600" || fail "dtctl config permissions"

# A real Claude Code run with a tool approval.
session="$(authed -X POST -H 'content-type: application/json' -d '{"title":"compose check"}' "$URL/rocky/v1/sessions" | jq -r .id)"
authed -X POST -H 'content-type: application/json' -d '{"text":"please use bash"}' "$URL/rocky/v1/sessions/$session/prompt" >/dev/null
permission=""
for _ in $(seq 1 60); do
  permission="$(authed "$URL/rocky/v1/sessions/$session/snapshot" | jq -r '.permissions[0].id // empty')"
  [[ -n "$permission" ]] && break
  sleep 2
done
[[ -n "$permission" ]] && pass "Claude Code asked for approval through the gateway" || fail "no approval request: $(authed "$URL/rocky/v1/sessions/$session/snapshot" | jq -c '.messages[-1]')"

# While the run waits: the Claude Code process has no platform token or runtime password.
claude_env="$(in_container 'for p in /proc/[0-9]*; do
  mapfile -d "" -t argv < "$p/cmdline" 2>/dev/null || continue
  [[ "${argv[0]##*/}" == claude ]] || continue
  tr "\0" "\n" < "$p/environ"; echo ---
done')"
if [[ -n "$claude_env" ]] && ! grep -E -q '^(DT_PLATFORM_TOKEN|ROCKY_SERVER_PASSWORD)=' <<<"$claude_env"; then
  pass "Claude Code environment has neither the platform token nor the runtime password"
else
  fail "Claude Code environment check (empty or leaking)"
fi

if [[ -n "$permission" ]]; then
  authed -X POST -H 'content-type: application/json' -d '{"reply":"once"}' "$URL/rocky/v1/permissions/$permission/reply" >/dev/null
  for _ in $(seq 1 60); do
    state="$(authed "$URL/rocky/v1/sessions/$session/snapshot" | jq -r --arg s "$session" '.status[$s].type')"
    [[ "$state" == "idle" ]] && break
    sleep 2
  done
  marker="$(in_container 'cat /workspace/rocky-integration.txt 2>/dev/null || echo missing')"
  [[ "$marker" == "rocky-integration" ]] && pass "approved command ran in the workspace" ||
    fail "approved command output: '$marker' (expected 'rocky-integration')"
fi

# A read-only command that names a credential is denied by the managed rules,
# without asking and without running.
authed -X POST -H 'content-type: application/json' -d '{"text":"please show key"}' "$URL/rocky/v1/sessions/$session/prompt" >/dev/null
for _ in $(seq 1 60); do
  snap="$(authed "$URL/rocky/v1/sessions/$session/snapshot")"
  [[ "$(jq -r --arg s "$session" '.status[$s].type' <<<"$snap")" == "idle" ]] && break
  sleep 2
done
key_tool="$(jq -c '[.messages[].parts[] | select(.type == "tool" and (.state.input.command // "" | test("ANTHROPIC_API_KEY")))] | last | .state' <<<"$snap")"
if jq -e '.status == "error"' <<<"$key_tool" >/dev/null && ! grep -q 'ci-mock-anthropic-key' <<<"$snap"; then
  pass "command that prints a credential was denied ($(jq -r '.error' <<<"$key_tool" | head -c 80))"
else
  fail "credential command: $key_tool"
fi
# A model and thinking level chosen for a prompt reach the model API through the real Claude Code.
authed -X POST -H 'content-type: application/json' -d '{"text":"hello","model":"haiku","effort":"low"}' "$URL/rocky/v1/sessions/$session/prompt" >/dev/null
for _ in $(seq 1 60); do
  [[ "$(authed "$URL/rocky/v1/sessions/$session/snapshot" | jq -r --arg s "$session" '.status[$s].type')" == "idle" ]] && break
  sleep 2
done
sleep 1
chosen="$("${COMPOSE[@]}" logs --no-log-prefix mock-anthropic | grep '"effort":"low"' | tail -1 || true)"
[[ "$chosen" == *haiku* ]] && pass "prompt options reached the model API ($(jq -c '{model, effort}' <<<"$chosen"))" ||
  fail "prompt options: '${chosen:-no request with effort low}'"
rejected="$(printf 'user = "rocky:%s"\n' "$PASSWORD" | curl -sS --max-time 20 -K - -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"text":"x","model":"--dangerously-skip-permissions"}' "$URL/rocky/v1/sessions/$session/prompt")"
[[ "$rejected" == "400" ]] && pass "a model outside the list is rejected" || fail "invalid model answered HTTP $rejected"
authed -X DELETE "$URL/rocky/v1/sessions/$session" >/dev/null || true

# RCA skill prerequisite gate inside the container (offline: no tenant access).
gate="$("${COMPOSE[@]}" exec -T -w /workspace rocky-agent python /home/rocky/.claude/skills/dt-custom-rca-jromero/scripts/check_prereqs.py --offline --json || true)"
for check in "Skills Dynatrace for AI" "Skill drawio" "draw.io Desktop (CLI)" "Python"; do
  state="$(jq -r --arg n "$check" '[.. | objects | select(.nombre? == $n) | .estado] | first // "missing"' <<<"$gate")"
  [[ "$state" == "OK" || "$state" == "AVISO" ]] && pass "RCA gate: $check = $state" || fail "RCA gate: $check = $state"
done

# draw.io: build, validate and export a PNG headlessly.
if "${COMPOSE[@]}" exec -T -w /workspace rocky-agent bash -c '
  set -e
  skill=/home/rocky/.claude/skills/drawio
  cat > /tmp/spec.json <<EOF
{"title":"CI diagram","nodes":[{"id":"a","label":"Service A","kind":"error","root":true},{"id":"b","label":"Service B","kind":"degraded"}],"edges":[{"source":"a","target":"b","kind":"failure"}],"legend":true}
EOF
  node "$skill/scripts/drawio-build.mjs" /tmp/spec.json -o artifacts/drawio/ci.drawio
  node "$skill/scripts/drawio-validate.mjs" artifacts/drawio/ci.drawio
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
