#!/usr/bin/env bash
# Validates the Rocky Agent runtime environment before anything starts.
# Prints only variable names and non-sensitive values. Exits 1 on any failure.

set -uo pipefail

DEFAULT_PASSWORD="gundamjromero2026"
SENSITIVE_NAME_REGEX='(TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|CREDENTIAL|AUTH)'

failures=0
warnings=0

ok() { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf '[FAIL] %s\n' "$1"; failures=$((failures + 1)); }

NODE_ENV="${NODE_ENV:-production}"
LOG_LEVEL="${LOG_LEVEL:-info}"
ROCKY_PORT="${ROCKY_PORT:-4096}"
WORKSPACE_PATH="${WORKSPACE_PATH:-/workspace}"
ROCKY_SERVER_USERNAME="${ROCKY_SERVER_USERNAME:-rocky}"
ROCKY_SERVER_PASSWORD="${ROCKY_SERVER_PASSWORD:-}"
DTCTL_SAFETY_LEVEL="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"

# --- NODE_ENV --------------------------------------------------------------
case "$NODE_ENV" in
  production | development | test) ok "NODE_ENV=$NODE_ENV" ;;
  *) fail "NODE_ENV must be production, development or test (got '$NODE_ENV')" ;;
esac

# --- Runtime password -------------------------------------------------------
if [[ -z "$ROCKY_SERVER_PASSWORD" ]]; then
  fail "ROCKY_SERVER_PASSWORD is required"
elif [[ "$ROCKY_SERVER_PASSWORD" == "$DEFAULT_PASSWORD" ]]; then
  warn "ROCKY_SERVER_PASSWORD is the public default password. Change it to a unique password of at least 16 characters."
