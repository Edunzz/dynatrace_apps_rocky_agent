# Release notes

## Unreleased

* Platform token guide in the app and the docs: `dt0s16.` prefix, how to create it
  for a service user, scope profiles (recommended `readwrite-mine`, read-only, RCA
  minimum) and a separate app deployment token.
* New first deployment option: everything local with Docker Compose + `dt-app dev`.
* GitHub Codespaces dev container that asks for the parameters, deploys the app
  with `DT_APP_PLATFORM_TOKEN` and can start the runtime.

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
