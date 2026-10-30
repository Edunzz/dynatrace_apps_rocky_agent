#!/usr/bin/env bash
# Runs once when the codespace is created: installs the app dependencies and,
# when the parameters were provided as Codespaces secrets, runs the setup.

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "Rocky Agent: installing Dynatrace App dependencies..."
(cd dynatrace-app && npm ci --no-audit --no-fund)

if [[ -n "${DT_ENVIRONMENT_URL:-}" && -n "${DT_APP_PLATFORM_TOKEN:-}" ]]; then
  bash .devcontainer/setup.sh --non-interactive || {
    echo "Rocky Agent: setup did not finish. Open a terminal and run: bash .devcontainer/setup.sh"
    exit 0
  }
else
  cat <<'EOF'

Rocky Agent: the parameters were not provided as Codespaces secrets.
Open a terminal and run:

    bash .devcontainer/setup.sh

It asks for your Dynatrace environment and tokens, deploys the app and can
start the runtime in this codespace.
EOF
fi
