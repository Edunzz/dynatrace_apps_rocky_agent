# Release notes

## App 0.2.6

* **Auto-approve** switch in the session header: approves the agent's tool
  requests for that session without asking, once each, while the page is open.
  Off by default; Dynatrace changes still need the CONFIRM message, and the
  token's scopes and `DTCTL_SAFETY_LEVEL` still apply (threat model T16).
* **About** dialog (ⓘ in the top bar) with the version, author, source,
  documentation and the community-app disclaimer, which also sits in a footer.
* The **Starter** token profile (Getting started) adds reading lookup tables
  (`storage:files:read`) and creating workflows (`automation:workflows:*`) and
  alerts (`settings:schemas:read`, `settings:objects:read|write`): 20 scopes.
* Docs: a clearer Getting started, a shorter README and a restyled
  architecture diagram with the numbered flow.

## App 0.2.5

* **New session** button at the top of the sidebar and in the session header:
  it opens the start page with the suggested prompts (RCA, logs, alerts,
  business data) while the current session keeps running in the runtime.

## App 0.2.4

Visual redesign; behavior is unchanged and the runtime stays at 0.2.2.

* Follows the light or dark Dynatrace theme: every color is a Strato design
  token instead of the fixed dark console palette.
* App icon and logo: Rocky, a faceted rock on five legs (`icon.svg`).
* Cleaner layout: status pills in the top bar, prompt cards with icons, a
  composer with the start button, and a session page with the conversation,
  a side rail for tasks and artifacts, and a composer that stays in view.
* The conversation has a darker background than the cards around it; your
  messages are bubbles and each tool run is a compact row that expands.
* The session sidebar can be hidden from the top bar (remembered per browser),
  and the open session is highlighted again.
* Warnings that mix text and commands read as one paragraph.

## 0.2.2

* Fix: the runtime failed to start a second time with a persistent home volume
  (`docker compose up` after a restart or a new image). The skill copies kept
  the image's read-only permissions and the refresh could not delete them
  (`rm: cannot remove ... Permission denied`); it now makes the old copy
  writable before replacing it, which also repairs volumes already affected.
* Image checks start the image twice with the same home volume.
* App 0.2.3, fix: **Save connection** failed with an empty red box. `dt-app`
  only deploys settings schemas from `src/settings/schemas/`, and the
  `runtime-connections` schema was in `settings/schemas/`, so it never reached
  the tenant and every save returned 404. The schema moved, and it also gets
  the fixes the tenant requires to install it: `ordered`, the `capabilities`
  list can no longer be null, and the runtime URL pattern uses plain
  alternatives without groups (the tenant rejects greedy quantifiers inside
  capture groups). It also accepts `http://[::1]` like the connection form.
* App 0.2.3, fix: error and warning boxes showed no text. Strato's
  `MessageContainer` needs its text in `MessageContainer.Description`; a test
  now checks every use.
* App 0.2.2 was not released: the tenant registered the version but rejected
  its settings schema, and it does not accept the same version again.

## 0.2.1

* **Public default password `gundamjromero2026`.** Without
  `ROCKY_SERVER_PASSWORD` the runtime now starts with it in every mode,
  including production and the tunnel, so a first run needs no password. It
  replaces `edunzzxgundam79`, which was shorter than the 16-character minimum.
  **Change it:** the startup log, the connection test and the app's home page
  warn until you do. A password you set yourself still needs 16+ characters.
* The gateway no longer rejects the default password through a proxy or tunnel.
* `GET /rocky/v1/status` reports `runtime.defaultPassword`.
* App 0.2.1: **Change the runtime password** notice; the manifest description
  fits the 80-character limit; new connections default to the username `rocky`.
* Docs: start the runtime before signing in to Claude; troubleshooting for
  *container is unhealthy* and Claude login timeouts.

## 0.2.0

The agent runtime now runs **Claude Code** instead of OpenCode, so you can
sign in with your Claude subscription. **Breaking:** runtimes, connections and
deployment templates from 0.1.x need the changes below.

### Runtime

* Claude Code 2.1.308 (native binary verified against Anthropic's signed
  release manifest and pinned digests), driven by the **Rocky gateway**: one
  `claude -p` run per prompt, resuming the session's conversation; the gateway
  translates the event stream into chat messages and stores sessions in
  `~/.rocky`.
* Claude sign-in: `docker compose run --rm rocky-agent login` (subscription
  login kept in the `rocky-home` volume), `setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`),
  `ANTHROPIC_API_KEY`, or Amazon Bedrock / Vertex AI / Foundry. The status bar
  and the connection test show whether Claude is signed in.
