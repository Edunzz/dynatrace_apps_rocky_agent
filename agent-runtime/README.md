# Rocky Agent runtime

A portable Linux container that runs [OpenCode](https://opencode.ai) in headless
server mode with `dtctl`, the official Dynatrace skills, the custom RCA skill, a
draw.io skill and the Rocky gateway.

```text
            client (Dynatrace App Function, curl, browser console)
                                │ HTTPS (TLS terminated at ingress/proxy)
                                ▼
 ┌──────────────────────── container (uid 10001) ─────────────────────────┐
 │  Rocky gateway  :4096   basic auth · route allowlist · body sanitizing │
 │       │                 /rocky/v1/status · /rocky/v1/livez · audit     │
 │       ▼ loopback + random internal password                            │
 │  opencode serve 127.0.0.1:4097   OPENCODE_CONFIG_CONTENT (baseline)    │
 │       │  skills: /workspace/.opencode/skills (36 dt-* + RCA + drawio)  │
 │       ├─ dtctl (context "rocky", token in 0600 config file)            │
 │       └─ draw.io CLI (headless, export only)                           │
 └────────────────────────────────────────────────────────────────────────┘
```

## Contents

| Path | Purpose |
|---|---|
| `Dockerfile` | Production image (multi-stage, pinned inputs, non-root) |
| `Dockerfile.dev` | Development layer with debugging tools |
| `entrypoint.sh` | Validation, dtctl setup, skills, process supervision |
| `healthcheck.sh` | Docker `HEALTHCHECK` (authenticated `/global/health`) |
| `AGENTS.md` | Protected baseline policy (`/opt/rocky/policy/AGENTS.md`) |
| `opencode.json` | Baseline OpenCode config: permissions, instructions, sharing disabled |
| `src/optional-gateway/` | Rocky gateway (Node.js, no third-party dependencies) |
| `scripts/` | Build-time installers and runtime validation |
| `skills/` | First-party draw.io skill and notes on the pinned external skills |
| `tests/` | Unit, script, draw.io and end-to-end tests |

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DT_PLATFORM_URL` | yes | | `https://<environment-id>.apps.dynatrace.com` |
| `DT_PLATFORM_TOKEN` | yes | | Platform token of a dedicated service user. Unset before OpenCode starts. |
| `OPENCODE_SERVER_PASSWORD` | yes in production | `edunzzxgundam79` outside production only | ≥ 16 characters in production; the default is rejected |
| `OPENCODE_SERVER_USERNAME` | no | `opencode` | |
| `OPENCODE_PORT` | no | `4096` | Port of the gateway (or of OpenCode when the gateway is disabled) |
| `OPENCODE_MODEL` | no | OpenCode default | `provider/model`, for example `anthropic/claude-sonnet-4-5` |
| `OPENCODE_PROVIDER` | no | | Prefix used when `OPENCODE_MODEL` has no provider |
| `OPENCODE_API_KEY` | no | | OpenCode Zen |
| `ANTHROPIC_API_KEY` | no | | Anthropic |
| `OPENAI_API_KEY` | no | | OpenAI |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | no | | Amazon Bedrock (prefer a task role) |
| `WORKSPACE_PATH` | no | `/workspace` | |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | no | `production` | `production`, `development`, `test` |
| `ALLOWED_ORIGINS` | no | | Comma-separated HTTPS origins for browser access; `*` is rejected in production |
| `DTCTL_SAFETY_LEVEL` | no | `readwrite-mine` | `readonly`, `readwrite-mine`, `readwrite-all` |
| `ROCKY_GATEWAY_ENABLED` | no | `true` | `false` exposes the raw OpenCode API (not recommended) |
| `ROCKY_CONSOLE_ENABLED` | no | `false` | Serve the OpenCode web console through the gateway (terminal stays blocked) |
| `ROCKY_EXTRA_CONFIG_FILE` | no | | JSON with extra providers or MCP servers; protected keys are ignored |

## Endpoints (gateway mode)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/rocky/v1/livez` | none | `{"status":"ok"}` or 503; for load balancers and probes |
| GET | `/global/health` | basic | OpenCode health and version |
| GET | `/rocky/v1/status` | basic | Runtime, OpenCode, model provider, Dynatrace, dtctl, skills, workspace |
| POST | `/rocky/v1/status/refresh` | basic | Re-run the Dynatrace check (max once per minute) |
| GET | `/rocky/v1/policy` | basic | Effective baseline `AGENTS.md` |
| GET/PUT | `/rocky/v1/sessions/{id}/policy` | basic | Per-session additive policy overlay |
| various | `/session…`, `/permission…`, `/question…`, `/provider`, `/skill`, `/agent` | basic | Allowlisted OpenCode operations |

Everything else returns `404 route_not_allowed`. Terminal, shell, configuration,
credential, MCP, sharing and lifecycle routes return `403 route_blocked`, even in
console mode.

## Build

```bash
docker build -t rocky-agent:local agent-runtime
# Slim image without the draw.io exporter (the RCA skill will report it as missing):
docker build -t rocky-agent:slim --build-arg INSTALL_DRAWIO_DESKTOP=false agent-runtime
```

## Test

```bash
cd agent-runtime
npm test                      # unit, script and draw.io tests (jq required for some)
ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npm run test:integration
```

The integration test expects a runtime configured with the mock model provider
([`tests/integration/mock-llm.mjs`](tests/integration/mock-llm.mjs)); see
[`deploy/local/docker-compose.ci.yml`](../deploy/local/docker-compose.ci.yml).
