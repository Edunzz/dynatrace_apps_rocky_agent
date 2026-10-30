# Rocky Agent — Dynatrace App

React + TypeScript app built with the Dynatrace App Toolkit (`dt-app` 1.20) and
the Strato design system. It connects to a Rocky Agent runtime, runs agent
sessions and saves selected conversations to Grail Resource Store.

## Architecture

```text
Browser (React, Strato)                         AppEngine (JavaScript runtime)
──────────────────────                          ──────────────────────────────
Connection wizard ── app settings (owner-only, password as `secret`)
Chat / sessions ──── functions.call ──▶ runtime-proxy    ──HTTPS──▶ Rocky gateway ─▶ Claude Code
Connection test ──── functions.call ──▶ connection-test  ──HTTPS──▶ Rocky gateway
Saved sessions ───── functions.call ──▶ session-store    ──▶ Grail Resource Store + DQL
```

* The browser never calls the runtime directly. App CSP has no `connect-src`,
  and the runtime password must stay server-side.
* Functions resolve credentials themselves: an owner-only settings secret
  (plaintext only inside this app's functions), a Credential Vault entry, or a
  password the user typed for this browser session (memory only).
* Functions only accept **named operations** with validated parameters; they
  never forward arbitrary paths. Redirects are refused.
* Chat uses `prompt_async` plus short polling (`sessionSnapshot`: messages,
  status, permissions and child sessions in one call), with paging, merging
  without duplicates, backoff, cancellation and stall detection.

## Layout

| Path | Contents |
|---|---|
| `src/main.tsx`, `src/app/` | Entry point, routes, contexts, theme tokens and `styles.css`, deployment guides |
| `icon.svg` | App icon: the `RockyLogo` component rendered at 128 px (`UPDATE_ICON=1 npx jest tests/ui/logo.test.tsx` regenerates it) |
| `src/pages/` | Welcome (connection), Agent home, Session, Saved session |
| `src/components/` | Status bar and lights, sidebar, prompt cards, timeline, modals |
| `src/hooks/` | Polling hooks and the `SessionPoller` |
| `src/services/` | Clients for app functions, settings and user app state |
| `src/functions/` | Server-side logic used by the functions (testable, injected deps) |
| `src/api/*.function.ts` | App Function entrypoints (`dt-app` discovers them here) |
| `src/models/`, `src/utils/` | Types; URL validation, redaction, CSV, Markdown export, hashing |
| `src/settings/schemas/` | `runtime-connections` settings schema (owner-based access control; `dt-app` deploys it only from here) |
| `tests/` | Unit (Node), UI (jsdom) and live-runtime integration tests |

## Saved sessions

| Resource | Path | Content |
|---|---|---|
| Snapshot (immutable) | `/lookups/rocky-agent/sessions/<owner-id>/<saved-id>` | One CSV row: `session_id`, `owner_id`, `connection_id`, `runtime_id`, `title`, `created_at`, `saved_at`, `model_provider`, `model_id`, `dynatrace_environment`, `content_sha256`, `schema_version`, `markdown_content` |
| Index (rename metadata) | `/lookups/rocky-agent/index/<owner-id>/<saved-id>` | One CSV row: `session_id`, `display_title`, `resource_path`, `created_at`, `saved_at`, `updated_at`, `status` |

* Values are RFC 4180 quoted and parsed with `CSVDQS` (Markdown column:
  `CSVDQS{1,1000000}`), a pattern verified against the Resource Store API.
* Each save creates a new `<saved-id>` (`<runtime-session-id>-<UTC timestamp>`)
  and uploads with `overwrite: false`, so snapshots cannot be replaced.
* Save flow: export → keep user-visible content → drop hidden reasoning →
  truncate long tool payloads → redact secrets → preview → explicit
  confirmation → re-export and compare SHA-256 → upload.
* Renaming rewrites only the index. Deleting requires typing `DELETE` and
  removes both resources.
* The owner ID always comes from `/platform/metadata/v1/user` inside the function.

## Scopes and IAM

The app requests `app-settings:objects:read|write`,
`environment-api:credentials:read`, `storage:files:read|write|delete` and
`state:user-app-states:read|write`. Restrict file access with an IAM policy:

```text
ALLOW storage:files:read, storage:files:write, storage:files:delete
  WHERE storage:file-path startsWith "/lookups/rocky-agent/";
```

IAM conditions cannot reference the calling user, so a user with broad
`storage:files:read` on `/lookups/rocky-agent/` could read other users'
snapshots with DQL outside the app (see the threat model).

## Development

```bash
npm ci
npm run typecheck && npm run lint && npm test
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm start   # dt-app dev
npm run build
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm run deploy
```

Against a local runtime (`docker compose up`), use `http://localhost:4096`
with `dt-app dev`; plain HTTP is accepted only for localhost.

Live-runtime integration tests (runtime with the mock model provider):

```bash
ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npx jest --selectProjects unit tests/integration
```

## Before deploying

1. Allow the runtime host in **Settings → General → External requests**
   (`builtin:dt-javascript-runtime.allowed-outbound-connections`), or route a
   private runtime through EdgeConnect.
2. Grant users the app scopes and the IAM policy above.
3. Run the connection test from the welcome page.
