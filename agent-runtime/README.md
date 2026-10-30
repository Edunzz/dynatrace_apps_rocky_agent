# Rocky Agent runtime

A portable Linux container that runs [Claude Code](https://code.claude.com) for
the Rocky Agent app, with `dtctl`, the official Dynatrace skills, the custom RCA
skill and a draw.io skill. The Rocky gateway is the only network entry point: it
authenticates the app, stores sessions, starts Claude Code for each prompt and
brokers tool approvals.

```text
            client (Dynatrace App Function, curl)
                                │ HTTPS (TLS terminated at ingress/proxy/tunnel)
                                ▼
 ┌──────────────────────── container (uid 10001) ──────────────────────────┐
 │  Rocky gateway :4096   basic auth · route allowlist · sessions · audit  │
 │       │  per prompt: claude -p --resume <conversation>                  │
 │       ▼  (stream-json in/out, --setting-sources user, allowlisted env)  │
 │  Claude Code ── managed settings /etc/claude-code (permission rules)    │
 │       │  policy: /opt/rocky/policy/AGENTS.md in the system prompt       │
 │       │  skills: ~/.claude/skills (dt-* + RCA + drawio)                 │
 │       ├─ mcp__rocky__approve ──► gateway (127.0.0.1) ──► app approval   │
 │       ├─ dtctl (context "rocky", token in 0600 config file)             │
 │       └─ draw.io CLI (headless, export only)                            │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Contents

| Path | Purpose |
|---|---|
| `Dockerfile` | Production image (multi-stage, pinned and verified inputs, non-root) |
| `Dockerfile.dev` | Development layer with debugging tools |
| `entrypoint.sh` | Validation, dtctl setup, skills, Claude sign-in helpers, gateway start |
| `healthcheck.sh` | Docker `HEALTHCHECK` (`/rocky/v1/livez`, no credentials) |
| `AGENTS.md` | Protected baseline policy (`/opt/rocky/policy/AGENTS.md`) |
| `claude/managed-settings.json` | Claude Code managed settings: permission rules nothing else can override |
| `src/gateway/` | Rocky gateway (Node.js, no third-party dependencies) |
| `scripts/` | Build-time installers and runtime validation |
| `skills/` | First-party draw.io skill and notes on the pinned external skills |
| `tests/` | Unit, script, draw.io and end-to-end tests |

## Signing in to Claude

Claude Code needs one credential. Pick one:

| Option | How |
|---|---|
| Claude subscription (Pro, Max, Team, Enterprise), login stored in the container's home volume | `docker compose run --rm rocky-agent login`: open the URL it prints, sign in, paste the code back |
| Claude subscription, token in `.env` | `docker compose run --rm rocky-agent setup-token`, then `CLAUDE_CODE_OAUTH_TOKEN=...` |
| Anthropic API key (pay per use) | `ANTHROPIC_API_KEY=...` |
| Amazon Bedrock, Google Vertex AI, Microsoft Foundry | `CLAUDE_CODE_USE_BEDROCK=1` (or `_VERTEX`, `_FOUNDRY`) plus that provider's variables |

A Claude subscription is for **your own** use: Anthropic does not allow other
people to use it through Rocky. For a team, use an API key, a cloud provider, or
a runtime per person. `docker compose run --rm rocky-agent auth-status` shows the
credential in use; the app's status bar shows it too.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DT_PLATFORM_URL` | yes | | `https://<environment-id>.apps.dynatrace.com` |
| `DT_PLATFORM_TOKEN` | yes | | Platform token. Written to the dtctl config, then unset before anything else starts. |
| `ROCKY_SERVER_PASSWORD` | yes in production | `edunzzxgundam79` outside production only | ≥ 16 characters in production; the default is rejected. Never reaches Claude Code. |
| `ROCKY_SERVER_USERNAME` | no | `rocky` | |
| `ROCKY_PORT` | no | `4096` | |
| `CLAUDE_CODE_OAUTH_TOKEN` | one credential | | From `claude setup-token` (subscription) |
| `ANTHROPIC_API_KEY` | one credential | | Anthropic Console key |
| `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, … | one credential | | Amazon Bedrock (prefer a task role) |
| `CLAUDE_CODE_USE_VERTEX`, `CLOUD_ML_REGION`, `ANTHROPIC_VERTEX_PROJECT_ID` | one credential | | Google Vertex AI |
| `ROCKY_MODEL` | no | Claude Code default | Alias (`sonnet`, `opus`) or full model name |
| `ROCKY_SUBPROCESS_ENV_SCRUB` | no | `false` | Claude Code's credential scrub for the commands the agent runs. Needs bubblewrap with user namespaces, which standard container runtimes (Docker's default seccomp profile, Fargate, Container Apps) block; with `true` there, every run fails. The managed rules below cover the common cases instead |
| `ROCKY_PERMISSION_TIMEOUT_MS` | no | `900000` | An unanswered approval is denied after this time |
| `ROCKY_RUN_TIMEOUT_MS` | no | `3600000` | Longest single run |
| `ROCKY_MAX_CONCURRENT_RUNS` | no | `4` | Sessions that can work at the same time |
| `ROCKY_DISALLOWED_TOOLS` | no | scheduling, worktree, notification and question tools | Comma-separated Claude Code tools removed from every run |
| `WORKSPACE_PATH` | no | `/workspace` | |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | no | `production` | `production`, `development`, `test` |
| `ALLOWED_ORIGINS` | no | | Comma-separated HTTPS origins for browser access; `*` is rejected in production |
| `DTCTL_SAFETY_LEVEL` | no | `readwrite-mine` | `readonly`, `readwrite-mine`, `readwrite-all` |

State lives under `/home/rocky`: `.claude/` (Claude login, conversation
transcripts, skills) and `.rocky/` (sessions). Mount a volume there to keep them
across restarts; otherwise sessions are ephemeral.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/rocky/v1/livez` | none | `{"status":"ok"}`; for load balancers and probes |
| GET | `/rocky/v1/health` | basic | Runtime and Claude Code version |
| GET | `/rocky/v1/status` | basic | Runtime, Claude Code, Claude sign-in, Dynatrace, dtctl, skills, workspace |
| POST | `/rocky/v1/status/refresh` | basic | Re-run the Dynatrace and sign-in checks (max once per minute) |
| GET | `/rocky/v1/policy` | basic | Effective baseline `AGENTS.md` |
| GET | `/rocky/v1/skills` | basic | Installed skills |
| GET, POST | `/rocky/v1/sessions` | basic | List or create sessions |
| GET | `/rocky/v1/sessions/status` | basic | Busy sessions |
| GET, PATCH, DELETE | `/rocky/v1/sessions/{id}` | basic | Read, rename (title only) or delete a session and its transcript |
| GET | `/rocky/v1/sessions/{id}/messages`, `/snapshot` | basic | Messages; snapshot adds status, pending approvals and tasks |
| POST | `/rocky/v1/sessions/{id}/prompt` | basic | `{"text": "..."}`; starts a run (409 while one is running) |
| POST | `/rocky/v1/sessions/{id}/abort` | basic | Stop the run |
| GET | `/rocky/v1/sessions/{id}/todo`, `/artifacts` | basic | Task list and files the agent wrote |
| GET, PUT | `/rocky/v1/sessions/{id}/policy` | basic | Per-session additive policy overlay |
| GET | `/rocky/v1/permissions` | basic | Pending tool approvals |
| POST | `/rocky/v1/permissions/{id}/reply` | basic | `{"reply": "once" \| "reject"}`; permanent approvals are refused |

Everything else returns `404 route_not_allowed`. Claude Code itself never listens
on a port.

## Build

```bash
docker build -t rocky-agent:local agent-runtime
# Slim image without the draw.io exporter (the RCA skill will report it as missing):
docker build -t rocky-agent:slim --build-arg INSTALL_DRAWIO_DESKTOP=false agent-runtime
```

## Test

```bash
cd agent-runtime
npm test                      # unit, translator, script and draw.io tests (jq required for some)
ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npm run test:integration
```

Unit tests replace the `claude` CLI with
[`tests/fixtures/fake-claude.mjs`](tests/fixtures/fake-claude.mjs); the translator
tests replay event streams captured from Claude Code
([`tests/fixtures/claude-stream/`](tests/fixtures/claude-stream/)). The
integration test expects the real image talking to the mock Anthropic API
([`tests/integration/mock-anthropic.mjs`](tests/integration/mock-anthropic.mjs));
see [`deploy/local/docker-compose.ci.yml`](../deploy/local/docker-compose.ci.yml).