* Tool approvals go through an MCP permission tool to the app; unanswered
  approvals are denied after 15 minutes; permanent approvals are refused.
* Managed settings in `/etc/claude-code` are the only source of permission
  rules and hooks; runs ignore workspace settings, hooks and MCP servers;
  credentials are removed from the commands the agent runs.
* New API under `/rocky/v1` (sessions, snapshot, prompt, abort, approvals,
  artifacts). The OpenCode routes are gone.
* Renamed variables: `OPENCODE_SERVER_PASSWORD` → `ROCKY_SERVER_PASSWORD`,
  `OPENCODE_SERVER_USERNAME` → `ROCKY_SERVER_USERNAME` (default user `rocky`),
  `OPENCODE_PORT` → `ROCKY_PORT`, `OPENCODE_MODEL` → `ROCKY_MODEL` (an alias
  such as `sonnet`). OpenAI and OpenCode Zen are no longer supported.
* The runtime password reaches the gateway through a file deleted at startup.
* The image is published as `docker.io/edunzz/rocky-agent` (also on GHCR);
  `docker-compose.yml` uses it, `docker-compose.build.yml` builds it locally.

### Dynatrace App

* Uses the Rocky API: one snapshot call per chat poll, **Claude Code** and
  **Claude** status lights, Claude sign-in step in the connection test, files
  written by the agent in place of the diff, no console button.
* New connections default to the username `rocky`; edit existing connections.

### Earlier unreleased changes

* README **Getting started** in five steps: create two platform tokens, install
  the app from GitHub Codespaces, start the runtime with Docker Compose, allow
  the tunnel host once, connect.
* GitHub Codespaces now follows the pattern of the other Edunzz Dynatrace apps:
  the creation page asks for `DT_APP_ENVIRONMENT_URL` and `DT_APP_PLATFORM_TOKEN`,
  and `npm run deploy:token` deploys the app without a browser sign-in.
* Docker Compose: optional `tunnel` profile (Cloudflare quick tunnel, pinned by
  digest) so the installed app can reach a runtime on your computer; production
  rules by default (`NODE_ENV=production`).
* Gateway: rejects requests that arrive through a proxy or tunnel while the
  development default password is in use.
* Platform token guide in the app and the docs: `dt0s16.` prefix, how to create it
  for a service user, scope profiles (Starter with 13 scopes, full `readwrite-mine`,
  read-only, RCA minimum) and a separate app deployment token
  (`app-engine:apps:install`, `app-engine:apps:run`, `app-engine:apps:delete`).
* Running everything on your computer with Docker Compose + `dt-app dev`
  remains available without a tunnel.

## 0.1.0 (unreleased)

First release of Rocky Agent.

### Runtime

* OpenCode 1.19.5 headless server behind the **Rocky gateway** (basic auth,
  route allowlist, body sanitizing, audit events, extended status, liveness probe).
* dtctl 0.45.0 (checksum-verified), context configured at startup, safety level `readwrite-mine`.
* Skills: all 36 official `dt-*` skills (Dynatrace/dynatrace-for-ai @ `f1abd8d`),
  `dt-custom-rca-jromero` 2.2.0 (Edunzz/dynatrace_ai_skills_rca @ `02a6a14`),
  first-party `drawio` skill, headless draw.io Desktop 32.6.1 exporter.
* Protected baseline `AGENTS.md` and permission rules injected with `OPENCODE_CONFIG_CONTENT`.
* Environment validation, default-password rejection in production, degraded Dynatrace mode.

### Dynatrace App

* Connection wizard with deployment guides, connection test, owner-only secret,
  Credential Vault or memory-only passwords.
* Independent status lights, suggested prompts, policy review before each session.
* Chat with tool and subagent activity, one-time approvals, tasks and artifacts.
* Save to Dynatrace: redacted, immutable snapshots in Grail Resource Store,
  rename through an index, permanent deletion with typed confirmation.

### Deployment

* Docker Compose, Amazon ECS (Terraform, CloudFormation), Azure Container Apps
  (Bicep, Terraform), Kubernetes (Kustomize).

### Verification

* Runtime: 102 unit/script tests; 7 end-to-end tests against a real OpenCode
  server with a mock model provider; image and runtime checks in CI.
* App: 81 unit tests, 7 UI tests, 5 live-runtime integration tests; toolkit build.
* Templates: `terraform validate`, `cfn-lint`, `bicep build`, `kubeconform -strict`.

### Known limitations

See [implementation-plan.md](implementation-plan.md#5-known-limitations-open).
