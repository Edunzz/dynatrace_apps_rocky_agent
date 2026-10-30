# Connect an existing runtime

Use this when a Rocky Agent runtime, or a compatible OpenCode server, is
already running.

## Requirements

| Item | Rocky runtime | Plain OpenCode server |
|---|---|---|
| Version | Any Rocky release | OpenCode 1.19+ with `OPENCODE_SERVER_PASSWORD` |
| Endpoint | HTTPS URL of the gateway | HTTPS URL in front of `opencode serve` |
| Status lights, skills inventory | Yes | No (shown as unknown) |
| Policy overlays | Yes | No |
| Blocked terminal/config routes | Yes | **No**: anyone with the password has full control |

## Steps

1. Allow the host in **Settings → General → External requests**, or route it
   through EdgeConnect.
2. In the app, open **Connect your Rocky Agent runtime** → **Existing runtime**.
3. Enter the URL (for example `https://rocky-agent.company.internal`), the
   username and the password, and choose how the password is stored.
4. Run **Test connection**. The test checks URL syntax and HTTPS, reachability,
   authentication, OpenCode health, version compatibility, the Rocky gateway
   and the required API capabilities.
5. Save the connection.

## Cleanup

Delete the connection in the app. The runtime and saved sessions are not affected.
