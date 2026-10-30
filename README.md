# Rocky Agent

**An AI agent for Dynatrace that you run yourself.** Ask for a root cause
analysis, a log-quality review, an alert-quality notebook or a business
dashboard from a Dynatrace app; the agent ([Claude Code](https://code.claude.com))
investigates with `dtctl` and the official Dynatrace skills, works read-only by
default and asks before it changes anything.

## Getting started

You will install the **app** in your Dynatrace environment (from GitHub
Codespaces, nothing to install) and run the **agent runtime** on your computer
with Docker. About 15 minutes.

**You need:** a Dynatrace SaaS environment where you can install apps and edit
settings · a GitHub account · [Docker Desktop](https://www.docker.com/products/docker-desktop/) ·
a Claude subscription (Pro, Max, Team or Enterprise) or an Anthropic API key.

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
| `ROCKY_SERVER_PASSWORD` | a password you choose, **16 characters or more** |

Sign in to Claude (once; the login is kept in a Docker volume):

```bash
docker compose run --rm rocky-agent login
```

It prints an address. Open it in your browser, sign in with your Claude account
and, if the page shows a code, paste it back into the terminal. With an
Anthropic API key instead, skip this and set `ANTHROPIC_API_KEY` in `.env`.

Then start it with a public HTTPS tunnel, so the app in Dynatrace can reach it:

```bash
docker compose --profile tunnel up -d    # downloads the image from Docker Hub the first time
docker compose logs tunnel               # copy the https://….trycloudflare.com address
```

> [!NOTE]
> A Claude subscription is for **your own** use: don't let other people use
> the agent through your runtime. For a team, use an Anthropic API key or a
> cloud provider ([details](agent-runtime/README.md#signing-in-to-claude)).

### Step 4 — Allow Dynatrace to call the tunnel (once)

In Dynatrace: **Settings → General → External requests** → add the host
`*.trycloudflare.com` → **Save**. (Needs settings permission; ask an admin if
you cannot edit it.)

### Step 5 — Connect and rock

1. Open the app link from step 2.
2. **New runtime connection**: Runtime URL = the `https://….trycloudflare.com`
   address, Username = `rocky`, Password = your `ROCKY_SERVER_PASSWORD`.
3. **Test connection** (every step should pass, including *Claude sign-in*) →
   **Save connection**.
4. Pick a suggested prompt (or write your own) → **Let’s Rock**.

**Stop:** `docker compose --profile tunnel down`. **Start again:** the same
`up` command; your Claude login and sessions are kept, but the tunnel address
changes each time, so edit the connection in the app with the new address.

> [!WARNING]
> The tunnel makes your runtime reachable from the Internet at a random
> address, protected by your password. Use it to try Rocky Agent; for teams use
> a [server or cloud deployment](#deployment-targets) with HTTPS.

**Other ways to run it:** everything on your computer with `dt-app dev` (no
tunnel, [guide](docs/deployment/local.md#option-b-run-the-app-locally-with-dt-app-dev)) ·
Docker on a server · Amazon ECS · Azure Container Apps · Kubernetes — see
[Deployment targets](#deployment-targets). To build the image yourself instead
of downloading it: `docker compose -f docker-compose.yml -f docker-compose.build.yml --profile tunnel up -d --build`.

---

# Documentation

![Rocky Agent architecture](docs/images/architecture.png)

<sub>Editable source: [docs/images/architecture.drawio](docs/images/architecture.drawio), generated with the bundled draw.io skill.</sub>

## Contents

[Components](#components) · [Security warnings](#security-warnings) ·
[Environment variables](#environment-variables) · [Deployment targets](#deployment-targets) ·
[Local development](#local-development) · [Dynatrace App installation](#dynatrace-app-installation) ·
[Resource Store permissions](#resource-store-permissions) · [Platform token setup](#platform-token-setup) ·
[Claude sign-in](#claude-sign-in) · [Skills](#skills) · [AGENTS.md behavior](#agentsmd-behavior) ·
[Sessions and retention](#ephemeral-and-saved-sessions) · [Troubleshooting](#troubleshooting) ·
[Upgrades](#upgrade-procedure) · [Known limitations](#known-limitations)

## Components

| Component | Path | What it is |
|---|---|---|
| Agent runtime | [`agent-runtime/`](agent-runtime/README.md) | Non-root Debian container: Claude Code 2.1.308, dtctl 0.45.0, 36 official `dt-*` skills, the RCA skill, a draw.io skill, a headless draw.io exporter and the **Rocky gateway**. Published as [`edunzz/rocky-agent`](https://hub.docker.com/r/edunzz/rocky-agent) on Docker Hub |
| Dynatrace App | [`dynatrace-app/`](dynatrace-app/README.md) | React + Strato app with a connection wizard, status lights, chat, approvals and saved sessions |
| Deployments | [`deploy/`](deploy/) | Docker Compose, ECS (Terraform, CloudFormation), Azure Container Apps (Bicep, Terraform), Kubernetes (Kustomize) |
| Documentation | [`docs/`](docs/) | Implementation plan, security, deployment and operations guides |

The **Rocky gateway** is the runtime's only network entry point (port 4096).
It authenticates the app, stores sessions, starts Claude Code for each prompt
(`claude -p`, resuming the session's conversation), turns its event stream into
chat messages, and holds every tool approval until the user answers in the app.
It also records approvals as audit events and exposes `/rocky/v1/status` and
`/rocky/v1/livez`. Claude Code never listens on a port.

## Security warnings

* **Never expose port 4096 directly to the Internet.** Terminate TLS at a
  load balancer, ingress or reverse proxy, and restrict who can reach it.
* The default password `edunzzxgundam79` is public. It is accepted only when
  `NODE_ENV` is not `production`; production requires a unique password of at
  least 16 characters.
* The platform token gives the agent the permissions of its service user.
  Create a **dedicated service user** with only the scopes you need.
* A Claude subscription login belongs to one person. Anthropic does not allow
  sharing it through a runtime other people use.
* Secrets are injected at deploy time only. See [docs/security/secrets.md](docs/security/secrets.md)
  and the [threat model](docs/security/threat-model.md).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DT_PLATFORM_URL` | yes | | `https://<environment-id>.apps.dynatrace.com` |
| `DT_PLATFORM_TOKEN` | yes | | Platform token (secret). Never leaves the container. |
| `ROCKY_SERVER_PASSWORD` | yes (production) | `edunzzxgundam79` outside production | Runtime password (secret), 16+ characters in production |
| `ROCKY_SERVER_USERNAME` | no | `rocky` | Runtime username |
| `ROCKY_PORT` | no | `4096` | Listening port |
| `CLAUDE_CODE_OAUTH_TOKEN` | one Claude credential | | Claude subscription token from `setup-token` (secret, personal use) |
| `ANTHROPIC_API_KEY` | one Claude credential | | Anthropic API key (secret) |
| `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, … | one Claude credential | | Amazon Bedrock; prefer a task role |
| `ROCKY_MODEL` | no | Claude Code default | Model alias (`sonnet`, `opus`) or full name |
| `WORKSPACE_PATH` | no | `/workspace` | Agent workspace |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | no | `production` | `production`, `development`, `test` |
| `ALLOWED_ORIGINS` | no | | HTTPS origins for direct browser access; `*` is rejected in production |
| `DTCTL_SAFETY_LEVEL` | no | `readwrite-mine` | `readonly`, `readwrite-mine`, `readwrite-all` |

More settings (timeouts, concurrency, removed tools, credential scrubbing) are
listed in [agent-runtime/README.md](agent-runtime/README.md#environment-variables).
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
install -m 600 /dev/null rocky.env && ${EDITOR:-vi} rocky.env   # include ANTHROPIC_API_KEY
docker run --rm --name rocky-agent -p 127.0.0.1:4096:4096 --env-file rocky.env \
  -v rocky-workspace:/workspace -v rocky-home:/home/rocky \
  --read-only --tmpfs /tmp:size=512m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  docker.io/edunzz/rocky-agent:0.2.0
```

Then put an HTTPS reverse proxy in front of it and connect the app to its URL.

Start with 1 vCPU, 2 GiB RAM and 20 GiB ephemeral storage; large repositories
may need 2 vCPU and 4–8 GiB. Run **one replica**: sessions live inside one
runtime.

## Local development

```bash
# Runtime: gateway, translator, scripts, draw.io skill (Node.js 24; jq for a few tests)
cd agent-runtime && npm test

# App: types, lint, tests, build
cd dynatrace-app && npm ci && npm run typecheck && npm run lint && npm test && npm run build

# End to end: the real image with Claude Code and a mock Anthropic API (no model is called)
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
the environment before Claude Code starts; `DTCTL_SAFETY_LEVEL` adds a
client-side guard on top.

Deploying the app without a browser login (Codespaces, CI) uses a **separate**
platform token, `DT_APP_PLATFORM_TOKEN`, with `app-engine:apps:install`,
`app-engine:apps:run` and `app-engine:apps:delete`.

## Claude sign-in

The runtime password and the Claude credential are different secrets; the app
shows their status separately (**Runtime** and **Claude**).

| Option | How | Who may use the runtime |
|---|---|---|
| Claude subscription login | `docker compose run --rm rocky-agent login` (stored in the `rocky-home` volume) | You only |
| Claude subscription token | `docker compose run --rm rocky-agent setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` | You only |
| Anthropic API key | `ANTHROPIC_API_KEY` | Your team |
| Amazon Bedrock, Google Vertex AI, Microsoft Foundry | `CLAUDE_CODE_USE_BEDROCK=1` (or `_VERTEX`, `_FOUNDRY`) + provider settings | Your team |

`docker compose run --rm rocky-agent auth-status` shows the credential in use.
Claude credentials are never stored by the app or in Grail, and are removed from
the environment of the commands the agent runs.

## Skills

Installed at build time from pinned commits and copied to
`~/.claude/skills/` (the only skill location the runtime loads) at startup:

* **All official `dt-*` skills** from [Dynatrace/dynatrace-for-ai](https://github.com/Dynatrace/dynatrace-for-ai) (36 at the pinned commit).
* **`dt-custom-rca-jromero`** from [Edunzz/dynatrace_ai_skills_rca](https://github.com/Edunzz/dynatrace_ai_skills_rca). The build fails if that repository has no valid skill.
* **`drawio`**: builds and validates editable `.drawio` XML; PNG/SVG export through the headless draw.io CLI.

`GET /rocky/v1/status` and the **Skills** light report the inventory.

## AGENTS.md behavior

The protected baseline ([agent-runtime/AGENTS.md](agent-runtime/AGENTS.md)) is
installed read-only and added to the system prompt of every run. It enforces
read-only analysis by default, the confirmation protocol below, secret
protection, TLS validation and auditing.

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

Enforcement does not rely on the prompt alone. Claude Code **managed settings**
([agent-runtime/claude/managed-settings.json](agent-runtime/claude/managed-settings.json),
installed root-owned in `/etc/claude-code/`) are the only source of permission
rules: they allow read-only dtctl commands and writes to the artifact folders,
deny access to credentials and runtime state, and every other command or edit
asks the user in the app. Runs ignore settings, hooks and MCP servers from the
workspace, and the gateway refuses permanent ("always") approvals. Before
starting a session, the app shows the baseline and lets the user add
**restrictions** (an overlay stored with the session). Statements that try to
weaken the baseline are rejected.

## Ephemeral and saved sessions

**Ephemeral session:** lives in the runtime (conversation and messages) and is
lost when the runtime's home volume is removed.

**Saved session:** the user-visible conversation exported to Markdown, redacted
and stored as an immutable tabular resource in Dynatrace Grail Resource Store.

| | Ephemeral | Saved |
|---|---|---|
| Where | Runtime home (`/home/rocky/.rocky`, `/home/rocky/.claude/projects`), workspace | `/lookups/rocky-agent/sessions/<owner>/<id>` + index |
| Contents | Everything, including tool output and reasoning | User-visible messages and tool activity; reasoning removed; secrets redacted; long payloads truncated |
| Lifetime | Until deleted, or until the home volume is removed (cloud templates: until the task or pod is replaced) | Until the user deletes it permanently |
| Changes | Continue, rename, delete | Rename the display title or delete; content is immutable |
| Backup | None (use **Save to Dynatrace**) | Grail Resource Store retention and your Dynatrace backup policy |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Container exits with `environment validation failed` | Missing variable, default password in production, short password | Read the `[FAIL]` lines in the log |
| **Claude: Not signed in** | No Claude credential | `docker compose run --rm rocky-agent login`, or set `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` |
| **Claude: Sign-in rejected** | Expired login or revoked key | Sign in again or replace the key |
| **Dynatrace: unavailable** | Network/DNS/TLS from the runtime | Check egress to `*.apps.dynatrace.com` |
| **Dynatrace: authentication failed** | Token invalid, expired or wrong environment | Recreate the platform token; check `DT_PLATFORM_URL` |
| App: *runtime could not be reached* | Host not allowlisted, private CA, private network | External requests allowlist, public certificate, EdgeConnect |
| App: *authentication failed* | Wrong username or password (the username is `rocky`) | Edit the connection and re-enter the password |
| `session_busy` (409) | The agent is still working on that session | Wait, or **Stop generation** |
| `route_not_allowed` | Not part of the Rocky API | Expected for anything outside `/rocky/v1` |
| Saved session list empty | Missing `storage:files:read` or IAM path | See Resource Store permissions |

More: [docs/operations.md](docs/operations.md).

## Upgrade procedure

1. Read the [release notes](docs/release-notes.md).
2. Save any ephemeral session you want to keep (**Save to Dynatrace**).
3. Deploy the new image tag (or digest) and the new app version.
4. Run the connection test. Saved sessions are unaffected.

Pinned inputs and how to bump them are listed in [CONTRIBUTING.md](CONTRIBUTING.md#updating-pinned-versions).

## Known limitations

See the full list in [docs/implementation-plan.md](docs/implementation-plan.md#5-known-limitations-open). In short:

* The agent and dtctl run as the same Unix user; permission rules and
  redaction protect the token, but the token's scopes are the real boundary.
* App Functions cannot trust private CAs or skip TLS checks.
* IAM cannot restrict each user to their own `/lookups/rocky-agent/sessions/<owner>/` prefix.
* One replica per runtime; sessions are not shared between replicas.
* Deployment templates are validated statically in CI; they have not been
  applied to live AWS or Azure accounts by this project.
* The installed app cannot reach a runtime on your `localhost` directly; Getting
  started uses a Cloudflare quick tunnel (testing only, the address changes on
  every restart). The tunnel path has not been run end to end yet.
* The Codespaces deployment script has been tested in dry-run mode only.
* CI tests Claude Code against a mock API; signing in with a real Claude
  account inside the container (`login`) has not been tested by this project.

## License

[MIT](LICENSE)
