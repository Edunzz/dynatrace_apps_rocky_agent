# Rocky Agent threat model

## 1. Assets

| Asset | Where it lives |
|---|---|
| Dynatrace platform token | Deployment secret → runtime env at start → dtctl config file (0600). Removed from the environment before the gateway and Claude Code start. |
| Runtime password | Deployment secret; app settings `secret` property, Credential Vault, or browser memory. Inside the runtime it is handed to the gateway in a file deleted at startup, so it is in no process environment. |
| Claude credential | Subscription login in `~/.claude/.credentials.json` (home volume), `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or a cloud role → Claude Code process environment |
| Tenant data the agent reads | Agent context, Claude Code transcripts and workspace |
| Saved conversations | Grail Resource Store under `/lookups/rocky-agent/` |
| Ability to change Dynatrace | dtctl with the service user's scopes |

## 2. Trust boundaries

```text
 [Browser]──(Dynatrace session)──▶[AppEngine: UI + App Functions]──(HTTPS + basic auth)──▶[Ingress/TLS]──▶[Rocky gateway :4096]
                                          │                                                       │ spawn per prompt (allowlisted env)
                                          ├──▶ App settings (owner-only)                          ▼            ▲ loopback, per-run secret
                                          ├──▶ Credential Vault                            [Claude Code + agent tools]──▶ mcp__rocky__approve
                                          └──▶ Grail Resource Store                         │                │
                                                                                           ▼                ▼
                                                                                 [Anthropic / cloud]  [dtctl → Dynatrace]
