# Install the app from GitHub Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Edunzz/dynatrace_apps_rocky_agent)

The repository includes a dev container ([`.devcontainer/`](../../.devcontainer/))
with everything needed to build and deploy the Rocky Agent **app** to your
Dynatrace environment. Nothing has to be installed on your computer. The
**runtime** runs elsewhere: on your computer ([local.md](local.md)) or on a
server or cloud service.

## What the codespace does

1. Starts from a pinned Node.js 24 image
   (`mcr.microsoft.com/devcontainers/javascript-node`) with the Dynatrace Apps
   VS Code extension.
2. Installs the app dependencies (`postCreateCommand`).
3. Each time you open it, shows where the app will be deployed and whether the
   token is set ([`welcome.sh`](../../.devcontainer/welcome.sh)). The token
   value is never printed.

Deploying is one command, [`npm run deploy:token`](../../dynatrace-app/scripts/deploy.sh),
which runs `dt-app deploy` authenticated by the platform token (no browser
sign-in).

## Parameters

Codespaces asks for these *recommended secrets* on the creation page:

| Secret | Value |
|---|---|
| `DT_APP_ENVIRONMENT_URL` | `https://<environment-id>.apps.dynatrace.com` (platform URL, not `*.live.dynatrace.com`) |
| `DT_APP_PLATFORM_TOKEN` | Platform token with `app-engine:apps:install`, `app-engine:apps:run`, `app-engine:apps:delete` ([details](../dynatrace-setup.md#2-app-deployment-token-dt_app_platform_token)) |

Codespaces saves them as your **personal** Codespaces secrets
(**github.com → Settings → Codespaces**) and offers them again next time. Other
Edunzz Dynatrace apps that use the same two names reuse them; to deploy one of
them to the same environment, select that repository for the secrets in the
same settings page.

## Steps

1. Click the **Open in GitHub Codespaces** badge.
2. Fill in the two secrets and select **Create codespace**.
3. When the terminal shows *Rocky Agent app — ready to deploy*, run:

   ```bash
   npm run deploy:token
   ```

   It asks for the environment URL and the token, showing the current ones;
   press **Enter** to keep them, or type others to deploy to a different
   environment without changing your secrets. Changing the URL also asks for a
   new token (a token belongs to its environment).
4. It prints the app link:
   `https://<environment-id>.apps.dynatrace.com/ui/apps/my.rocky.agent`.

Run the same command again to redeploy after an update. You can stop or delete
the codespace afterwards; the app stays installed.

## The same script outside Codespaces

`npm run deploy:token` also works on Linux, macOS or Git Bash on Windows with
Node.js 20+. The values come from the environment or from
`dynatrace-app/.env` (copy [`dynatrace-app/.env.example`](../../dynatrace-app/.env.example)).
In CI, `--yes` skips the questions. Other arguments are passed to
`dt-app deploy`.

## Cleanup

```bash
(cd dynatrace-app && npx dt-app uninstall)   # remove the app from your environment
```

Then stop or delete the codespace. Codespaces compute and storage are billed
to your GitHub account (personal accounts include a free monthly quota).

## Verification status

`deploy.sh` and the dev container configuration are covered by tests in
dry-run mode (deploy command, app link, input validation, no token in the
output). A deployment from a real codespace to a real environment has not
been performed yet.
