# Rocky Agent: implementation plan

This plan records what was inspected before coding, the decisions that follow
from it, the assumptions made, and the limitations that remain open. Every
decision marked **verified** was tested against the real component (Claude
Code, Dynatrace platform APIs, dtctl) while preparing this plan.

## 1. Inspection results

### 1.1 Target repository

`Edunzz/dynatrace_apps_rocky_agent` contained only a one-line `README.md` on
`main`. The repository is **public**, so nothing environment-specific (tenant
IDs, URLs, credentials) may be committed. All examples use placeholders such as
`https://abc12345.apps.dynatrace.com`.

### 1.2 Custom RCA skill repository

`Edunzz/dynatrace_ai_skills_rca` contains one valid Agent Skill:

| Item | Value |
|---|---|
| Skill name | `dt-custom-rca-jromero` (version 2.2.0, MIT) |
| Path | `skills/dt-custom-rca-jromero/SKILL.md` with `scripts/`, `references/`, `assets/` |
| Runtime needs | Python 3.9+, `dtctl` with an authenticated SaaS context, official `dt-*` skills, **any** draw.io skill, **draw.io Desktop CLI** |
| Gate | `scripts/check_prereqs.py` stops the RCA (R5 = `FALTA`) when no draw.io skill or no working draw.io CLI is found |
| Output | Dynatrace Notebook with PNG diagrams exported by draw.io Desktop (`-x -f png -e`) and embedded as base64; `build_notebook.py` rejects any non-PNG image |

The skill name differs from the illustrative `rocky-dynatrace-rca` in the
request. The upstream skill is installed **unchanged under its real name**;
renaming it would break its own gate and documentation.

### 1.3 Official Dynatrace skills

`Dynatrace/dynatrace-for-ai` at commit `f1abd8dae1f067e485bbd508a1ebe6003f9fc624`
contains 36 skills under `skills/dt-*/SKILL.md`. The build installs **every**
`dt-*` directory that has a `SKILL.md`, so the catalog is not hard-coded.

### 1.4 Claude Code (verified with Claude Code 2.1.308)

Runtime 0.1 used OpenCode 1.19.5; 0.2 replaced it with Claude Code so users can
sign in with their Claude subscription. Everything below was run with the
Claude Code binary against a mock Anthropic API (`ANTHROPIC_BASE_URL`).

* Native binaries per platform are published under
  `downloads.claude.ai/claude-code-releases/<version>/` with a `manifest.json`
  signed by Anthropic's release key (fingerprint `31DD DE24 … 1A7E CACE`); the
  manifest signature and the binary checksums were verified.
* `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages` emits `system/init`, `stream_event` deltas,
  one `assistant` event per content block (shared API message ID), `user`
  events with `tool_result` blocks and a final `result`. Subagent messages carry
  `parent_tool_use_id`; with background tasks enabled one run can emit several
  `result` events, so the gateway disables them.
* `--session-id <uuid>` starts a conversation with a chosen ID and `--resume
  <uuid>` continues it (the history reached the model).
* `--permission-prompt-tool mcp__rocky__approve` calls an MCP tool with
  `{tool_name, input, tool_use_id}` and accepts
  `{"behavior":"allow","updatedInput":…}` or `{"behavior":"deny","message":…}`
  as JSON text. A denial becomes an error `tool_result` and is listed in
  `permission_denials`. Read-only commands (for example `echo`) run without
  asking; a redirect to a file asks.
* `--setting-sources user` loads skills only from `$CLAUDE_CONFIG_DIR/skills`;
  `--append-system-prompt-file` and `--append-system-prompt` both reach the
  model's system prompt.
* `claude auth status` prints JSON (`loggedIn`, `authMethod`) and exits 1 when
  no credential is configured. A missing login surfaces in the stream as an
  `assistant` event with `error: "authentication_failed"`.
* In print mode, `ANTHROPIC_API_KEY` is used only after it was approved once in
  `$CLAUDE_CONFIG_DIR/.claude.json` (`customApiKeyResponses`); without that the
  run reports "Not logged in". `CLAUDE_CODE_OAUTH_TOKEN` needs no approval.
* Claude Code appends mid-conversation `system` messages (for example a token
  budget note) to its API requests.
* Managed settings (`/etc/claude-code/managed-settings.json` on Linux) rank
  above every other source; `allowManagedPermissionRulesOnly` makes them the
  only source of permission rules and `allowManagedHooksOnly` the only source
  of hooks. In print mode, project settings, hooks and `.mcp.json` servers
  would otherwise apply without a trust prompt.
