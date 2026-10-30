# Deploy from GitHub Codespaces

The repository includes a dev container ([`.devcontainer/`](../../.devcontainer/))
that deploys the Rocky Agent app to your Dynatrace environment and can start
the runtime inside the codespace. Nothing has to be installed on your computer.

## What the codespace does

1. Starts from a pinned Node.js 24 image with Docker-in-Docker and the GitHub CLI.
2. Installs the app dependencies (`postCreateCommand`).
3. Runs [`.devcontainer/setup.sh`](../../.devcontainer/setup.sh), which:
   * asks for missing parameters (or uses Codespaces secrets);
   * deploys the app with `dt-app deploy`, authenticated by `DT_APP_PLATFORM_TOKEN`
     (no browser login);
   * optionally writes `.env` (mode 0600, git-ignored), builds the runtime
     image and starts it with Docker Compose;
   * prints the app URL, the runtime URL and the next steps.

Secret values are never printed. A generated runtime password stays in `.env`.

## Parameters

| Name | Required | Purpose |
|---|---|---|
| `DT_ENVIRONMENT_URL` | yes | `https://<environment-id>.apps.dynatrace.com` |
| `DT_APP_PLATFORM_TOKEN` | to deploy the app | Platform token with `app-engine:apps:install`, `app-engine:apps:run` ([details](../dynatrace-setup.md#2-app-deployment-token-dt_app_platform_token)) |
| `DT_PLATFORM_TOKEN` | to start the runtime | Runtime token ([scopes](../dynatrace-setup.md#1-runtime-platform-token-dt_platform_token)) |
| `OPENCODE_SERVER_PASSWORD` | no | 16+ characters; generated when empty |
| `OPENCODE_MODEL` | no | `provider/model`; empty uses OpenCode's default (Zen free models) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY` | no | Key for the provider in `OPENCODE_MODEL` |
| `ROCKY_START_RUNTIME` | no | `true`/`false`; by default the runtime starts when `DT_PLATFORM_TOKEN` is set |
| `ROCKY_PUBLIC_PORT` | no | `true` makes port 4096 public (asked interactively otherwise) |

## Option A: enter the parameters when you create the codespace

1. On the repository page: **Code → Codespaces → … → New with options**.
2. Fill in the parameters offered as *recommended secrets* and create the codespace.
3. Setup runs automatically at the end of the creation; its output is in the
   creation log (**Codespaces: View creation log**).

To skip typing them every time, store them as Codespaces secrets for this
repository (**Settings → Secrets and variables → Codespaces**).

## Option B: answer the prompts in the terminal

Create the codespace normally, open a terminal and run:

```bash
bash .devcontainer/setup.sh
```

It asks only for the values that are missing. Run it again any time to
redeploy the app or restart the runtime.

## Using the runtime that runs in the codespace

* **With the installed app:** make port 4096 **Public** (the setup can do it,
  or use **Ports → right-click 4096 → Port Visibility → Public**), allow the host
  `<codespace-name>-4096.app.github.dev` in **Settings → General → External
  requests**, and connect to `https://<codespace-name>-4096.app.github.dev`.
  A public port is reachable by anyone who knows the URL; the gateway still
  requires the password. Use it only for demos.
* **With `dt-app dev`:** run the app in the codespace and connect to
  `http://localhost:4096`. The browser sign-in of `dt-app dev` needs a local
  redirect, so this works best with VS Code Desktop connected to the codespace.

## Cleanup

```bash
docker compose down -v                    # stop the runtime
(cd dynatrace-app && npx dt-app uninstall) # remove the app from your environment
```

Then stop or delete the codespace. Codespaces compute and storage are billed
to your GitHub account.

## Verification status

The setup script is tested in dry-run mode (deploy, runtime start, URL
building, input validation, no secrets in the output). A full run in a real
codespace against a real environment has not been performed yet.
