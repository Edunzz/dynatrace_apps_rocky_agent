#!/usr/bin/env bash
# Docker HEALTHCHECK: the Rocky gateway answers its liveness probe.
# The probe needs no credentials and returns only {"status":"ok"}.

set -euo pipefail

port="${ROCKY_PORT:-4096}"
curl -fsS --max-time 5 "http://127.0.0.1:${port}/rocky/v1/livez" | grep -q '"status":"ok"'
