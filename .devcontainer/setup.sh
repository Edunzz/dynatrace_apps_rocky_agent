#!/usr/bin/env bash
# Rocky Agent setup for GitHub Codespaces (works in any dev container with Docker).
#
#   bash .devcontainer/setup.sh                    asks for missing values
#   bash .devcontainer/setup.sh --non-interactive  uses environment variables only
#
# 1. Deploys the Dynatrace App to DT_ENVIRONMENT_URL with DT_APP_PLATFORM_TOKEN.
# 2. Optionally builds and starts the Rocky runtime with Docker Compose.
#
# Inputs (environment or Codespaces secrets): DT_ENVIRONMENT_URL,
# DT_APP_PLATFORM_TOKEN, DT_PLATFORM_TOKEN, OPENCODE_SERVER_PASSWORD,
# OPENCODE_MODEL, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENCODE_API_KEY,
# ROCKY_START_RUNTIME (true/false), ROCKY_PUBLIC_PORT (true/false).
# ROCKY_SETUP_DRY_RUN=1 prints the actions without deploying or starting anything.
# Secret values are never printed.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERACTIVE=true
if [[ "${1:-}" == "--non-interactive" || ! -t 0 ]]; then INTERACTIVE=false; fi
DRY_RUN="${ROCKY_SETUP_DRY_RUN:-0}"
APP_ID="my.rocky.agent"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2
  exit 1
}
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# ask VAR "prompt" [secret]: keeps an existing value, otherwise asks (interactive only).
ask() {
  local var="$1" prompt="$2" kind="${3:-}" value="${!1:-}"
  if [[ -z "$value" && "$INTERACTIVE" == true ]]; then
    if [[ "$kind" == secret ]]; then
      read -rsp "$prompt: " value
      echo
    else
      read -rp "$prompt: " value
    fi
  fi
  printf -v "$var" '%s' "$value"
  export "${var?}"
}

