#!/usr/bin/env bash
# Rocky Agent runtime entrypoint (runs under tini as PID 1).
#
# Claude sign-in helpers (interactive; nothing else starts):
#   login         claude auth login: opens Anthropic's sign-in page (copy the URL
#                 into your browser) and stores the login in CLAUDE_CONFIG_DIR
#   setup-token   claude setup-token: prints a one-year token for
#                 CLAUDE_CODE_OAUTH_TOKEN
#   auth-status   shows which credential Claude Code uses
#   logout        removes the stored login
#
# Without a command:
#  1. Apply defaults and validate the environment.
#  2. Configure dtctl and check Dynatrace connectivity (degraded mode on failure).
#  3. Install the pinned skills into CLAUDE_CONFIG_DIR/skills.
#  4. Prepare Claude Code's state and start the Rocky gateway, which runs
#     Claude Code for each prompt.

set -Eeuo pipefail
umask 077

ROCKY_HOME="/opt/rocky"
DEFAULT_PASSWORD="gundamjromero2026"

export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
export DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1

case "${1:-}" in
  login) shift; exec claude auth login "$@" ;;
  setup-token) exec claude setup-token ;;
  auth-status) exec claude auth status --text ;;
  logout) exec claude auth logout ;;
  "") ;;
  *)
    echo "Unknown command '$1'. Use login, setup-token, auth-status, logout, or no command to start the runtime." >&2
    exit 2
    ;;
esac

export NODE_ENV="${NODE_ENV:-production}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export ROCKY_PORT="${ROCKY_PORT:-4096}"
export ROCKY_SERVER_USERNAME="${ROCKY_SERVER_USERNAME:-rocky}"
export WORKSPACE_PATH="${WORKSPACE_PATH:-/workspace}"
export ROCKY_STATE_DIR="${ROCKY_STATE_DIR:-/tmp/rocky}"
export ROCKY_DATA_DIR="${ROCKY_DATA_DIR:-$HOME/.rocky}"
export ROCKY_POLICY_FILE="${ROCKY_POLICY_FILE:-$ROCKY_HOME/policy/AGENTS.md}"
export ROCKY_SKILLS_MANIFEST="${ROCKY_SKILLS_MANIFEST:-$ROCKY_HOME/skills-manifest.json}"
export DTCTL_SAFETY_LEVEL="${DTCTL_SAFETY_LEVEL:-readwrite-mine}"
export DTCTL_DISABLE_KEYRING=1
export DTCTL_TOKEN_STORAGE=file

log() { printf '{"time":"%s","level":"%s","component":"rocky-entrypoint","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"; }

# Without ROCKY_SERVER_PASSWORD the runtime starts with the public default
# password, so a first run needs no extra setup; every surface asks to change it.
if [[ -z "${ROCKY_SERVER_PASSWORD:-}" ]]; then
  export ROCKY_SERVER_PASSWORD="$DEFAULT_PASSWORD"
fi
if [[ "${ROCKY_SERVER_PASSWORD:-}" == "$DEFAULT_PASSWORD" ]]; then
  cat >&2 <<'EOF'
################################################################################
#  WARNING: Rocky Agent is using the PUBLIC DEFAULT PASSWORD (see README).     #
#  Anyone who finds this runtime's address can drive the agent with your       #
#  Dynatrace token and your Claude account. CHANGE IT: set                     #
#  ROCKY_SERVER_PASSWORD in .env (16+ characters), run the "up" command again  #
#  and update the password of the connection in the Dynatrace app.             #
################################################################################
EOF
fi

if ! "$ROCKY_HOME/scripts/validate-environment.sh"; then
  log error "environment validation failed; refusing to start"
  exit 1
fi

mkdir -p "$ROCKY_STATE_DIR" "$ROCKY_DATA_DIR" "$CLAUDE_CONFIG_DIR/skills" "$WORKSPACE_PATH/artifacts/drawio"
chmod 700 "$ROCKY_STATE_DIR" "$ROCKY_DATA_DIR" "$CLAUDE_CONFIG_DIR"

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
# Claude Code runs with --setting-sources user, so only skills in
# CLAUDE_CONFIG_DIR/skills load. Refresh the pinned ones on every start so a
# persisted volume always carries the versions baked into this image.
while IFS= read -r name; do
  [[ -n "$name" && -d "$ROCKY_HOME/skills/$name" ]] || continue
  rm -rf "${CLAUDE_CONFIG_DIR:?}/skills/$name"
  cp -R "$ROCKY_HOME/skills/$name" "$CLAUDE_CONFIG_DIR/skills/$name"
done < <(jq -r '.official.skills[], .custom[].name, .drawio.name' "$ROCKY_SKILLS_MANIFEST")
log info "skills installed: $(jq -r '[(.official.skills | length), (.custom | length), 1] | add' "$ROCKY_SKILLS_MANIFEST")"

# --- Claude Code --------------------------------------------------------------------
node "$ROCKY_HOME/scripts/prepare-claude.mjs"
if claude auth status >/dev/null 2>&1; then
  log info "Claude Code: credential configured"
else
  log warn "Claude Code: not signed in. Run 'docker compose run --rm rocky-agent login' or set CLAUDE_CODE_OAUTH_TOKEN"
fi

# --- Gateway --------------------------------------------------------------------------
# The runtime password goes to the gateway in a file it deletes on startup, so
# it never appears in the gateway's (or any agent process's) environment.
secret_file="$(mktemp "$ROCKY_STATE_DIR/.gateway-secret.XXXXXX")"
node -e 'process.stdout.write(JSON.stringify({ password: process.env.ROCKY_SERVER_PASSWORD }))' >"$secret_file"
cd "$WORKSPACE_PATH"
log info "Rocky gateway on 0.0.0.0:${ROCKY_PORT}"
exec env -u ROCKY_SERVER_PASSWORD ROCKY_SECRET_FILE="$secret_file" node "$ROCKY_HOME/gateway/server.mjs"
