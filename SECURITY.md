# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting for this repository
(**Security → Report a vulnerability**). Include the affected component
(`agent-runtime`, `dynatrace-app` or `deploy`), the version or commit, steps to
reproduce and the impact you expect. You will receive an acknowledgement within
five business days.

Never include real tokens, passwords, tenant URLs or customer data in a report.
Redact them or use placeholders.

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Security model in one page

| Area | Control |
|---|---|
| Secrets | Injected at deploy time only (Docker secrets, AWS Secrets Manager, Azure Key Vault, Kubernetes Secrets). Never baked into images, build arguments, Git, app settings in plaintext or Grail Resource Store. |
| Runtime access | HTTPS at the ingress, HTTP basic auth at the Rocky gateway, constant-time comparison, failure rate limiting. |
| Attack surface | The gateway serves only the Rocky API (`/rocky/v1`); Claude Code never listens on a port. Permission requests from Claude Code reach the gateway on loopback with a per-run secret and can only ask, never approve. |
| Agent behavior | Protected baseline `AGENTS.md` (root-owned, in the system prompt) and Claude Code managed settings in `/etc/claude-code` (the only source of permission rules and hooks); workspace settings, hooks and MCP servers are ignored; destructive or outward-facing actions need a scoped confirmation; permanent approvals are refused. |
| Dynatrace token | Only inside the runtime, in a 0600 dtctl config file; unset from the environment before agent processes start; never sent to the browser. |
| Persistence | Only user-approved, redacted conversation snapshots are written to Grail Resource Store. |
| Supply chain | Base image pinned by digest, tools pinned by version and checksum, skills pinned by commit SHA, GitHub Actions pinned by SHA, SBOM and vulnerability scan in CI, keyless image signing on release. |

The full threat model, trust boundaries and residual risks are documented in
[docs/security/threat-model.md](docs/security/threat-model.md).
