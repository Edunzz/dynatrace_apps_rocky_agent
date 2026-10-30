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

# Required tools; Claude Code must not be installed.
if shell 'opencode --version && dtctl version && python3 --version && git --version && jq --version && curl --version >/dev/null && unzip -v >/dev/null && ssh -V 2>&1 && test -x /usr/bin/tini'; then
  pass "required tools installed"
else
  fail "required tools missing"
fi
if shell '! command -v claude >/dev/null && ! ls /usr/local/lib/node_modules | grep -qi claude'; then
  pass "Claude Code is not installed"
else
  fail "Claude Code found in the image"
fi

# Headless draw.io exporter (default build).
if shell 'test -x /usr/local/bin/drawio'; then
  if version="$(shell 'drawio --version 2>/dev/null | tail -n 1')" && [[ "$version" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]; then
    pass "draw.io CLI answers --version ($version)"
  else
    fail "draw.io CLI does not answer --version"
  fi
fi

# Protected files are read-only for the runtime user.
if shell 'touch /opt/rocky/policy/AGENTS.md 2>/dev/null || echo x >> /opt/rocky/opencode/opencode.json 2>/dev/null'; then
  fail "/opt/rocky is writable by the runtime user"
else
  pass "/opt/rocky is read-only for the runtime user"
fi

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
if docker image inspect "$IMAGE" --format '{{json .Config.Env}}' | grep -E -q '(TOKEN|PASSWORD|API_KEY|SECRET)[A-Z_]*=[^"]'; then
  fail "image environment contains a secret-looking value"
else
  pass "no secret values in image environment"
fi
if docker history --no-trunc "$IMAGE" | grep -E -q 'DT_PLATFORM_TOKEN=|OPENCODE_SERVER_PASSWORD=|API_KEY='; then
  fail "image history references secret build values"
else
  pass "no secret build values in image history"
fi

# Startup validation.
out="$(docker run --rm "$IMAGE" 2>&1 || true)"
grep -q 'DT_PLATFORM_URL is required' <<<"$out" && pass "missing variables are rejected" || fail "missing variables were not rejected"

out="$(docker run --rm -e NODE_ENV=production -e DT_PLATFORM_URL=https://rocky-ci.invalid \
  -e DT_PLATFORM_TOKEN=ci-placeholder-not-a-real-token -e OPENCODE_SERVER_PASSWORD=edunzzxgundam79 "$IMAGE" 2>&1 || true)"
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