* `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` removes credentials from the
  environments of the commands Claude Code runs and, on Linux, isolates them in
  a PID namespace (verified on Windows only; Linux is covered by the CI
  container checks).

### 1.5 Dynatrace App platform (verified with dt-app 1.20.0)

* `dt-app create` scaffolds `ui/`, `app.config.json` and ESLint security rules;
  `app.config.ts` is supported. Functions live in `api/<name>.function.ts` and
  are tested with Jest and `@dynatrace/js-runtime`.
* App CSP can only extend `font-src`, `img-src`, `media-src`, `style-src` and
  `script-src`. There is **no `connect-src` and no `frame-src`**: the browser
  cannot call the runtime directly and cannot embed a runtime console.
* App Functions: 120 s timeout, 256 MB, 5 MB in/out, no WebSocket, external
  hosts only when allowlisted in
  `builtin:dt-javascript-runtime.allowed-outbound-connections`.
* App Settings v2 supports `secret` properties (plaintext only inside the app's
  own functions, irreversibly masked elsewhere) and `ownerBasedAccessControl`.
* `/platform/metadata/v1/user` returns `userId` (UUID) inside a function
  (**verified**), so owner paths are derived server-side.

### 1.6 Grail Resource Store (verified with `uploadToTestPattern`, nothing persisted)

* `lookupDataClient.upload` needs `content` as a `Blob`, a DPL `parsePattern`,
  a `lookupField` and a path matching `/lookups/...` (alphanumerics, `-_./`,
  ending alphanumeric, ≤ 500 characters).
* `CSVDQS` parses RFC 4180 style values (doubled quotes, embedded commas and
  newlines). Its default maximum is **4096 characters**; the pattern
  `CSVDQS{1,1000000}:markdown_content` round-tripped a 900 KB Markdown payload
  with Unicode, quotes, CR/LF, tabs and backslashes byte for byte.
* `skippedRecords` counts **matched records**, so the header row is quoted to
  match the pattern and skipped with `skippedRecords: 1`.
* Files are listed with `fetch dt.system.files` (`name`, `display_name`,
  `description`, `modified.timestamp`, `size`, `user.id`).

### 1.7 dtctl (verified with v0.45.0)

* Release assets are published per OS/arch with `checksums.txt` and Sigstore bundles.
* Contexts support `--safety-level readonly|readwrite-mine|readwrite-all|dangerously-unrestricted`.
* Without a keyring, tokens are stored in the plaintext config file
  (`tokens[].token`, referenced by `token-ref`). `DTCTL_TOKEN` does **not**
  override a `token-ref`.

### 1.8 draw.io Desktop

Release v32.6.1 publishes `drawio-amd64-32.6.1.deb`, `drawio-arm64-32.6.1.deb`
and `Files-SHA256-Hashes.txt`.

## 2. Architecture decisions

