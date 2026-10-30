#!/usr/bin/env bash
# Static checks against a built Rocky Agent image (no runtime secrets needed).
#   agent-runtime/tests/container/image-checks.sh rocky-agent:ci

set -Eeuo pipefail
IMAGE="${1:?usage: image-checks.sh <image>}"
failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
shell() { docker run --rm --entrypoint bash "$IMAGE" -c "$1"; }

# Non-root execution.
uid="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[[ "$uid" == "10001" ]] && pass "runs as uid 10001" || fail "runs as uid $uid"

# Required tools; OpenCode is gone.
if shell 'claude --version && dtctl version && python --version && python3 --version && git --version && jq --version && rg --version >/dev/null && curl --version >/dev/null && unzip -v >/dev/null && ssh -V 2>&1 && test -x /usr/bin/tini'; then
  pass "required tools installed"
else
  fail "required tools missing"
fi
version="$(shell 'claude --version' | awk '{print $1}')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && pass "Claude Code $version" || fail "Claude Code version: '$version'"
if shell '! command -v opencode >/dev/null && ! ls /usr/local/lib/node_modules | grep -qi opencode'; then
  pass "OpenCode is not installed"
else
  fail "OpenCode found in the image"
fi

# Headless draw.io exporter (default build).
if shell 'test -x /usr/local/bin/drawio'; then
  if version="$(shell 'drawio --version 2>/dev/null | tail -n 1')" && [[ "$version" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    pass "draw.io CLI answers --version ($version)"
  else
    fail "draw.io CLI does not answer --version"
  fi
fi

# Protected files are read-only for the runtime user; managed settings are root-owned.
if shell 'touch /opt/rocky/policy/AGENTS.md 2>/dev/null || echo x >> /etc/claude-code/managed-settings.json 2>/dev/null'; then
  fail "policy or managed settings are writable by the runtime user"
else
  pass "policy and managed settings are read-only for the runtime user"
fi
owner="$(shell 'stat -c "%U %a" /etc/claude-code/managed-settings.json')"
[[ "$owner" == "root 644" ]] && pass "managed settings owned by root (0644)" || fail "managed settings: $owner"
shell 'jq -e ".allowManagedPermissionRulesOnly == true and .permissions.disableBypassPermissionsMode == \"disable\"" /etc/claude-code/managed-settings.json' >/dev/null &&
  pass "managed settings lock permission rules" || fail "managed settings content"

# Skill inventory.
count="$(docker run --rm --entrypoint jq "$IMAGE" -r '.official.skills | length' /opt/rocky/skills-manifest.json)"
((count >= 19)) && pass "$count official skills in the manifest" || fail "only $count official skills"
for skill in dt-dql-essentials dt-app-dashboards dt-app-notebooks dt-obs-logs dt-obs-problems dt-obs-tracing dt-obs-services \
  dt-obs-kubernetes dt-obs-hosts dt-obs-frontends dt-obs-aws dt-obs-azure dt-obs-gcp dt-alerting dt-js-runtime dt-obs-genai \
  dt-obs-analytics dt-sec-insights dt-platform-costs dt-custom-rca-jromero drawio; do
  if shell "test -f /opt/rocky/skills/$skill/SKILL.md"; then :; else fail "skill $skill missing"; fi
done
pass "required skills present"

# No secrets in image metadata or history.
secret_env="$(docker image inspect "$IMAGE" --format '{{json .Config.Env}}' |
  jq -r '.[] | split("=")[0] | select(test("(TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|CREDENTIAL)$"))')"
if [[ -n "$secret_env" ]]; then
  fail "image environment defines secret variables: $secret_env"
else
  pass "no secret values in image environment"
fi
if docker history --no-trunc "$IMAGE" | grep -E -q 'DT_PLATFORM_TOKEN=|ROCKY_SERVER_PASSWORD=|CLAUDE_CODE_OAUTH_TOKEN=|API_KEY='; then
  fail "image history references secret build values"
else
  pass "no secret build values in image history"
fi

# Sign-in helpers.
out="$(docker run --rm "$IMAGE" auth-status 2>&1)" && status=0 || status=$?
[[ "$status" != 0 ]] && pass "auth-status reports no stored login ($status)" || fail "auth-status without credentials: $out"
out="$(docker run --rm "$IMAGE" not-a-command 2>&1)" && status=0 || status=$?
[[ "$status" == 2 ]] && grep -q 'Use login, setup-token' <<<"$out" && pass "unknown commands are rejected" || fail "unknown command: $status $out"

# Startup validation.
out="$(docker run --rm "$IMAGE" 2>&1 || true)"
grep -q 'DT_PLATFORM_URL is required' <<<"$out" && pass "missing variables are rejected" || fail "missing variables were not rejected"

out="$(docker run --rm -e NODE_ENV=production -e DT_PLATFORM_URL=https://rocky-ci.invalid \
  -e DT_PLATFORM_TOKEN=ci-placeholder-not-a-real-token -e ROCKY_SERVER_PASSWORD=edunzzxgundam79 "$IMAGE" 2>&1 || true)"
if grep -q 'development default' <<<"$out" && grep -q 'refusing to start' <<<"$out"; then
  pass "default password rejected in production"
else
  fail "default password was not rejected in production"
fi
grep -q 'edunzzxgundam79' <<<"$(grep -v 'WARNING' <<<"$out")" && fail "password echoed in logs" || pass "password not echoed"

if ((failures > 0)); then
  printf '%d image check(s) failed\n' "$failures"
  exit 1
fi
echo "All image checks passed"
