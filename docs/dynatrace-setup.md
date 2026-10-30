# Dynatrace setup

## 1. Service user and platform token (runtime)

1. Create a **service user** for the runtime (Account Management → Identity &
   access management → Service users).
2. Bind a policy with only what the agent should be able to do.
3. Create a **platform token** for that service user and store it in your
   secret manager as `DT_PLATFORM_TOKEN`.

Recommended scopes for read-only analysis (the RCA skill checks the first group):

| Purpose | Scopes |
|---|---|
| Grail data | `storage:buckets:read`, `storage:logs:read`, `storage:events:read`, `storage:metrics:read`, `storage:spans:read`, `storage:entities:read`, `storage:smartscape:read`, `storage:bizevents:read`, `storage:user.events:read`, `storage:user.sessions:read`, `storage:system:read` |
| Documents | `document:documents:read` |
| Settings and configuration (read) | `settings:objects:read`, `app-settings:objects:read` |

Optional write scopes, needed only for what you want the agent to create after
confirmation (for example the RCA notebook): `document:documents:write`. Add
others (workflows, settings, OpenPipeline) only deliberately.
`DTCTL_SAFETY_LEVEL=readwrite-mine` (default) lets dtctl modify only resources
the service user owns; `readonly` blocks every change client-side.

The runtime checks the token at startup with `dtctl auth whoami` and a
harmless `data record()` query. Failures start the runtime in degraded mode
("Dynatrace connection: unavailable").

## 2. Outbound connections for App Functions

App Functions can only call allowlisted external hosts. Add the runtime host:

**Settings → General → External requests**
(`builtin:dt-javascript-runtime.allowed-outbound-connections`).

```bash
dtctl get settings --schema "builtin:dt-javascript-runtime.allowed-outbound-connections" -o json
```

The runtime certificate must be publicly trusted; functions cannot trust a
private CA or disable TLS verification.

## 3. Private runtimes: EdgeConnect

For runtimes without a public endpoint, deploy **Dynatrace EdgeConnect** in the
private network and add a host pattern that matches the runtime host (for
example `rocky-agent.company.internal`). App Function requests to that host are
then routed through EdgeConnect.

## 4. App installation and user permissions

```bash
cd dynatrace-app
npm ci
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm run deploy
```

Grant app users a policy such as:

```text
ALLOW app-engine:apps:run WHERE shared:app-id = "my.rocky.agent";
ALLOW app-settings:objects:read, app-settings:objects:write;
ALLOW storage:files:read, storage:files:write, storage:files:delete
  WHERE storage:file-path startsWith "/lookups/rocky-agent/";
ALLOW state:user-app-states:read, state:user-app-states:write;
```

Optional, for Credential Vault passwords: `environment-api:credentials:read`
(users must be allowed to read the credential, and the credential must allow
app access).

## 5. Logs

Ingest the runtime's container logs (stdout JSON) into Dynatrace to keep the
gateway's audit events (`component: rocky-audit`) next to your other telemetry.
