#!/usr/bin/env bash
# Rocky Agent runtime entrypoint (runs under tini as PID 1).
#
#  1. Apply defaults and validate the environment.
#  2. Configure dtctl and check Dynatrace connectivity (degraded mode on failure).
#  3. Install the pinned skills into the workspace.
#  4. Start `opencode serve` (loopback, behind the Rocky gateway) and the gateway.

set -Eeuo pipefail
umask 077

ROCKY_HOME="/opt/rocky"
DEFAULT_PASSWORD="edunzzxgundam79"

export NODE_ENV="${NODE_ENV:-production}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export OPENCODE_PORT="${OPENCODE_PORT:-4096}"
export OPENCODE_INTERNAL_PORT="${OPENCODE_INTERNAL_PORT:-4097}"
export OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
export WORKSPACE_PATH="${WORKSPACE_PATH:-/workspace}"
export ROCKY_STATE_DIR="${ROCKY_STATE_DIR:-/tmp/rocky}"
export ROCKY_GATEWAY_ENABLED="${ROCKY_GATEWAY_ENABLED:-true}"
export ROCKY_POLICY_FILE="${ROCKY_POLICY_FILE:-$ROCKY_HOME/policy/AGENTS.md}"
export ROCKY_SKILLS_MANIFEST="${ROCKY_SKILLS_MANIFEST:-$ROCKY_HOME/skills-manifest.json}"
export DTCTL_SAFETY_LEVEL="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"
export DTCTL_DISABLE_KEYRING=1
export DTCTL_TOKEN_STORAGE=file
export OPENCODE_DISABLE_AUTOUPDATE=true

log() { printf '{"time":"%s","level":"%s","component":"rocky-entrypoint","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"; }

# The documented first-run default is only applied outside production.
if [[ -z "${OPENCODE_SERVER_PASSWORD:-}" && "$NODE_ENV" != "production" ]]; then
  export OPENCODE_SERVER_PASSWORD="$DEFAULT_PASSWORD"
fi
if [[ "${OPENCODE_SERVER_PASSWORD:-}" == "$DEFAULT_PASSWORD" ]]; then
  cat >&2 <<'EOF'
################################################################################
#  WARNING: Rocky Agent is using the documented DEVELOPMENT DEFAULT PASSWORD.  #
#  Anyone who knows it can drive the agent. Set OPENCODE_SERVER_PASSWORD to a  #
#  unique value of at least 16 characters. Production startup rejects it.      #
################################################################################
EOF
fi

if ! "$ROCKY_HOME/scripts/validate-environment.sh"; then
  log error "environment validation failed; refusing to start"
  exit 1
fi

mkdir -p "$ROCKY_STATE_DIR" "$WORKSPACE_PATH/artifacts/drawio" "$WORKSPACE_PATH/.opencode/skills"
chmod 700 "$ROCKY_STATE_DIR"

# --- Dynatrace / dtctl ------------------------------------------------------------
"$ROCKY_HOME/scripts/configure-dtctl.sh"
if "$ROCKY_HOME/scripts/validate-dynatrace.sh"; then
  log info "Dynatrace connection: connected"
else
  log warn "Dynatrace connection: unavailable; starting in degraded mode"
fi
# dtctl now reads the token from its 0600 config file; agent processes do not need it.
unset DT_PLATFORM_TOKEN

# --- Skills -----------------------------------------------------------------------
# Refresh the pinned skills in the workspace on every start so a persisted
# workspace volume always carries the versions baked into this image.
while IFS= read -r name; do
  [[ -n "$name" && -d "$ROCKY_HOME/skills/$name" ]] || continue
  rm -rf "${WORKSPACE_PATH:?}/.opencode/skills/$name"
  cp -R "$ROCKY_HOME/skills/$name" "$WORKSPACE_PATH/.opencode/skills/$name"
done < <(jq -r '.official.skills[], .custom[].name, .drawio.name' "$ROCKY_SKILLS_MANIFEST")
log info "skills installed: $(jq -r '[.official.skills | length, (.custom | length), 1] | add' "$ROCKY_SKILLS_MANIFEST")"

# --- OpenCode configuration ------------------------------------------------------
extra=()
if [[ -n "${ROCKY_EXTRA_CONFIG_FILE:-}" ]]; then extra=("$ROCKY_EXTRA_CONFIG_FILE"); fi
OPENCODE_CONFIG_CONTENT="$(node "$ROCKY_HOME/scripts/compose-opencode-config.mjs" "$ROCKY_HOME/opencode/opencode.json" "${extra[@]}")"
export OPENCODE_CONFIG_CONTENT

cd "$WORKSPACE_PATH"
pids=()
shutdown() {
  log info "stopping"
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  wait || true
}
trap shutdown TERM INT

if [[ "$ROCKY_GATEWAY_ENABLED" == "true" ]]; then
  # A random internal password protects the loopback OpenCode server, so the
  # client password never reaches the agent's own processes.
  internal_password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  client_password="$OPENCODE_SERVER_PASSWORD"

  OPENCODE_SERVER_PASSWORD="$internal_password" \
    opencode serve --hostname 127.0.0.1 --port "$OPENCODE_INTERNAL_PORT" &
  pids+=("$!")

  env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENCODE_API_KEY -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    -u OPENCODE_CONFIG_CONTENT \
    OPENCODE_SERVER_PASSWORD="$client_password" ROCKY_UPSTREAM_PASSWORD="$internal_password" \
    node "$ROCKY_HOME/gateway/server.mjs" &
  pids+=("$!")
  unset internal_password client_password
  log info "OpenCode on 127.0.0.1:${OPENCODE_INTERNAL_PORT}, Rocky gateway on 0.0.0.0:${OPENCODE_PORT}"
else
  cors=()
  IFS=',' read -r -a origins <<<"${ALLOWED_ORIGINS:-}"
  for origin in "${origins[@]}"; do
    origin="${origin//[[:space:]]/}"
    [[ -n "$origin" && "$origin" != "*" ]] && cors+=(--cors "$origin")
  done
  opencode serve --hostname 0.0.0.0 --port "$OPENCODE_PORT" "${cors[@]}" &
  pids+=("$!")
  log warn "gateway disabled: raw OpenCode API on 0.0.0.0:${OPENCODE_PORT}"
fi

# Exit as soon as any child exits so the orchestrator restarts the container.
set +e
wait -n "${pids[@]}"
status=$?
shutdown
exit "$status"
