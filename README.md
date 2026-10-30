# Rocky Agent

**An AI agent for Dynatrace that you run yourself.** Ask for a root cause
analysis, a log-quality review, an alert-quality notebook or a business
dashboard from a Dynatrace app; the agent investigates with `dtctl` and the
official Dynatrace skills, works read-only by default and asks before it
changes anything.

## Getting started

You will install the **app** in your Dynatrace environment (from GitHub
Codespaces, nothing to install) and run the **agent runtime** on your computer
with Docker. About 20 minutes, most of it waiting for builds.

**You need:** a Dynatrace SaaS environment where you can install apps and edit
settings · a GitHub account · [Docker Desktop](https://www.docker.com/products/docker-desktop/) ·
an Anthropic or OpenAI API key (optional: without one the agent uses free OpenCode Zen models).

### Step 1 — Create two platform tokens

Go to [My platform tokens](https://myaccount.dynatrace.com/platformTokens) →
**Platform token**. For each token: give it a name and an expiration date,
choose your environment, add the scopes, select **Generate** and copy it (it is
shown only once). Tokens start with `dt0s16.`.

| Token | What it is for | Scopes |
|---|---|---|
| **App token** | Installs the app (step 2) | `app-engine:apps:install`, `app-engine:apps:run`, `app-engine:apps:delete` |
| **Runtime token** | Lets the agent read your Dynatrace data (step 3) | `storage:buckets:read`, `storage:logs:read`, `storage:metrics:read`, `storage:spans:read`, `storage:events:read`, `storage:entities:read`, `storage:smartscape:read`, `storage:bizevents:read`, `storage:user.events:read`, `storage:user.sessions:read`, `storage:system:read`, `document:documents:read`, `document:documents:write` |

Already have an app token for another Edunzz Dynatrace app? Reuse it. A token
only works within its user's permissions; for teams, create the runtime token
for a service user ([details](docs/dynatrace-setup.md)).

### Step 2 — Install the app in Dynatrace

1. Click this button:

   [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Edunzz/dynatrace_apps_rocky_agent)

2. On the creation page, fill in the two recommended secrets and select **Create codespace**:

   | Secret | Value |
   |---|---|
   | `DT_APP_ENVIRONMENT_URL` | `https://<environment-id>.apps.dynatrace.com` |
   | `DT_APP_PLATFORM_TOKEN` | the **app token** from step 1 |

3. When the terminal shows *Rocky Agent app — ready to deploy*, run:

   ```bash
   npm run deploy:token
   ```

   Press **Enter** twice to keep your values. It prints the app link:
   `https://<environment-id>.apps.dynatrace.com/ui/apps/my.rocky.agent`.

You can stop the codespace afterwards; the app stays installed.

### Step 3 — Start the runtime on your computer

```bash
git clone https://github.com/Edunzz/dynatrace_apps_rocky_agent.git
cd dynatrace_apps_rocky_agent
cp .env.example .env          # Windows (PowerShell): copy .env.example .env
```

Open `.env` in any editor and fill in:

| Line | Value |
|---|---|
| `DT_PLATFORM_URL` | `https://<environment-id>.apps.dynatrace.com` |
| `DT_PLATFORM_TOKEN` | the **runtime token** from step 1 |
| `OPENCODE_SERVER_PASSWORD` | a password you choose, **16 characters or more** |
| `ANTHROPIC_API_KEY` | your key; or clear `OPENCODE_MODEL=` to use free models |

Then start it with a public HTTPS tunnel, so the app in Dynatrace can reach it:

```bash
docker compose --profile tunnel up -d --build    # the first build takes ~10 minutes
docker compose logs tunnel                        # copy the https://….trycloudflare.com address
```

### Step 4 — Allow Dynatrace to call the tunnel (once)

In Dynatrace: **Settings → General → External requests** → add the host
`*.trycloudflare.com` → **Save**. (Needs settings permission; ask an admin if
you cannot edit it.)

### Step 5 — Connect and rock

1. Open the app link from step 2.
2. **New runtime connection**: Runtime URL = the `https://….trycloudflare.com`
   address, Username = `opencode`, Password = your `OPENCODE_SERVER_PASSWORD`.
3. **Test connection** → **Save connection**.
4. Pick a suggested prompt (or write your own) → **Let’s Rock**.

**Stop:** `docker compose --profile tunnel down`. **Start again:** the same
`up` command; the tunnel address changes each time, so edit the connection in
the app with the new address.

> [!WARNING]
> The tunnel makes your runtime reachable from the Internet at a random
> address, protected by your password. Use it to try Rocky Agent; for teams use
> a [server or cloud deployment](#deployment-targets) with HTTPS.

**Other ways to run it:** everything on your computer with `dt-app dev` (no
tunnel, [guide](docs/deployment/local.md#option-b-run-the-app-locally-with-dt-app-dev)) ·
Docker on a server · Amazon ECS · Azure Container Apps · Kubernetes — see
[Deployment targets](#deployment-targets).

---

# Documentation

![Rocky Agent architecture](docs/images/architecture.png)

<sub>Editable source: [docs/images/architecture.drawio](docs/images/architecture.drawio), generated with the bundled draw.io skill.</sub>

## Contents

[Components](#components) · [Security warnings](#security-warnings) ·
[Environment variables](#environment-variables) · [Deployment targets](#deployment-targets) ·
[Local development](#local-development) · [Dynatrace App installation](#dynatrace-app-installation) ·
[Resource Store permissions](#resource-store-permissions) · [Platform token setup](#platform-token-setup) ·
[Model providers](#model-provider-setup) · [Skills](#skills) · [AGENTS.md behavior](#agentsmd-behavior) ·
[Sessions and retention](#ephemeral-and-saved-sessions) · [Troubleshooting](#troubleshooting) ·
[Upgrades](#upgrade-procedure) · [Known limitations](#known-limitations)

## Components

| Component | Path | What it is |
|---|---|---|
| Agent runtime | [`agent-runtime/`](agent-runtime/README.md) | Non-root Debian container: OpenCode 1.19.5, dtctl 0.45.0, 36 official `dt-*` skills, the RCA skill, a draw.io skill, a headless draw.io exporter and the **Rocky gateway** |
| Dynatrace App | [`dynatrace-app/`](dynatrace-app/README.md) | React + Strato app with a connection wizard, status lights, chat, approvals and saved sessions |
| Deployments | [`deploy/`](deploy/) | Docker Compose, ECS (Terraform, CloudFormation), Azure Container Apps (Bicep, Terraform), Kubernetes (Kustomize) |
| Documentation | [`docs/`](docs/) | Implementation plan, security, deployment and operations guides |

The **Rocky gateway** listens on port 4096 in front of `opencode serve`, which
is bound to loopback. It authenticates clients, forwards only the OpenCode
routes the app needs, blocks terminal, shell, configuration and credential
routes, sanitizes request bodies, applies per-session policy overlays, records
approvals as audit events and exposes `/rocky/v1/status` and
`/rocky/v1/livez`.

## Security warnings

* **Never expose port 4096 directly to the Internet.** Terminate TLS at a
  load balancer, ingress or reverse proxy, and restrict who can reach it.
* The default password `edunzzxgundam79` is public. It is accepted only when
  `NODE_ENV` is not `production`; production requires a unique password of at
  least 16 characters.
* The platform token gives the agent the permissions of its service user.
  Create a **dedicated service user** with only the scopes you need.
* Keep `ROCKY_GATEWAY_ENABLED=true`. Without the gateway, anyone with the
  password can open terminals and change the OpenCode configuration.
* Secrets are injected at deploy time only. See [docs/security/secrets.md](docs/security/secrets.md)
  and the [threat model](docs/security/threat-model.md).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DT_PLATFORM_URL` | yes | | `https://<environment-id>.apps.dynatrace.com` |
| `DT_PLATFORM_TOKEN` | yes | | Platform token (secret). Never leaves the container. |
| `OPENCODE_SERVER_PASSWORD` | yes (production) | `edunzzxgundam79` outside production | Runtime password (secret), 16+ characters in production |
| `OPENCODE_SERVER_USERNAME` | no | `opencode` | Runtime username |
| `OPENCODE_PORT` | no | `4096` | Listening port |
| `OPENCODE_MODEL` | no | OpenCode default | `provider/model`, for example `anthropic/claude-sonnet-4-5` |
| `OPENCODE_PROVIDER` | no | | Provider prefix when `OPENCODE_MODEL` has none |
| `OPENCODE_API_KEY` | no | | OpenCode Zen key (secret) |
| `ANTHROPIC_API_KEY` | no | | Anthropic key (secret) |
| `OPENAI_API_KEY` | no | | OpenAI key (secret) |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | no | | Amazon Bedrock; prefer a task role |
| `WORKSPACE_PATH` | no | `/workspace` | Agent workspace |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | no | `production` | `production`, `development`, `test` |
| `ALLOWED_ORIGINS` | no | | HTTPS origins for direct browser access; `*` is rejected in production |
| `DTCTL_SAFETY_LEVEL` | no | `readwrite-mine` | `readonly`, `readwrite-mine`, `readwrite-all` |
| `ROCKY_GATEWAY_ENABLED` | no | `true` | `false` exposes the raw OpenCode API |
| `ROCKY_CONSOLE_ENABLED` | no | `false` | Serve the OpenCode web console through the gateway |
| `ROCKY_EXTRA_CONFIG_FILE` | no | | Extra providers or MCP servers (protected keys ignored) |

Variables whose names contain `TOKEN`, `PASSWORD`, `SECRET`, `API_KEY`,
`CREDENTIAL` or `AUTH` are never printed.

## Deployment targets

| Target | Templates | Guide |
|---|---|---|
| Your computer: Docker Compose + tunnel (Getting started) | [`docker-compose.yml`](docker-compose.yml) | [docs/deployment/local.md](docs/deployment/local.md) |
| Your computer: Docker Compose + `dt-app dev` (no tunnel) | [`docker-compose.yml`](docker-compose.yml) | [docs/deployment/local.md](docs/deployment/local.md#option-b-run-the-app-locally-with-dt-app-dev) |
| App installation from GitHub Codespaces | [`.devcontainer/`](.devcontainer/) | [docs/deployment/codespaces.md](docs/deployment/codespaces.md) |
| Docker on a server | [`docker-compose.yml`](docker-compose.yml), [`deploy/local/`](deploy/local/) | [docs/deployment/docker.md](docs/deployment/docker.md) |
| Amazon ECS (Fargate) | [Terraform](deploy/aws-ecs/terraform/), [CloudFormation](deploy/aws-ecs/cloudformation/rocky-agent.yaml) | [docs/deployment/aws-ecs.md](docs/deployment/aws-ecs.md) |
| Azure Container Apps | [Bicep](deploy/azure-container-apps/bicep/main.bicep), [Terraform](deploy/azure-container-apps/terraform/) | [docs/deployment/azure-container-apps.md](docs/deployment/azure-container-apps.md) |
| Kubernetes | [Kustomize](deploy/kubernetes/) | [docs/deployment/kubernetes.md](docs/deployment/kubernetes.md) |
| Existing runtime | — | [docs/deployment/existing-runtime.md](docs/deployment/existing-runtime.md) |

Running the published image on a server (secrets come from a file, not from shell history):

```bash
install -m 600 /dev/null rocky.env && ${EDITOR:-vi} rocky.env
docker run --rm --name rocky-agent -p 127.0.0.1:4096:4096 --env-file rocky.env \
  -v rocky-workspace:/workspace \
  --read-only --tmpfs /tmp:size=512m --tmpfs /home/rocky:size=1g,uid=10001,gid=10001 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/edunzz/dynatrace_apps_rocky_agent:0.1.0
```

Then put an HTTPS reverse proxy in front of it and connect the app to its URL.

Start with 1 vCPU, 2 GiB RAM and 20 GiB ephemeral storage; large repositories
may need 2 vCPU and 4–8 GiB. Run **one replica**: sessions live inside one
runtime.

## Local development

```bash
# Runtime: gateway, scripts, draw.io skill (Node.js 24; jq for a few tests)
cd agent-runtime && npm test

# App: types, lint, tests, build
cd dynatrace-app && npm ci && npm run typecheck && npm run lint && npm test && npm run build

# End to end with a mock model provider (no external LLM is called)
docker build -t rocky-agent:ci agent-runtime
docker compose -f deploy/local/docker-compose.ci.yml up -d
bash agent-runtime/tests/container/compose-checks.sh
(cd agent-runtime && ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=ci-integration-password-0123 npm run test:integration)
(cd dynatrace-app && ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=ci-integration-password-0123 npx jest --selectProjects unit tests/integration)
docker compose -f deploy/local/docker-compose.ci.yml down -v
```

## Dynatrace App installation

1. Allow the runtime host for App Functions: **Settings → General → External
   requests** (`builtin:dt-javascript-runtime.allowed-outbound-connections`).
   Private runtimes go through **Dynatrace EdgeConnect**.
2. Build and deploy:

   ```bash
   cd dynatrace-app && npm ci
   DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm run deploy
   ```

   Without a browser sign-in: `npm run deploy:token` with `DT_APP_PLATFORM_TOKEN`
   (`app-engine:apps:install`, `app-engine:apps:run`, `app-engine:apps:delete`), or
   from [Codespaces](docs/deployment/codespaces.md) as in Getting started.

3. Give users the app's scopes and the IAM policy below.
4. Open **Rocky Agent**, deploy or pick a runtime, run **Test connection** and save.

## Resource Store permissions

Saved sessions live under `/lookups/rocky-agent/`. Grant app users:

```text
ALLOW storage:files:read, storage:files:write, storage:files:delete
  WHERE storage:file-path startsWith "/lookups/rocky-agent/";
```

The app also requests `app-settings:objects:read/write` (owner-only runtime
connections), `environment-api:credentials:read` (optional Credential Vault
passwords) and `state:user-app-states:read/write` (optional default policy).
Details: [docs/dynatrace-setup.md](docs/dynatrace-setup.md).

## Platform token setup

`DT_PLATFORM_TOKEN` is a Dynatrace **platform token**: it starts with
`dt0s16.` (classic `dt0c01.` API tokens do not work). Effective access is the
intersection of its scopes and the permissions of the user it belongs to, so
create it for a **dedicated service user**:

1. Create the service user and bind its IAM policies.
2. Open <https://myaccount.dynatrace.com/platformTokens> → **Platform token**,
   choose the environment and generate it **for the service user**.
3. Select the scopes of a profile and store the token as `DT_PLATFORM_TOKEN`.

| Profile | `DTCTL_SAFETY_LEVEL` | Scopes |
|---|---|---|
| **Starter** (Getting started): reads data, publishes its own notebooks | `readwrite-mine` | The 13 scopes in Getting started, step 1 |
| **Recommended** (full): analysis + your own notebooks, dashboards and workflows after confirmation | `readwrite-mine` | dtctl's `readwrite-mine` list + `storage:user.events:read`, `storage:user.sessions:read` (53) |
| **Read-only**: analysis only; the RCA skill cannot publish its notebook | `readonly` | dtctl's `readonly` list (39) |
| **RCA minimum** | — | `storage:buckets:read`, `storage:events:read`, `storage:logs:read`, `storage:metrics:read`, `storage:spans:read`, `storage:entities:read`, `storage:smartscape:read`, `document:documents:read`, `document:documents:write` |

The full lists are in [docs/dynatrace-setup.md](docs/dynatrace-setup.md#1-runtime-platform-token-dt_platform_token)
and in the app under **Dynatrace platform token** (with copy buttons). The
token is written to dtctl's config file (mode 0600) at startup and removed from
the environment before OpenCode starts; `DTCTL_SAFETY_LEVEL` adds a client-side
guard on top.

Deploying the app without a browser login (Codespaces, CI) uses a **separate**
platform token, `DT_APP_PLATFORM_TOKEN`, with `app-engine:apps:install`,
`app-engine:apps:run` and `app-engine:apps:delete`.

## Model provider setup

The runtime password and the model credential are different secrets; the app
shows their status separately (**Runtime** and **Model**).

| Provider | `OPENCODE_PROVIDER` | Credential |
|---|---|---|
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY` (free models work without it) |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Amazon Bedrock | `amazon-bedrock` | `AWS_REGION` + task role (or AWS keys) |

Model credentials are never stored by the app or in Grail.

## Skills

Installed at build time from pinned commits and copied to
`/workspace/.opencode/skills/` at startup:

* **All official `dt-*` skills** from [Dynatrace/dynatrace-for-ai](https://github.com/Dynatrace/dynatrace-for-ai) (36 at the pinned commit).
* **`dt-custom-rca-jromero`** from [Edunzz/dynatrace_ai_skills_rca](https://github.com/Edunzz/dynatrace_ai_skills_rca). The build fails if that repository has no valid skill.
* **`drawio`**: builds and validates editable `.drawio` XML; PNG/SVG export through the headless draw.io CLI.

`GET /rocky/v1/status` and the **Skills** light report the inventory.

## AGENTS.md behavior

The protected baseline ([agent-runtime/AGENTS.md](agent-runtime/AGENTS.md)) is
installed read-only and loaded into every session. It enforces read-only
analysis by default, the confirmation protocol below, secret protection, TLS
validation and auditing.

```text
Proposed action:
Target:
Expected impact:
Rollback:
Commands or API operations:
Requires confirmation: Yes
```

The user answers `CONFIRM: Execute the described change`. A confirmation
covers one operation and expires when it finishes.

Enforcement does not rely on the prompt alone: OpenCode permission rules
(injected with `OPENCODE_CONFIG_CONTENT`, which overrides any project
`opencode.json`) ask before every non-read-only command, and the gateway
refuses permanent ("always") approvals. Before starting a session, the app
shows the baseline and lets the user add **restrictions** (an overlay kept in
runtime memory). Statements that try to weaken the baseline are rejected.

## Ephemeral and saved sessions

**Ephemeral session:** exists only inside the OpenCode runtime and is lost
when the runtime is destroyed.

**Saved session:** the user-visible conversation exported to Markdown, redacted
and stored as an immutable tabular resource in Dynatrace Grail Resource Store.

| | Ephemeral | Saved |
|---|---|---|
| Where | Runtime container (`~/.local/share/opencode`, workspace) | `/lookups/rocky-agent/sessions/<owner>/<id>` + index |
| Contents | Everything, including tool output and reasoning | User-visible messages and tool activity; reasoning removed; secrets redacted; long payloads truncated |
| Lifetime | Until deleted or the runtime is destroyed | Until the user deletes it permanently |
| Changes | Continue, rename, delete | Rename the display title or delete; content is immutable |
| Backup | None (use **Save to Dynatrace**) | Grail Resource Store retention and your Dynatrace backup policy |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Container exits with `environment validation failed` | Missing variable, default password in production, short password | Read the `[FAIL]` lines in the log |
| **Dynatrace: unavailable** | Network/DNS/TLS from the runtime | Check egress to `*.apps.dynatrace.com` |
| **Dynatrace: authentication failed** | Token invalid, expired or wrong environment | Recreate the platform token; check `DT_PLATFORM_URL` |
| **Model: authentication required** | Provider key missing | Set the provider credential |
| App: *runtime could not be reached* | Host not allowlisted, private CA, private network | External requests allowlist, public certificate, EdgeConnect |
| App: *authentication failed* | Wrong password | Edit the connection and re-enter the password |
| `route_not_allowed` / `route_blocked` | Gateway allowlist | Expected for terminal/config routes |
| Saved session list empty | Missing `storage:files:read` or IAM path | See Resource Store permissions |

More: [docs/operations.md](docs/operations.md).

## Upgrade procedure

1. Read the [release notes](docs/release-notes.md).
2. Save any ephemeral session you want to keep (**Save to Dynatrace**).
3. Deploy the new image tag (or digest) and the new app version.
4. Run the connection test. Saved sessions are unaffected; ephemeral sessions do not survive a runtime replacement.

Pinned inputs and how to bump them are listed in [CONTRIBUTING.md](CONTRIBUTING.md#updating-pinned-versions).

## Known limitations

See the full list in [docs/implementation-plan.md](docs/implementation-plan.md#5-known-limitations-open). In short:

* The agent and dtctl run as the same Unix user; permission rules and
  redaction protect the token, but the token's scopes are the real boundary.
* App Functions cannot trust private CAs or skip TLS checks.
* The OpenCode console opens in a new tab; it cannot be embedded.
* IAM cannot restrict each user to their own `/lookups/rocky-agent/sessions/<owner>/` prefix.
* One replica per runtime; sessions are not shared between replicas.
* Deployment templates are validated statically in CI; they have not been
  applied to live AWS or Azure accounts by this project.
* The installed app cannot reach a runtime on your `localhost` directly; Getting
  started uses a Cloudflare quick tunnel (testing only, the address changes on
  every restart). The tunnel path has not been run end to end yet.
* The Codespaces deployment script has been tested in dry-run mode only.

## License

[MIT](LICENSE)