# confirm "question" default(y|n): interactive yes/no; returns the default otherwise.
confirm() {
  local question="$1" default="$2" answer
  if [[ "$INTERACTIVE" != true ]]; then
    [[ "$default" == y ]]
    return
  fi
  read -rp "$question [$([[ "$default" == y ]] && echo Y/n || echo y/N)] " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] && ((${#1} >= 20)); }

say "Rocky Agent setup"
[[ "$INTERACTIVE" == true ]] || note "Non-interactive mode: using environment variables and Codespaces secrets."

# --- Dynatrace environment -------------------------------------------------------
ask DT_ENVIRONMENT_URL "Dynatrace environment URL (https://<environment-id>.apps.dynatrace.com)"
DT_ENVIRONMENT_URL="${DT_ENVIRONMENT_URL%/}"
[[ "$DT_ENVIRONMENT_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] ||
  die "DT_ENVIRONMENT_URL must be an HTTPS URL without a path, for example https://abc12345.apps.dynatrace.com"
[[ "$DT_ENVIRONMENT_URL" =~ \.live\.dynatrace\.com$ ]] &&
  die "Use the platform URL (https://<environment-id>.apps.dynatrace.com), not the classic *.live.dynatrace.com URL"

# --- 1. Deploy the Dynatrace App -----------------------------------------------------
ask DT_APP_PLATFORM_TOKEN "Platform token to deploy the app (scopes: app-engine:apps:install, app-engine:apps:run)" secret
if [[ -z "$DT_APP_PLATFORM_TOKEN" ]]; then
  warn "No DT_APP_PLATFORM_TOKEN: skipping the app deployment."
  DEPLOYED=false
else
  valid_token "$DT_APP_PLATFORM_TOKEN" || die "DT_APP_PLATFORM_TOKEN has an unexpected format (value not shown)"
  say "Deploying the Rocky Agent app to $DT_ENVIRONMENT_URL"
  [[ -d "$ROOT/dynatrace-app/node_modules" ]] || run npm --prefix "$ROOT/dynatrace-app" ci --no-audit --no-fund
  (
    cd "$ROOT/dynatrace-app"
    DT_APP_ENVIRONMENT_URL="$DT_ENVIRONMENT_URL/" DT_APP_PLATFORM_TOKEN="$DT_APP_PLATFORM_TOKEN" \
      run npx dt-app deploy --no-open --non-interactive
  ) || die "The app deployment failed. Check the token scopes and that its user may install apps."
  DEPLOYED=true
fi

# --- 2. Optional runtime ----------------------------------------------------------------
START="${ROCKY_START_RUNTIME:-}"
if [[ -z "$START" ]]; then
  if [[ "$INTERACTIVE" == true ]]; then
    confirm "Also build and start the Rocky runtime in this environment?" n && START=true || START=false
  else
    [[ -n "${DT_PLATFORM_TOKEN:-}" ]] && START=true || START=false
  fi
fi

RUNTIME_URL=""
if [[ "$START" == true ]]; then
  ask DT_PLATFORM_TOKEN "Runtime platform token for dtctl (see docs/dynatrace-setup.md for scopes)" secret
  valid_token "$DT_PLATFORM_TOKEN" || die "DT_PLATFORM_TOKEN is missing or has an unexpected format (value not shown)"
  ask OPENCODE_SERVER_PASSWORD "Runtime password, 16+ characters (leave empty to generate one)" secret
  GENERATED_PASSWORD=false
  if [[ -z "$OPENCODE_SERVER_PASSWORD" ]]; then
    OPENCODE_SERVER_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
    GENERATED_PASSWORD=true
  fi
  ((${#OPENCODE_SERVER_PASSWORD} >= 16)) || die "OPENCODE_SERVER_PASSWORD must be at least 16 characters"
  ask OPENCODE_MODEL "Model as provider/model (empty = OpenCode default, for example anthropic/claude-sonnet-4-5)"
  case "${OPENCODE_MODEL%%/*}" in
    anthropic) ask ANTHROPIC_API_KEY "Anthropic API key" secret ;;
    openai) ask OPENAI_API_KEY "OpenAI API key" secret ;;
    opencode) ask OPENCODE_API_KEY "OpenCode Zen API key (empty = free models only)" secret ;;
  esac

  say "Writing the runtime configuration to .env (mode 0600, git-ignored)"
  if [[ -f "$ROOT/.env" && "$DRY_RUN" != "1" ]]; then
    cp -p "$ROOT/.env" "$ROOT/.env.bak.$(date +%Y%m%d%H%M%S)"
    note "Previous .env backed up."
  fi
  env_file="$ROOT/.env"
  [[ "$DRY_RUN" == "1" ]] && env_file="$(mktemp)"
  (
    umask 077
    {
      echo "# Generated by .devcontainer/setup.sh. Contains secrets: never commit."
      echo "DT_PLATFORM_URL=$DT_ENVIRONMENT_URL"
      echo "DT_PLATFORM_TOKEN=$DT_PLATFORM_TOKEN"
      echo "OPENCODE_SERVER_USERNAME=opencode"
      echo "OPENCODE_SERVER_PASSWORD=$OPENCODE_SERVER_PASSWORD"
      echo "OPENCODE_MODEL=${OPENCODE_MODEL:-}"
      echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}"
      echo "OPENAI_API_KEY=${OPENAI_API_KEY:-}"
      echo "OPENCODE_API_KEY=${OPENCODE_API_KEY:-}"
      echo "NODE_ENV=production"
      echo "LOG_LEVEL=info"
      echo "DTCTL_SAFETY_LEVEL=readwrite-mine"
    } >"$env_file"
  )
  [[ "$DRY_RUN" == "1" ]] && printf '[dry-run] wrote %s variables to %s\n' "$(grep -c '=' "$env_file")" "$env_file"

  say "Building and starting the runtime (the first build takes several minutes)"
  if [[ "$DRY_RUN" != "1" ]]; then
    for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
    docker info >/dev/null 2>&1 || die "Docker is not available in this environment"
  fi
  (cd "$ROOT" && NODE_ENV=production run docker compose up -d --build)
  if [[ "$DRY_RUN" != "1" ]]; then
    for _ in $(seq 1 120); do
      curl -fsS --max-time 2 http://127.0.0.1:4096/rocky/v1/livez >/dev/null 2>&1 && break
      sleep 3
    done
    curl -fsS --max-time 2 http://127.0.0.1:4096/rocky/v1/livez >/dev/null || die "The runtime did not become ready; see: docker compose logs"
  fi

  RUNTIME_URL="http://localhost:4096"
  if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
    RUNTIME_URL="https://${CODESPACE_NAME}-4096.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
    public="${ROCKY_PUBLIC_PORT:-}"
    if [[ -z "$public" ]]; then
      confirm "Make port 4096 public so the installed app can reach the runtime? (anyone with the URL can try the password)" n && public=true || public=false
    fi
    if [[ "$public" == true ]]; then
      run gh codespace ports visibility 4096:public -c "$CODESPACE_NAME" ||
        warn "Could not change the port visibility. In the Ports panel, right-click port 4096 > Port Visibility > Public."
    fi
  fi
fi

# --- Summary --------------------------------------------------------------------------------
say "Done"
if [[ "$DEPLOYED" == true ]]; then
  note "App:      $DT_ENVIRONMENT_URL/ui/apps/$APP_ID"
fi
if [[ -n "$RUNTIME_URL" ]]; then
  note "Runtime:  $RUNTIME_URL   (user: opencode)"
  if [[ "${GENERATED_PASSWORD:-false}" == true ]]; then
    note "Password: generated; read it with  grep ^OPENCODE_SERVER_PASSWORD= .env"
  fi
  if [[ "$RUNTIME_URL" == https://* ]]; then
    note "Next: allow the host ${RUNTIME_URL#https://} in Settings > General > External requests,"
    note "      make port 4096 Public if you did not, then use this URL in the app's connection form."
  else
    note "Next: run the app locally with  cd dynatrace-app && DT_APP_ENVIRONMENT_URL=$DT_ENVIRONMENT_URL npm start"
    note "      and connect to http://localhost:4096 (the installed app cannot reach localhost)."
  fi
fi
[[ "$DRY_RUN" == "1" ]] || touch "$ROOT/.devcontainer/.setup-done"