```

| Boundary | Control |
|---|---|
| Browser → App Functions | Dynatrace authentication; functions run with the user's permissions |
| App Functions → runtime | HTTPS only (HTTP only to localhost in development), publicly trusted certificate, outbound allowlist or EdgeConnect, basic auth, redirects refused, named operations only |
| Ingress → gateway | TLS at ingress; gateway authenticates every request (constant-time compare, failure limiter); only `/rocky/v1` routes exist |
| Gateway → Claude Code | One process per prompt with an allowlisted environment (no runtime password, no platform token); fixed flags: `--setting-sources user`, `--strict-mcp-config`, `--permission-prompt-tool`, policy in the system prompt |
| Claude Code → gateway (approvals) | MCP helper on loopback with a per-run secret; it can only create approval requests, never answer them |
| Claude Code → shell/tools | Managed settings in `/etc/claude-code` (root-owned): the only source of permission rules and hooks; credentials and runtime state denied; everything not allowed asks the user; `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` removes credentials from command environments |
| Runtime → Dynatrace | Platform token scopes of a dedicated service user; dtctl safety level |
| Runtime → Anthropic | The Claude credential; a subscription credential is personal |
| App Functions → Grail | Owner path derived server-side, IAM path restriction, upload with `overwrite: false` |

## 3. Authentication flow

1. The user signs in to Dynatrace and opens the app.
2. The user saves a connection: URL, username and either a password (stored as
   an owner-only `secret`), a Credential Vault ID or nothing (memory-only).
   Changing URL or username forces the password to be re-entered.
3. For each operation the browser calls an App Function with the connection
   ID (plus the password only in memory-only mode).
4. The function reads the settings object (secrets are plaintext only inside
   the app's functions), or the Credential Vault entry, builds `Authorization:
   Basic …` and calls the runtime over HTTPS.
5. The gateway validates the credentials and serves the request itself; for a
   prompt it starts Claude Code, which authenticates to Anthropic with the
   runtime's own Claude credential.

## 4. Authorization model

* **Who can use a runtime:** whoever knows its password. Connections are
  owner-only settings objects; share a runtime by sharing its password through
  your secret manager, not through the app. A runtime signed in with a Claude
  subscription must not be shared (Anthropic's terms).
* **What the agent can do in Dynatrace:** exactly the platform token's scopes,
  further limited client-side by `DTCTL_SAFETY_LEVEL` (default `readwrite-mine`).
* **What the agent may do without asking:** Claude Code's built-in read-only
  commands and the rules allowed in
  [`managed-settings.json`](../../agent-runtime/claude/managed-settings.json)
  (read-only dtctl commands, the skills' own scripts, writes to the artifact
  folders). Everything else asks; the user approves **once** per operation;
  permanent approvals are refused.
* **Saved sessions:** owner-scoped paths computed from the platform identity;
  IAM restricts the app to `/lookups/rocky-agent/`.

## 5. Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Runtime exposed to the Internet is brute-forced | TLS at ingress, IP restrictions, 16+ character password in production, failure limiter (10 failures → 60 s block), default password refused through proxies and tunnels | Distributed guessing; use network restrictions |
| T2 | Password holder gets a shell or changes the agent's configuration | The gateway exposes only the Rocky API; Claude Code never listens on a port; flags and environment are fixed by the gateway | — |
| T3 | A repository in the workspace adds hooks, settings, environment variables or MCP servers | `--setting-sources user`, `--strict-mcp-config`, `allowManagedHooksOnly`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | — |
| T4 | Prompt injection makes the agent change or delete Dynatrace objects | Read-only default, permission prompts, scoped confirmation, token scopes, dtctl safety level, audit events | A user who approves a malicious command |
| T5 | Agent weakens its own policy or grants itself permissions | Policy in the system prompt from a root-owned file; managed settings are the only source of permission rules (`allowManagedPermissionRulesOnly`); edits to `~/.claude/**` and `/opt/rocky/**` denied | — |
| T6 | Agent exfiltrates the platform token or the Claude credential | Token not in any process environment; `~/.config/dtctl/**`, `~/.claude/.credentials.json` and `/proc/**` reads denied; `env`/`printenv` denied; credentials scrubbed from command environments (PID namespace on Linux); outputs redacted before saving | Same Unix user: an approved arbitrary command could read the files |
| T7 | Agent approves its own tool calls | The MCP helper's loopback endpoint only creates requests; answers need the authenticated public API; the runtime password is in no process environment | Same Unix user: an approved command could read a run file (it only allows asking) |
| T8 | Secrets end up in saved conversations | Redaction (tokens, keys, auth headers, cookies, URL credentials, JWTs, private keys, sensitive assignments), reasoning removed, preview before save | Unknown secret formats; review the preview |
| T9 | User reads or deletes another user's saved sessions | Owner path from `/platform/metadata/v1/user`; IDs validated; IAM path restriction | IAM cannot isolate per user; direct DQL access remains possible for users with broad `storage:files:read` |
| T10 | Saved snapshot tampered or replaced | `overwrite: false`; SHA-256 stored and verified on read | A user with `storage:files:write` outside the app can delete files |
| T11 | Stored password redirected to an attacker host | URL/username changes require re-entering the secret (`forceSecretResubmission`); functions refuse redirects | — |
| T12 | Supply-chain compromise of tools or skills | Digest-pinned base image; Claude Code verified against Anthropic's signed release manifest plus pinned digests; dtctl and draw.io pinned with checksums; skills by commit SHA; actions by SHA; Grype scan, SBOM, signed releases; auto-updates disabled | Compromise of an upstream at the pinned version |
| T13 | Container escape or privilege escalation | Non-root UID 10001, read-only root filesystem, all capabilities dropped, no-new-privileges, seccomp RuntimeDefault, Restricted Pod Security | Kernel vulnerabilities |
| T14 | Browser-side XSS through agent output | React escaping, Strato `Markdown` rendering, ESLint `no-unsanitized`/SDL rules, no `dangerouslySetInnerHTML` | Vulnerabilities in rendering libraries |
| T15 | A personal Claude subscription is used by other people | Documentation and the app state it; teams use API keys or cloud providers | Not technically enforceable |

## 6. Session lifecycle

| Stage | Data | Location |
|---|---|---|
| Create | Title, optional overlay | Runtime home (`~/.rocky/sessions`) |
| Run | Messages, tool calls, files | Runtime home (session file, Claude Code transcript) and workspace |
| Save | Redacted Markdown + metadata | Grail Resource Store (immutable snapshot + index) |
| Rename (saved) | Display title | Index resource only |
| Delete (ephemeral) | Session file and Claude Code transcript | Removed from the runtime |
| Delete (saved) | Snapshot + index | Removed permanently after typed confirmation |
| Runtime home removed | All ephemeral sessions, overlays and the Claude login | Lost |

## 7. Data retention

* Ephemeral data lives as long as the runtime home (a volume in Docker Compose,
  ephemeral in the cloud templates) and the workspace volume.
* Saved sessions stay until deleted; Grail Resource Store retention and your backup policy apply.
* Audit events go to stdout (collected by the container platform) and to `/tmp/rocky/audit.jsonl` (ephemeral).
* The app stores only non-secret connection metadata plus the secret password property.

## 8. Audit model

| Event | Source | Fields (no secrets) |
|---|---|---|
| `permission.requested` / `approved` / `rejected` / `timeout` / `cancelled` | Gateway | permission request ID, session ID, run ID, tool, permission type, redacted patterns |
| `session.created` / `session.prompt` / `session.run.finished` / `session.deleted` | Gateway | session ID, run ID, prompt length, exit code, aborted, duration |
| `policy.overlay.updated` | Gateway | session ID, overlay length |
| `request` | Gateway | method, route name, status, duration (no bodies, no query) |
| `rocky.session.saved` / `renamed` / `deleted` | App Function | saved ID, SHA-256, size |

Ingest container logs into Dynatrace (log ingestion or the cloud integration)
to keep a central audit trail.

## 9. Container hardening checklist

- [x] Base image pinned by digest; minimal Debian slim
- [x] Runs as UID 10001; `/opt/rocky` and `/etc/claude-code` read-only for that user
- [x] Works with a read-only root filesystem (tmpfs for `/tmp`; home as tmpfs or volume)
- [x] `cap_drop: ALL`, `no-new-privileges`, seccomp RuntimeDefault in the templates
- [x] tini as PID 1; the container exits if the gateway exits
- [x] No secrets in build arguments, image layers or image environment (CI checks)
- [x] Claude Code auto-updates disabled; OpenCode not installed (CI check)
- [x] Health check without credentials
- [x] Unauthenticated liveness endpoint returns only `ok`

## 10. Dependency scanning, SBOM and signing

* **CI:** gitleaks (history), `npm audit --omit=dev --audit-level=high`,
  hadolint, ShellCheck, Grype (critical, fixed vulnerabilities fail the build),
  Syft SPDX SBOM, Terraform/CloudFormation/Bicep/Kubernetes validation.
* **Release:** BuildKit SBOM and max-mode provenance attestations, keyless
  Sigstore signature of the image digest (Docker Hub and GHCR), SPDX SBOM
  attached to the release.
* **Verify an image:**

  ```bash
  cosign verify docker.io/edunzz/rocky-agent@sha256:<digest> \
    --certificate-identity-regexp 'https://github.com/Edunzz/dynatrace_apps_rocky_agent/.github/workflows/release.yml@.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```
