#!/usr/bin/env bash
# Validates the Rocky Agent runtime environment before anything starts.
# Prints only variable names and non-sensitive values. Exits 1 on any failure.

set -uo pipefail

DEFAULT_PASSWORD="edunzzxgundam79"
SENSITIVE_NAME_REGEX='(TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|CREDENTIAL|AUTH)'

failures=0
warnings=0

ok() { printf '[OK]   %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf '[FAIL] %s\n' "$1"; failures=$((failures + 1)); }

NODE_ENV="${NODE_ENV:-production}"
LOG_LEVEL="${LOG_LEVEL:-info}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
WORKSPACE_PATH="${WORKSPACE_PATH:-/workspace}"
OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:-}"
DTCTL_SAFETY_LEVEL="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"
ROCKY_GATEWAY_ENABLED="${ROCKY_GATEWAY_ENABLED:-true}"

# --- NODE_ENV --------------------------------------------------------------
case "$NODE_ENV" in
  production | development | test) ok "NODE_ENV=$NODE_ENV" ;;
  *) fail "NODE_ENV must be production, development or test (got '$NODE_ENV')" ;;
esac

# --- Runtime password -------------------------------------------------------
if [[ -z "$OPENCODE_SERVER_PASSWORD" ]]; then
  fail "OPENCODE_SERVER_PASSWORD is required"
elif [[ "$OPENCODE_SERVER_PASSWORD" == "$DEFAULT_PASSWORD" ]]; then
  if [[ "$NODE_ENV" == "production" ]]; then
    fail "OPENCODE_SERVER_PASSWORD uses the documented development default. Set a unique password of at least 16 characters for production."
  else
    warn "OPENCODE_SERVER_PASSWORD uses the documented development default. Never expose this runtime outside your workstation."
  fi
elif [[ "$NODE_ENV" == "production" && ${#OPENCODE_SERVER_PASSWORD} -lt 16 ]]; then
  fail "OPENCODE_SERVER_PASSWORD must be at least 16 characters in production"
else
  ok "OPENCODE_SERVER_PASSWORD is set (${#OPENCODE_SERVER_PASSWORD} characters)"
fi

if [[ ! "$OPENCODE_SERVER_USERNAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  fail "OPENCODE_SERVER_USERNAME may only contain letters, digits, '.', '_' and '-' (max 64)"
else
  ok "OPENCODE_SERVER_USERNAME=$OPENCODE_SERVER_USERNAME"
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
if [[ ! "$OPENCODE_PORT" =~ ^[0-9]{1,5}$ ]] || ((OPENCODE_PORT < 1 || OPENCODE_PORT > 65535)); then
  fail "OPENCODE_PORT must be a port number (got '$OPENCODE_PORT')"
else
  ok "OPENCODE_PORT=$OPENCODE_PORT"
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

case "$ROCKY_GATEWAY_ENABLED" in
  true) ok "ROCKY_GATEWAY_ENABLED=true (OpenCode bound to loopback behind the Rocky gateway)" ;;
  false) warn "ROCKY_GATEWAY_ENABLED=false: the raw OpenCode API (including terminal and configuration endpoints) is exposed to anyone with the password" ;;
  *) fail "ROCKY_GATEWAY_ENABLED must be true or false" ;;
esac

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

# --- Model provider ------------------------------------------------------------
OPENCODE_MODEL="${OPENCODE_MODEL:-}"
OPENCODE_PROVIDER="${OPENCODE_PROVIDER:-}"
if [[ -n "$OPENCODE_MODEL" && ! "$OPENCODE_MODEL" =~ ^[A-Za-z0-9._:@/-]{1,200}$ ]]; then
  fail "OPENCODE_MODEL has an invalid format (expected provider/model)"
fi
if [[ -n "$OPENCODE_PROVIDER" && ! "$OPENCODE_PROVIDER" =~ ^[a-z0-9-]{1,64}$ ]]; then
  fail "OPENCODE_PROVIDER has an invalid format"
fi
provider="$OPENCODE_PROVIDER"
if [[ -z "$provider" && "$OPENCODE_MODEL" == */* ]]; then provider="${OPENCODE_MODEL%%/*}"; fi
case "$provider" in
  "") warn "No model provider selected (OPENCODE_PROVIDER/OPENCODE_MODEL); OpenCode will use its default" ;;
  anthropic) [[ -n "${ANTHROPIC_API_KEY:-}" ]] && ok "Model provider anthropic: credential set" || warn "Model provider anthropic: ANTHROPIC_API_KEY is not set (authentication required)" ;;
  openai) [[ -n "${OPENAI_API_KEY:-}" ]] && ok "Model provider openai: credential set" || warn "Model provider openai: OPENAI_API_KEY is not set (authentication required)" ;;
  opencode) [[ -n "${OPENCODE_API_KEY:-}" ]] && ok "Model provider opencode (Zen): credential set" || warn "Model provider opencode (Zen): OPENCODE_API_KEY is not set; only free models are available" ;;
  amazon-bedrock)
    [[ -n "${AWS_REGION:-}" ]] || warn "Model provider amazon-bedrock: AWS_REGION is not set"
    if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -z "${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:-}" && -z "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]]; then
      warn "Model provider amazon-bedrock: no AWS credentials or task role detected"
    else
      ok "Model provider amazon-bedrock: AWS credentials available"
    fi
    ;;
  *) ok "Model provider $provider selected" ;;
esac

# --- Summary -------------------------------------------------------------------
printf 'Environment variables (sensitive values hidden):\n'
for name in DT_PLATFORM_URL DT_PLATFORM_TOKEN OPENCODE_SERVER_USERNAME OPENCODE_SERVER_PASSWORD OPENCODE_PORT \
  OPENCODE_MODEL OPENCODE_PROVIDER OPENCODE_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY AWS_REGION AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN WORKSPACE_PATH LOG_LEVEL NODE_ENV ALLOWED_ORIGINS; do
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
