# Rocky Agent threat model

## 1. Assets

| Asset | Where it lives |
|---|---|
| Dynatrace platform token | Deployment secret → runtime env at start → dtctl config file (0600). Removed from the environment before OpenCode starts. |
| Runtime password | Deployment secret; app settings `secret` property, Credential Vault, or browser memory |
| Model provider credentials | Deployment secret / task role → OpenCode process environment |
| Tenant data the agent reads | Agent context and workspace (ephemeral) |
| Saved conversations | Grail Resource Store under `/lookups/rocky-agent/` |
| Ability to change Dynatrace | dtctl with the service user's scopes |

## 2. Trust boundaries

```text
 [Browser]──(Dynatrace session)──▶[AppEngine: UI + App Functions]──(HTTPS + basic auth)──▶[Ingress/TLS]──▶[Rocky gateway]
                                          │                                                                   │ loopback, random password
                                          ├──▶ App settings (owner-only)                                       ▼
                                          ├──▶ Credential Vault                                        [OpenCode + agent tools]
                                          └──▶ Grail Resource Store                                     │            │
                                                                                                       ▼            ▼
                                                                                              [Model provider]  [dtctl → Dynatrace]
```

| Boundary | Control |
|---|---|
| Browser → App Functions | Dynatrace authentication; functions run with the user's permissions |
| App Functions → runtime | HTTPS only (HTTP only to localhost in development), publicly trusted certificate, outbound allowlist or EdgeConnect, basic auth, redirects refused, named operations only |
| Ingress → gateway | TLS at ingress; gateway authenticates every request (constant-time compare, failure limiter) |
| Gateway → OpenCode | Loopback only; separate random password per start |
| OpenCode → shell/tools | Permission rules (ask by default, deny for credential paths), protected baseline policy |
| Runtime → Dynatrace | Platform token scopes of a dedicated service user; dtctl safety level |
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
5. The gateway validates the credentials and forwards the allowlisted request
   to OpenCode with its own internal credential.

## 4. Authorization model

* **Who can use a runtime:** whoever knows its password. Connections are
  owner-only settings objects; share a runtime by sharing its password through
  your secret manager, not through the app.
* **What the agent can do in Dynatrace:** exactly the platform token's scopes,
  further limited client-side by `DTCTL_SAFETY_LEVEL` (default `readwrite-mine`).
* **What the agent may do without asking:** read-only commands listed in
  [`opencode.json`](../../agent-runtime/opencode.json). Everything else asks; the
  user approves **once** per operation; permanent approvals are refused.
* **Saved sessions:** owner-scoped paths computed from the platform identity;
  IAM restricts the app to `/lookups/rocky-agent/`.

## 5. Threats and mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Runtime exposed to the Internet is brute-forced | TLS at ingress, IP restrictions, 16+ character password in production, failure limiter (10 failures → 60 s block) | Distributed guessing; use network restrictions |
| T2 | Password holder opens a terminal or changes OpenCode config | Gateway blocks PTY, shell, `PATCH /config`, `/auth`, MCP mutation, upgrade, sharing, `/experimental` | Direct mode (`ROCKY_GATEWAY_ENABLED=false`) removes this control |
| T3 | Client re-roots OpenCode with `directory`/`workspace` parameters | Gateway drops all unlisted query parameters and headers | — |
| T4 | Prompt injection makes the agent change or delete Dynatrace objects | Read-only default, permission prompts, scoped confirmation, token scopes, dtctl safety level, audit events | A user who approves a malicious command |
| T5 | Agent weakens its own policy by writing `opencode.json` or `AGENTS.md` | Baseline injected through `OPENCODE_CONFIG_CONTENT` (highest precedence, verified), root-owned policy file, edit to `opencode.json`/`.opencode/` denied | — |
| T6 | Agent exfiltrates the platform token | Token not in agent environment; config file read denied in permissions; `cat`/`env`/`printenv` of credentials denied; outputs redacted before saving | Same Unix user: an approved arbitrary command could read the file |
| T7 | Agent uses the internal OpenCode API to escalate | Internal API needs a random per-start password; any `curl` needs approval | Same as T6 |
| T8 | Secrets end up in saved conversations | Redaction (tokens, keys, auth headers, cookies, URL credentials, JWTs, private keys, sensitive assignments), reasoning removed, preview before save | Unknown secret formats; review the preview |
| T9 | User reads or deletes another user's saved sessions | Owner path from `/platform/metadata/v1/user`; IDs validated; IAM path restriction | IAM cannot isolate per user; direct DQL access remains possible for users with broad `storage:files:read` |
| T10 | Saved snapshot tampered or replaced | `overwrite: false`; SHA-256 stored and verified on read | A user with `storage:files:write` outside the app can delete files |
| T11 | Stored password redirected to an attacker host | URL/username changes require re-entering the secret (`forceSecretResubmission`); functions refuse redirects | — |
| T12 | Supply-chain compromise of tools or skills | Digest-pinned base image, pinned versions with checksums, skills by commit SHA, actions by SHA, Grype scan, SBOM, signed releases | Compromise of an upstream at the pinned version |
| T13 | Container escape or privilege escalation | Non-root UID 10001, read-only root filesystem, all capabilities dropped, no-new-privileges, seccomp RuntimeDefault, Restricted Pod Security | Kernel vulnerabilities |
| T14 | Browser-side XSS through agent output | React escaping, Strato `Markdown` rendering, ESLint `no-unsanitized`/SDL rules, no `dangerouslySetInnerHTML` | Vulnerabilities in rendering libraries |