elif [[ "$NODE_ENV" == "production" && ${#ROCKY_SERVER_PASSWORD} -lt 16 ]]; then
  fail "ROCKY_SERVER_PASSWORD must be at least 16 characters in production"
else
  ok "ROCKY_SERVER_PASSWORD is set (${#ROCKY_SERVER_PASSWORD} characters)"
fi

if [[ ! "$ROCKY_SERVER_USERNAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  fail "ROCKY_SERVER_USERNAME may only contain letters, digits, '.', '_' and '-' (max 64)"
else
  ok "ROCKY_SERVER_USERNAME=$ROCKY_SERVER_USERNAME"
fi

# --- Dynatrace platform -----------------------------------------------------
DT_PLATFORM_URL="${DT_PLATFORM_URL:-}"
DT_PLATFORM_TOKEN="${DT_PLATFORM_TOKEN:-}"
if [[ -z "$DT_PLATFORM_URL" ]]; then
  fail "DT_PLATFORM_URL is required (for example https://abc12345.apps.dynatrace.com)"
elif [[ ! "$DT_PLATFORM_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]]; then
  if [[ "$DT_PLATFORM_URL" =~ @ ]]; then
    fail "DT_PLATFORM_URL must not contain credentials"
  else
    fail "DT_PLATFORM_URL must be an HTTPS origin without a path (for example https://abc12345.apps.dynatrace.com)"
  fi
elif [[ "$DT_PLATFORM_URL" =~ \.live\.dynatrace\.com/?$ ]]; then
  fail "DT_PLATFORM_URL points to the classic API domain; dtctl expects the platform URL (https://<environment-id>.apps.dynatrace.com)"
else
  if [[ ! "$DT_PLATFORM_URL" =~ \.apps\.dynatrace(labs)?\.com/?$ ]]; then
    warn "DT_PLATFORM_URL does not match *.apps.dynatrace.com; make sure it is the platform URL dtctl expects"
  fi
  ok "DT_PLATFORM_URL=${DT_PLATFORM_URL%/}"
fi

if [[ -z "$DT_PLATFORM_TOKEN" ]]; then
  fail "DT_PLATFORM_TOKEN is required (a platform token for a dedicated Dynatrace service user)"
elif [[ ! "$DT_PLATFORM_TOKEN" =~ ^[A-Za-z0-9._-]+$ ]] || ((${#DT_PLATFORM_TOKEN} < 20 || ${#DT_PLATFORM_TOKEN} > 1024)); then
  # POSIX regex bounds cap at 255, so the length is checked separately.
  fail "DT_PLATFORM_TOKEN has an unexpected format (value not shown)"
else
  if [[ ! "$DT_PLATFORM_TOKEN" =~ ^dt0s16\. ]]; then
    warn "DT_PLATFORM_TOKEN does not look like a platform token (dt0s16.*); value not shown"
  fi
  ok "DT_PLATFORM_TOKEN is set (value not shown)"
fi

case "$DTCTL_SAFETY_LEVEL" in
  readonly | readwrite-mine | readwrite-all) ok "DTCTL_SAFETY_LEVEL=$DTCTL_SAFETY_LEVEL" ;;
  dangerously-unrestricted) fail "DTCTL_SAFETY_LEVEL=dangerously-unrestricted is not allowed in Rocky Agent" ;;
  *) fail "DTCTL_SAFETY_LEVEL must be readonly, readwrite-mine or readwrite-all" ;;
esac

# --- Network ----------------------------------------------------------------
if [[ ! "$ROCKY_PORT" =~ ^[0-9]{1,5}$ ]] || ((ROCKY_PORT < 1 || ROCKY_PORT > 65535)); then
  fail "ROCKY_PORT must be a port number (got '$ROCKY_PORT')"
else
  ok "ROCKY_PORT=$ROCKY_PORT"
fi

ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
if [[ -n "$ALLOWED_ORIGINS" ]]; then
  IFS=',' read -r -a origins <<<"$ALLOWED_ORIGINS"
  for raw in "${origins[@]}"; do
    origin="${raw//[[:space:]]/}"
    [[ -z "$origin" ]] && continue
    if [[ "$origin" == "*" ]]; then
      if [[ "$NODE_ENV" == "production" ]]; then
        fail "ALLOWED_ORIGINS='*' is not allowed in production"
      else
        warn "ALLOWED_ORIGINS='*' is ignored; list explicit origins"
      fi
    elif [[ "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
      ok "ALLOWED_ORIGINS includes $origin"
    elif [[ "$NODE_ENV" != "production" && "$origin" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$ ]]; then
      warn "ALLOWED_ORIGINS includes $origin (development only)"
    else
      fail "ALLOWED_ORIGINS entry '$origin' must be an https:// origin without a path"
    fi
  done
fi

# --- Workspace and logging ---------------------------------------------------
if [[ "$WORKSPACE_PATH" != /* ]]; then
  fail "WORKSPACE_PATH must be an absolute path"
else
  ok "WORKSPACE_PATH=$WORKSPACE_PATH"
fi

case "$LOG_LEVEL" in
  debug | info | warn | error) ok "LOG_LEVEL=$LOG_LEVEL" ;;
  *) fail "LOG_LEVEL must be debug, info, warn or error" ;;
esac

# --- Claude Code ----------------------------------------------------------------
ROCKY_MODEL="${ROCKY_MODEL:-}"
model_re='^[][A-Za-z0-9._:@/-]{1,200}$'
if [[ -n "$ROCKY_MODEL" && ! "$ROCKY_MODEL" =~ $model_re ]]; then
  fail "ROCKY_MODEL has an invalid format (for example sonnet, opus or claude-sonnet-5-5)"
elif [[ -n "$ROCKY_MODEL" ]]; then
  ok "ROCKY_MODEL=$ROCKY_MODEL"
fi
CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-${HOME:-/home/rocky}/.claude}"
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  ok "Claude: CLAUDE_CODE_OAUTH_TOKEN is set (Claude subscription)"
elif [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  ok "Claude: Anthropic API credential is set"
elif [[ -n "${CLAUDE_CODE_USE_BEDROCK:-}" || -n "${CLAUDE_CODE_USE_VERTEX:-}" || -n "${CLAUDE_CODE_USE_FOUNDRY:-}" ]]; then
  ok "Claude: cloud provider selected (Bedrock, Vertex AI or Foundry)"
elif [[ -f "$CLAUDE_CONFIG_DIR/.credentials.json" ]]; then
  ok "Claude: stored login found in $CLAUDE_CONFIG_DIR"
else
  warn "Claude is not signed in: run 'docker compose run --rm rocky-agent login', or set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY"
fi
case "${ROCKY_SUBPROCESS_ENV_SCRUB:-false}" in
  1 | true | yes | on) ok "ROCKY_SUBPROCESS_ENV_SCRUB on (needs bubblewrap with user namespaces; runs fail where the container runtime blocks them)" ;;
  *) ok "ROCKY_SUBPROCESS_ENV_SCRUB off (managed rules deny commands that read Claude credentials)" ;;
esac

# --- Summary -------------------------------------------------------------------
printf 'Environment variables (sensitive values hidden):\n'
for name in DT_PLATFORM_URL DT_PLATFORM_TOKEN ROCKY_SERVER_USERNAME ROCKY_SERVER_PASSWORD ROCKY_PORT ROCKY_MODEL \
  CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_USE_BEDROCK \
  CLAUDE_CODE_USE_VERTEX AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
  WORKSPACE_PATH LOG_LEVEL NODE_ENV ALLOWED_ORIGINS; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    printf '  %-26s (unset)\n' "$name"
  elif [[ "$name" =~ $SENSITIVE_NAME_REGEX || "$name" == AWS_ACCESS_KEY_ID ]]; then
    printf '  %-26s [REDACTED]\n' "$name"
  else
    printf '  %-26s %s\n' "$name" "$value"
  fi
done

if ((failures > 0)); then
  printf 'Environment validation failed: %d error(s), %d warning(s).\n' "$failures" "$warnings"
  exit 1
fi
printf 'Environment validation passed with %d warning(s).\n' "$warnings"
exit 0