| # | Decision | Reason |
|---|---|---|
| D1 | The Rocky **gateway** (Node.js, no third-party dependencies) is the runtime's only listener (`ROCKY_PORT`). It serves the Rocky API (`/rocky/v1`), stores sessions and runs `claude -p` per prompt with an allowlisted environment; Claude Code never listens on a port. | Claude Code has no HTTP server; driving the CLI keeps the binary unmodified, as Anthropic requires when hosting it (1.4). |
| D2 | The protected policy is a root-owned `/opt/rocky/policy/AGENTS.md` appended to every run's system prompt; permission rules live in root-owned **managed settings** with `allowManagedPermissionRulesOnly` and `allowManagedHooksOnly`; runs use `--setting-sources user` and `--strict-mcp-config`. | Verified precedence and behavior (1.4). The workspace cannot add settings, hooks or MCP servers. |
| D3 | User policy overlays are stored **with the session** and appended after the baseline (`--append-system-prompt`, `--system-prompt-snapshot off`). | The baseline is always first, and permission rules are enforced by Claude Code, not by the prompt. |
| D4 | dtctl is configured by writing its config file with `umask 077`; the token never appears in process arguments. Default safety level `readwrite-mine`. | Keyring is unavailable in containers (1.7). `readwrite-mine` still lets the RCA skill publish its own notebook after confirmation. |
| D5 | Skills are installed from **pinned commit SHAs** with `git clone` + `git checkout`. | Content-addressed and deterministic; no interactive installer at build time. |
| D6 | A first-party `drawio` skill generates and validates `.drawio` XML with Node.js. draw.io Desktop is installed **headless** (extracted `.deb`, `xvfb-run`, `--no-sandbox`) behind the build argument `INSTALL_DRAWIO_DESKTOP` (default `true`). | Diagram creation never opens a GUI. PNG export is only needed because the RCA skill requires it (gate R5); a slim image can omit it. |
| D7 | Browser → **App Function** → HTTPS runtime. Private runtimes use EdgeConnect or a controlled gateway. | App CSP has no `connect-src` (1.5). |
| D8 | Runtime passwords: (a) App Settings `secret` in an owner-only schema (default), (b) Credential Vault reference, or (c) memory-only for the browser session. | Plaintext is only available server-side inside the app's functions. |
| D9 | Chat posts a prompt (202) and **short-polls** one snapshot endpoint (messages, status, approvals, tasks) with exponential backoff, cancellation, timeout and de-duplication by part ID. | Functions cannot stream and stop after 120 s. |
| D10 | Saved sessions are single-row CSV lookups parsed with `CSVDQS{1,1000000}`; renames rewrite only the per-session index file. Markdown above 900,000 characters is rejected with a clear error. | Verified parser behavior and limits (1.6). |
| D11 | Owner isolation is enforced in the functions (owner ID comes from the platform, never from the client) and narrowed by IAM to `/lookups/rocky-agent/*`. | IAM conditions cannot reference the calling user's ID (see limitation L4). |
| D12 | Tool approvals: Claude Code asks `mcp__rocky__approve` (a stdio MCP helper), which waits on the gateway's loopback endpoint (per-run secret) until the user answers in the app; unanswered requests are denied after 15 minutes. | The only documented headless approval hook for the CLI (1.4); the helper can ask but never approve. |
| D13 | Docker `HEALTHCHECK`, load balancers and probes use the unauthenticated `/rocky/v1/livez`, which returns only `ok`. | ALB target groups cannot send basic auth; secrets must not live in probe specs. |
| D14 | Vulnerability scanning with Grype (`anchore/scan-action`) and SBOM with Syft (`anchore/sbom-action`), pinned by commit SHA. | "Trivy or equivalent"; one vendor for SBOM and scan. |

## 3. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 | Scaffolding, Docker runtime, gateway, dtctl, skills, environment validation, health | Gateway unit tests pass against a real OpenCode server; shell validation tests pass; container builds in CI |
| 2 | App: connection wizard, runtime validation, native chat, session management, status | `tsc`, ESLint, Jest and `dt-app build` pass |
| 3 | Resource Store persistence, Markdown export, redaction, history, rename, delete | Unit tests with a mocked Resource Store; CSV format matches the verified pattern |
| 4 | ECS, Azure Container Apps, Kubernetes, hardening, CI/CD | `terraform validate`, `bicep build`, `cfn-lint` and `kubeconform` run in CI |
| 5 | Integration tests, documentation, release notes, pull request | Docker Compose integration test with a mocked model provider passes in CI |
| 6 | Claude Code runtime (0.2): gateway as server, translator, approvals, managed settings, Docker Hub image | Unit tests with a fake CLI and captured streams; CI runs the real image against a mock Anthropic API |

## 4. Assumptions

* A1. Users run a Dynatrace SaaS environment with AppEngine and Grail; Dynatrace Managed is out of scope (dtctl does not support it).
* A2. Operators can allowlist the runtime host for App Functions or configure EdgeConnect.
* A3. The platform token is created for a dedicated service user whose permissions bound everything the agent can do.
* A4. Claude Code keeps its stream-json event format and `--permission-prompt-tool` contract stable within 2.1.x. The runtime pins `CLAUDE_CODE_VERSION`; captured streams in `tests/fixtures/claude-stream` catch format changes when it is bumped.

## 5. Known limitations (open)

* L1. The agent process and dtctl run as the same Unix user, so a determined prompt could read the dtctl config file. Mitigations: permission rules deny reads of the config directory, outputs are redacted before saving, and the token's own scopes are the real boundary.
* L2. App Functions cannot disable TLS verification or trust a custom CA. The "TLS verification" and "custom CA" fields are recorded for documentation, and a runtime with a private CA must sit behind EdgeConnect or a gateway with a publicly trusted certificate.
* L3. There is no runtime web console; the app is the only user interface.
* L4. IAM policies cannot restrict a user to their own `/lookups/rocky-agent/sessions/<owner-id>/` prefix. Users who receive broad `storage:files:read` on `/lookups/rocky-agent/*` can read other users' saved snapshots with DQL outside the app.
* L5. A full upload → `load` round trip of a large saved session was **not** executed against a tenant during development (only the parser was). It must be validated during the first deployment (see the deployment checklist).
* L6. No Docker engine was available on the development workstation; container behavior is validated by the CI workflows.
* L7. The Dynatrace App was built and its functions were exercised against a
  live runtime, but it was **not deployed to a Dynatrace environment** during
  development. App settings secrets, Credential Vault access, Resource Store
  uploads, DQL listing and the UI in AppEngine still need a first-deployment
  check. No screenshots are included for that reason.