## 6. Session lifecycle

| Stage | Data | Location |
|---|---|---|
| Create | Title, optional overlay | OpenCode (runtime), gateway memory |
| Run | Messages, tool calls, files | Runtime home and workspace |
| Save | Redacted Markdown + metadata | Grail Resource Store (immutable snapshot + index) |
| Rename (saved) | Display title | Index resource only |
| Delete (ephemeral) | Session data | Removed from the runtime |
| Delete (saved) | Snapshot + index | Removed permanently after typed confirmation |
| Runtime destroyed | All ephemeral sessions and overlays | Lost |

## 7. Data retention

* Ephemeral data lives as long as the container (and the workspace volume, if persisted).
* Saved sessions stay until deleted; Grail Resource Store retention and your backup policy apply.
* Audit events go to stdout (collected by the container platform) and to `/tmp/rocky/audit.jsonl` (ephemeral).
* The app stores only non-secret connection metadata plus the secret password property.

## 8. Audit model

| Event | Source | Fields (no secrets) |
|---|---|---|
| `permission.approved` / `permission.rejected` / `permission.reply.failed` | Gateway | request ID, session ID, permission type, redacted patterns, reply, upstream status |
| `policy.overlay.updated` | Gateway | session ID, overlay length |
| `request` | Gateway | method, route name, status, duration (no bodies, no query) |
| `rocky.session.saved` / `renamed` / `deleted` | App Function | saved ID, SHA-256, size |

Ingest container logs into Dynatrace (log ingestion or the cloud integration)
to keep a central audit trail.

## 9. Container hardening checklist

- [x] Base image pinned by digest; minimal Debian slim
- [x] Runs as UID 10001; `/opt/rocky` read-only for that user
- [x] Works with a read-only root filesystem (tmpfs for `/tmp` and home)
- [x] `cap_drop: ALL`, `no-new-privileges`, seccomp RuntimeDefault in the templates
- [x] tini as PID 1; the process exits if OpenCode or the gateway exits
- [x] No secrets in build arguments, image layers or image environment (CI checks)
- [x] No Claude Code or other agent runtimes installed (CI check)
- [x] Health check without credentials in process arguments
- [x] Unauthenticated liveness endpoint returns only `ok`/`unavailable`

## 10. Dependency scanning, SBOM and signing

* **CI:** gitleaks (history), `npm audit --omit=dev --audit-level=high`,
  hadolint, ShellCheck, Grype (critical, fixed vulnerabilities fail the build),
  Syft SPDX SBOM, Terraform/CloudFormation/Bicep/Kubernetes validation.
* **Release:** BuildKit SBOM and max-mode provenance attestations, keyless
  Sigstore signature of the image digest, SPDX SBOM attached to the release.
* **Verify an image:**

  ```bash
  cosign verify ghcr.io/edunzz/dynatrace_apps_rocky_agent@sha256:<digest> \
    --certificate-identity-regexp 'https://github.com/Edunzz/dynatrace_apps_rocky_agent/.github/workflows/release.yml@.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```
