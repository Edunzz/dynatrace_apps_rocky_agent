# Run everything locally (Docker Compose + `dt-app dev`)

The fastest way to try Rocky Agent: the runtime runs on your computer with
Docker Compose, and the Dynatrace App runs on your computer with `dt-app dev`.

## Why this works (and when it does not)

| Where the app runs | Where its functions run | Can it use `http://localhost:4096`? |
|---|---|---|
| `dt-app dev` on your computer | **Your computer** (local Dynatrace JavaScript runtime) | **Yes** |
| App installed in your Dynatrace environment | Dynatrace AppEngine (cloud) | **No**: `localhost` is the Dynatrace sandbox, not your computer |

`dt-app dev` executes the app functions with the local Dynatrace JavaScript
runtime (`@dynatrace/js-runtime`). Verified: the built `connection-test` and
`runtime-proxy` functions, run in that runtime, passed every connection-test
step against a runtime at `http://localhost:4096` and created a session, sent
a prompt, received the reply and deleted the session.

To use the **installed** app with a runtime on your computer, the runtime needs
a public HTTPS URL that Dynatrace can reach (a tunnel you trust, or Dynatrace
EdgeConnect), plus an entry in **Settings → General → External requests**. For
anything beyond local testing, use [Codespaces](codespaces.md) or a cloud option.

## Prerequisites

* Docker Desktop or Docker Engine with Compose
* Node.js 20+ and Git
* A Dynatrace SaaS environment and a runtime platform token
  ([scopes](../dynatrace-setup.md#1-runtime-platform-token-dt_platform_token))
* A model provider key, or OpenCode Zen free models

## Steps

```bash
git clone https://github.com/Edunzz/dynatrace_apps_rocky_agent.git
cd dynatrace_apps_rocky_agent

# 1. Runtime
cp .env.example .env            # set DT_PLATFORM_URL, DT_PLATFORM_TOKEN and a model provider
docker compose up --build -d    # first build takes several minutes
curl -fsS http://127.0.0.1:4096/rocky/v1/livez   # {"status":"ok"}

# 2. App (opens your browser and asks you to sign in to Dynatrace)
cd dynatrace-app
npm ci
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm start
```

In the app:

1. **Connect your Rocky Agent runtime** → **New runtime connection**.
2. Runtime URL `http://localhost:4096`, username `opencode`, and the password
   from `.env`. With `NODE_ENV=development` and an empty
   `OPENCODE_SERVER_PASSWORD`, the documented development default
   `edunzzxgundam79` is used.
3. **Test connection** → **Save connection** → **Let’s Rock**.

Plain HTTP is accepted only for `localhost`/`127.0.0.1`, and the connection
test reports it as a warning.

## Notes

* In `dt-app dev`, runtime connections are stored in local mock settings
  (`dynatrace-app/settings/local-mock-data/`, git-ignored). Saved sessions use
  the real Grail Resource Store of your environment.
* Port 4096 is published on `127.0.0.1` only. Never publish it beyond localhost.

## Cleanup

```bash
docker compose down -v   # removes the container, the workspace volume and every ephemeral session
```