* L8. Live Dynatrace authentication from the container (`dtctl auth whoami`
  with a real platform token) was not executed in CI; CI verifies the degraded
  path with an unreachable placeholder environment.
* L9. The ECS, Azure Container Apps and Kubernetes templates are validated
  statically (Terraform, cfn-lint, Bicep, kubeconform) but were not applied to
  live cloud accounts.
* L10. The Codespaces app deployment (`npm run deploy:token`) is tested in
  dry-run mode only; a deployment from a real codespace to a real environment
  is pending. Running the runtime on your computer with `dt-app dev` was
  verified by running the built app functions in the local Dynatrace JavaScript
  runtime against a local runtime; `dt-app dev` itself was not started because
  it needs a browser sign-in.
* L11. The Getting started path (installed app + Cloudflare quick tunnel) has
  not been run end to end: the compose configuration and the gateway's proxy
  check are covered by tests, but no real tunnel was started against a real
  environment. Quick-tunnel addresses change on every restart and are meant for
  testing only.
* L12. Claude Code was exercised against a mock Anthropic API only. Signing in
  with a real Claude account inside the container (`login`, `setup-token`) and
  a real model run have not been tested by this project.
* L13. A Claude subscription credential belongs to one person; Anthropic does
  not allow sharing it through a runtime that other people use. The runtime
  cannot enforce this; the documentation states it.
* L14. The Docker Hub image (`edunzz/rocky-agent`) is published by the release
  workflow, which needs the repository variable `DOCKERHUB_USERNAME` and the
  secret `DOCKERHUB_TOKEN`; until a release ran, Getting started must build the
  image locally (`docker-compose.build.yml`).

## 6. Status and verification

| Phase | Status |
|---|---|
| 1 Runtime | Done |
| 2 App connection, chat, sessions | Done (not deployed to a tenant, see L7) |
| 3 Resource Store persistence | Done (parser verified on a tenant; upload/load round trip pending, see L5) |
| 4 Deployments and CI/CD | Done (static validation, see L9) |
| 5 Tests, documentation, PR | Done |

### Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Container starts with valid variables | Verified | CI compose stack: healthy, all runtime checks |
| 2 | Agent runtime reachable through authenticated HTTPS | Partly verified | Authenticated access through the gateway verified; TLS is terminated by the ingress templates and was not exercised end to end |
| 3 | dtctl authenticates to Dynatrace | Not verified live | Config format verified with dtctl 0.45; degraded mode verified (L8) |
| 4 | Official `dt-*` skills discoverable | Verified | CI: skills installed in `~/.claude/skills` reported by `/rocky/v1/status` |
| 5 | RCA skill installed only if valid | Verified | Installer run against both pinned repos plus a negative case |
| 6 | Editable draw.io XML | Verified | Validator tests; CI exports PNG headlessly; RCA gate passes |
| 7 | Connection validated and saved without exposing the password | Partly verified | Function logic and connection test against a live runtime; settings secret not exercised on a tenant (L7) |
| 8 | Create an agent session from the app | Verified at function level | App Function handlers against the live runtime in CI |
| 9 | Send prompts and receive responses | Verified at function level | Same, with the mock model provider |
| 10 | Destructive operations require confirmation | Verified for runtime approvals | Permission request → `always` refused → `once` approved; the confirmation block itself depends on the model following the baseline |
| 11 | Review and customize AGENTS.md without weakening it | Verified | Weakening overlay rejected end to end; managed settings precedence documented and checked in the image |
| 12 | Ephemeral sessions clearly identified | Implemented | Sidebar section and session chip |
| 13 | Persisted only on "Save to Dynatrace" | Verified | No upload outside the save action (tests) |
| 14 | Saved content immutable | Verified with a mocked store | `overwrite: false`, SHA-256 check; real store behavior pending (L5) |
| 15 | Only the display title can be renamed | Verified with a mocked store | Snapshot bytes unchanged after rename |
| 16 | Permanent deletion after confirmation | Verified with a mocked store | Typed `DELETE` required; both resources removed |
| 17 | No secrets in Grail | Verified for known formats | Redaction tests on saved content |
| 18 | Deployment instructions work | Docker verified; others static | L9 |
| 19 | Tests, lint, type checks and scans pass | Verified | CI workflows |
| 20 | Delivered through a feature branch and PR | Done | `feat/rocky-agent-initial`, PR #1 |
