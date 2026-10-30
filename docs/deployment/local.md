# Run the runtime on your computer (Docker Compose)

The runtime runs on your computer with Docker Compose. There are two ways to
connect the Dynatrace App to it:

| Option | Where the app runs | How it reaches the runtime | Status |
|---|---|---|---|
| **A. Installed app + tunnel** (README *Getting started*) | Installed in your Dynatrace environment | Public HTTPS address from a Cloudflare quick tunnel | Not run end to end yet |
| **B. `dt-app dev`** | On your computer | `http://localhost:4096` | Verified |

## Why the installed app needs a tunnel

| Where the app runs | Where its functions run | Can it use `http://localhost:4096`? |
|---|---|---|
| `dt-app dev` on your computer | **Your computer** (local Dynatrace JavaScript runtime) | **Yes** |
| App installed in your Dynatrace environment | Dynatrace AppEngine (cloud) | **No**: `localhost` is the Dynatrace sandbox, not your computer |

The app talks to the runtime from its App Functions, never from the browser.
An installed app's functions run in Dynatrace, so they need an HTTPS address
that Dynatrace can reach and that is allowed in **Settings → General →
External requests**.

## Prerequisites

* Docker Desktop or Docker Engine with Compose
* Git
* A Dynatrace SaaS environment and a runtime platform token
  ([scopes](../dynatrace-setup.md#1-runtime-platform-token-dt_platform_token))
* A Claude subscription (Pro, Max, Team or Enterprise) or an Anthropic API key
* Option B only: Node.js 20+

## Configure the runtime

```bash
git clone https://github.com/Edunzz/dynatrace_apps_rocky_agent.git
cd dynatrace_apps_rocky_agent
cp .env.example .env          # Windows (PowerShell): copy .env.example .env
```

Fill in `DT_PLATFORM_URL`, `DT_PLATFORM_TOKEN` and `ROCKY_SERVER_PASSWORD`
(16+ characters). With the password empty the runtime uses the public default
`gundamjromero2026`: it works, but change it, because anyone who finds the
address can use your agent; the app warns until you do. Compose runs the
runtime with production rules by default (`NODE_ENV=production`), so it refuses
to start with a password of your own shorter than 16 characters.

Sign in to Claude once, before or after starting the runtime (the login works
while it runs):

```bash
docker compose run --rm rocky-agent login
```

It prints an address; open it, sign in with your Claude account, copy the code
the page shows and paste it into the terminal once (it is not displayed) and
press Enter. The login is stored in the `rocky-home`
volume and survives restarts. Alternatives: `docker compose run --rm
rocky-agent setup-token` and put the token in `CLAUDE_CODE_OAUTH_TOKEN`, or set
`ANTHROPIC_API_KEY`. A subscription is for your own use only.

The image `docker.io/edunzz/rocky-agent` is downloaded from Docker Hub. To build
it from this repository instead, add `-f docker-compose.yml -f
docker-compose.build.yml` and `--build` to the `docker compose` commands below.

## Option A: installed app + tunnel

1. Install the app: [from Codespaces](codespaces.md) or
   `npm run deploy:token` on your computer.
2. Start the runtime and the tunnel:

   ```bash
   docker compose --profile tunnel up -d
   docker compose logs tunnel      # look for https://<random-words>.trycloudflare.com
   ```

   The `tunnel` service ([`cloudflare/cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/),
   pinned by digest) starts only after the runtime is healthy, so a runtime
   that rejected its configuration is never exposed. No Cloudflare account is
   needed.
3. Once per environment: **Settings → General → External requests** → add
   `*.trycloudflare.com` → **Save**.
4. In the app: **New runtime connection** with the `https://….trycloudflare.com`
   address, username `rocky` and your password → **Test connection** →
   **Save connection** → **Let’s Rock**.

**The address changes every time the tunnel restarts.** After
`docker compose --profile tunnel up -d` (or a reboot), read the new address
with `docker compose logs tunnel` and edit the connection in the app.

Security of this option:

* The runtime is reachable from the Internet at a random address. Every
  request needs the runtime password, and the gateway only exposes the routes
  the app uses (no terminal, shell or configuration routes).
* With the public default password anyone who finds the address can use the
  runtime. Change it; the app and the connection test warn until you do.
* Allowing `*.trycloudflare.com` lets every app in the environment call any
  quick-tunnel address. Remove the entry when you stop testing.
* Quick tunnels are meant for testing. For teams use a
  [server](docker.md) or a cloud deployment with your own HTTPS address.

## Option B: run the app locally with `dt-app dev`

No tunnel and no settings change: the app runs on your computer and its
functions call the runtime on `localhost`.

```bash
docker compose up -d           # runtime on http://127.0.0.1:4096 only
curl -fsS http://127.0.0.1:4096/rocky/v1/livez   # {"status":"ok"}

cd dynatrace-app
npm ci
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm start   # opens your browser; sign in to Dynatrace
```

In the app: **New runtime connection** → Runtime URL `http://localhost:4096`,
username `rocky`, your password → **Test connection** → **Save connection**
→ **Let’s Rock**. Plain HTTP is accepted only for `localhost`/`127.0.0.1`, and
the connection test reports it as a warning.

With `ROCKY_SERVER_PASSWORD` empty the runtime uses the public default password
`gundamjromero2026`; change it as soon as you can.

Verified with the runtime 0.1 (OpenCode): the built `connection-test` and
`runtime-proxy` functions, run in the local Dynatrace JavaScript runtime that
`dt-app dev` uses, passed every connection-test step against
`http://localhost:4096`. With the Claude Code runtime (0.2), the app function
handlers were run in Node.js against a local gateway driving the real Claude
Code binary and a mock Anthropic API; `dt-app dev` itself was not started.

Notes:

* In `dt-app dev`, runtime connections are stored in local mock settings
  (`dynatrace-app/settings/local-mock-data/`, git-ignored). Saved sessions use
  the real Grail Resource Store of your environment.
* Port 4096 is published on `127.0.0.1` only. Never publish it beyond localhost.

## Health checks

```bash
docker compose ps                                   # rocky-agent should be "healthy"
curl -fsS http://127.0.0.1:4096/rocky/v1/livez      # {"status":"ok"}
docker compose logs rocky-agent                     # startup checks (dtctl, model provider)
```

## Cleanup

```bash
docker compose --profile tunnel down      # stop; keeps the workspace volume
docker compose --profile tunnel down -v   # also removes the workspace volume and every ephemeral session
```

Remove `*.trycloudflare.com` from **External requests** when you no longer use
the tunnel.

## Verification status

* Option B was verified as described above.
* Option A has not been run end to end yet: the compose configuration and the
  gateway's proxy check are covered by tests, but no real tunnel has been
  started against a real environment.
