# Operations

## Startup sequence

1. `validate-environment.sh`: required variables, URL format, password rules,
   origins, safety level. Any `[FAIL]` stops the container.
2. `configure-dtctl.sh`: writes `~/.config/dtctl/config` (0600) with context `rocky`.
3. `validate-dynatrace.sh`: reachability, `dtctl auth whoami`, harmless
   `data record()` query → `/tmp/rocky/dynatrace-status.json`. Failure means
   **degraded mode**, not a crash.
4. `DT_PLATFORM_TOKEN` is unset; pinned skills are copied to `~/.claude/skills/`.
5. `prepare-claude.mjs` approves `ANTHROPIC_API_KEY` for print mode when it is set;
   the log says whether a Claude credential is configured.
6. The gateway starts on `0.0.0.0:4096` (the password is handed over in a file it
   deletes at once). It runs Claude Code for each prompt; if the gateway exits,
   the container exits so the orchestrator restarts it.

## Troubleshooting

### The container exits immediately

```bash
docker logs rocky-agent | grep -E '^\[(FAIL|WARN)\]'
```

Typical causes: missing `DT_PLATFORM_URL`/`DT_PLATFORM_TOKEN`, the default
password with `NODE_ENV=production`, a password shorter than 16 characters,
`ALLOWED_ORIGINS=*` in production, a classic `*.live.dynatrace.com` URL.

### Dynatrace shows "unavailable" or "authentication failed"

```bash
curl -fsS -u "rocky:$PW" https://<runtime>/rocky/v1/status | jq .dynatrace
curl -fsS -u "rocky:$PW" -X POST https://<runtime>/rocky/v1/status/refresh   # re-check (max once per minute)
```

`unavailable`: network, DNS or TLS from the runtime to Dynatrace.
`authentication_failed`: the token is invalid, expired, revoked or for another environment.

### The agent never answers

* Status bar **Claude: Not signed in** → `docker compose run --rm rocky-agent login`,
  or set `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`.
* **Claude: Sign-in rejected** → the login expired or the key was revoked; sign in again.
* The runtime needs outbound HTTPS to `api.anthropic.com` (or your cloud provider)
  and `claude.ai` for subscription logins.
* `docker compose logs rocky-agent | grep claude` shows Claude Code's errors (redacted).
* An approval nobody answers is denied after `ROCKY_PERMISSION_TIMEOUT_MS` (15 minutes).

### The app cannot reach the runtime

| Error code | Meaning | Fix |
|---|---|---|
| `runtime_unreachable` | No HTTP answer from the function's point of view | Allowlist the host (External requests), use a publicly trusted certificate, use EdgeConnect for private hosts |
| `timeout` | No answer within the connection timeout | Increase the timeout (max 100 s) or check the proxy |
| `authentication_failed` | 401 from the gateway | Re-enter the password |
| `rate_limited` | Too many failed logins from one address | Wait 60 s |
| `capability_missing` | The runtime lacks the Rocky gateway route | Enable the gateway or upgrade the runtime |

### A permission request does not appear

Subagent requests carry the child session ID; the app includes child sessions.
If the session shows *Live updates paused*, select **Resume updates**.

### "Permanent approvals are disabled"

By design: every operation needs its own approval (`once`).

### Saving fails

| Error | Fix |
|---|---|
| `preview_required` / `conversation_changed` | Refresh the preview and save again |
| `conversation_too_large` | The Markdown exceeds 900,000 characters; split the work into several sessions |
| `forbidden` | Grant `storage:files:write` on `/lookups/rocky-agent/` |
| `already_exists` | Retry; each save gets a new ID |

## Upgrade procedure

1. Read the [release notes](release-notes.md).
2. Save ephemeral sessions you want to keep.
3. Roll out the new image (pin the digest) and the new app version.
4. Run the connection test; check the status bar.

Rollback: deploy the previous image digest and app version. Saved sessions use
`schema_version` and stay readable.

## Backup and retention

* **Ephemeral sessions** are not backed up. They disappear when the runtime is
  replaced (workspace files survive only if the workspace volume is persistent).
* **Saved sessions** are Grail Resource Store lookup files under
  `/lookups/rocky-agent/`. List them with:

  ```text
  fetch dt.system.files
  | filter startsWith(name, "/lookups/rocky-agent/")
  | fields name, display_name, size, modified.timestamp
  ```

  Export a snapshot with `load "/lookups/rocky-agent/sessions/<owner>/<id>"`.
* **Audit events** follow your log retention once container logs are ingested.

## Image variants

| Build argument | Default | Effect |
|---|---|---|
| `INSTALL_DRAWIO_DESKTOP` | `true` | Headless draw.io exporter (needed by the RCA skill for PNG) |
| `CLAUDE_CODE_VERSION` | `2.1.308` | Claude Code version (with pinned digests, verified against the signed release manifest) |
| `DTCTL_VERSION` | `0.45.0` | dtctl version (with pinned digests) |
| `DT_SKILLS_REF`, `RCA_SKILLS_REF` | commit SHAs | Skill versions |

Claude Code ships one native binary per platform (`linux-x64`, `linux-arm64`);
the published image covers both.
