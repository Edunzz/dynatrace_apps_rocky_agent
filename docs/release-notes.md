# Release notes

## Unreleased

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
