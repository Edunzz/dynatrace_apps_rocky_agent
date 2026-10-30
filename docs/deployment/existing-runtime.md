# Connect an existing runtime

Use this when a Rocky Agent runtime is already running.

## Requirements

| Item | Requirement |
|---|---|
| Version | Rocky Agent runtime 0.2 or later (Claude Code). Runtimes 0.1.x (OpenCode) use a different API and username |
| Endpoint | HTTPS URL of the Rocky gateway |
| Credentials | Username (default `rocky`) and `ROCKY_SERVER_PASSWORD` |
| Claude | Signed in on the runtime; the connection test shows it |

## Steps

1. Allow the host in **Settings → General → External requests**, or route it
   through EdgeConnect.
2. In the app, open **Connect your Rocky Agent runtime** → **Existing runtime**.
3. Enter the URL (for example `https://rocky-agent.company.internal`), the
   username and the password, and choose how the password is stored.
4. Run **Test connection**. The test checks URL syntax and HTTPS, reachability,
   authentication, the Claude Code version, the Claude sign-in and the
   required API capabilities.
5. Save the connection.

## Cleanup

Delete the connection in the app. The runtime and saved sessions are not affected.
