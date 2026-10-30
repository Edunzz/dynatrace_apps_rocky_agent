# Dynatrace setup

## 1. Runtime platform token (`DT_PLATFORM_TOKEN`)

The runtime authenticates `dtctl` with a Dynatrace **platform token**. Platform
tokens start with `dt0s16.` (classic API tokens start with `dt0c01.` and do
not work here). The token is sent as `Authorization: Bearer <token>`, stays
inside the runtime container and never reaches the app or the browser.

**Effective access = token scopes ∩ permissions of the token's user.** Create
the token for a **dedicated service user** whose IAM policies allow only what
the agent may do; the scopes then narrow it further.

### Create it

1. Create a service user (Account Management → Identity & access management →
   Service users) and bind its policies. Creating tokens for a service user
   requires the `iam:service-users:use` permission.
2. Open **My platform tokens**: <https://myaccount.dynatrace.com/platformTokens>.
3. Select **Platform token**, enter a name, an expiration date, the account and
   the environment, and choose to generate it **for the service user**.
4. Select the scopes of one profile below (**Starter** is the quickest) and select **Generate**.
5. Copy the token (it is shown only once) into your secret manager as
   `DT_PLATFORM_TOKEN` and set `DTCTL_SAFETY_LEVEL` to the profile's level.

References: [Platform tokens](https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/platform-tokens) ·
[dtctl scopes per safety level](https://github.com/dynatrace-oss/dtctl/blob/v0.45.0/docs/TOKEN_SCOPES.md).
The app shows the same lists, with copy buttons, under **Dynatrace platform token**.

### Starter (getting started, `DTCTL_SAFETY_LEVEL=readwrite-mine`)

The quickest token to create (20 scopes). The agent can:

* **read** logs, metrics, traces, events, entities, business data, user
  sessions and **lookup tables** (`storage:files:read`);
* **create**, after you confirm, its own notebooks (for example the RCA),
  **workflows** (`automation:workflows:*`) and **alerts**: Davis anomaly
  detectors and other settings objects (`settings:objects:write`).

```text
storage:buckets:read
storage:events:read
storage:logs:read
storage:metrics:read
storage:spans:read
storage:entities:read
storage:smartscape:read
document:documents:read
document:documents:write
storage:bizevents:read
storage:user.events:read
storage:user.sessions:read
storage:system:read
storage:files:read
automation:workflows:read
automation:workflows:write
automation:workflows:run
settings:schemas:read
settings:objects:read
settings:objects:write
```

With `DTCTL_SAFETY_LEVEL=readwrite-mine` the agent can only change what the
token's user owns; editing alerts or workflows created by others needs
`readwrite-all`.

### Recommended (full, `DTCTL_SAFETY_LEVEL=readwrite-mine`)

Investigation plus creating your **own** notebooks, dashboards and workflows
after you confirm (for example the RCA notebook). It is dtctl's
`readwrite-mine` list plus `storage:user.events:read` and `storage:user.sessions:read`, which the RCA skill
recommends (53 scopes):

```text
document:documents:read
document:documents:write
document:documents:delete
document:direct-shares:read
document:direct-shares:write
document:direct-shares:delete
document:trash.documents:read
document:trash.documents:restore
automation:workflows:read
automation:workflows:write
automation:workflows:run
document:environment-shares:claim
dev-obs:breakpoints:set
slo:slos:read
slo:slos:write
slo:objective-templates:read
settings:schemas:read
settings:objects:read
settings:objects:write
app-settings:objects:read
extensions:definitions:read
extensions:definitions:write
extensions:configurations:read
extensions:configurations:write
storage:logs:read
storage:events:read
storage:metrics:read
storage:spans:read
storage:bizevents:read
storage:entities:read
storage:smartscape:read
storage:system:read
storage:security.events:read
storage:buckets:read
storage:bucket-definitions:read
storage:files:read
storage:files:write
storage:filter-segments:read
storage:filter-segments:write
iam:users:read
iam:groups:read
notification:notifications:read
davis:analyzers:read
davis:analyzers:execute
davis-copilot:conversations:execute
app-engine:apps:run
app-engine:functions:run
app-engine:edge-connects:read
openpipeline:configurations:read
email:emails:send
environment-api:dashboard-3rdgen-migration:execute
storage:user.events:read
storage:user.sessions:read
```

### Read-only (`DTCTL_SAFETY_LEVEL=readonly`)

Investigation only: the agent cannot publish anything, so the RCA skill can
analyze but cannot publish its notebook. dtctl's `readonly` list (39 scopes):

```text
document:documents:read
document:direct-shares:read
document:trash.documents:read
automation:workflows:read
slo:slos:read
slo:objective-templates:read
settings:schemas:read
settings:objects:read
app-settings:objects:read
extensions:definitions:read
extensions:configurations:read
storage:logs:read
storage:events:read
storage:metrics:read
storage:spans:read
storage:bizevents:read
storage:entities:read
storage:smartscape:read
storage:system:read
storage:security.events:read
storage:application.snapshots:read
storage:user.events:read
storage:user.sessions:read
storage:user.replays:read
storage:profiles:read
storage:buckets:read
storage:bucket-definitions:read
storage:fieldsets:read
storage:fieldset-definitions:read
storage:files:read
storage:filter-segments:read
iam:users:read
iam:groups:read
notification:notifications:read
davis:analyzers:read
app-engine:apps:run
app-engine:edge-connects:read
openpipeline:configurations:read
environment-api:dashboard-3rdgen-migration:execute
```

### Minimum for the RCA skill

The RCA skill's prerequisite check (`check_prereqs.py`, R3) fails without
these 9 scopes; every profile above includes them:

```text
storage:buckets:read
storage:events:read
storage:logs:read
storage:metrics:read
storage:spans:read
storage:entities:read
storage:smartscape:read
document:documents:read
document:documents:write
```

### Startup check

At startup the runtime runs `dtctl auth whoami` and a harmless
`data record()` query. A failure starts the runtime in degraded mode
("Dynatrace connection: unavailable") and the status bar shows the reason.

## 2. App deployment token (`DT_APP_PLATFORM_TOKEN`)

A **separate** platform token used only to deploy the app without a browser
login (`npm run deploy:token`, Codespaces, CI). Scopes:

```text
app-engine:apps:install
app-engine:apps:run
app-engine:apps:delete
```

Its user also needs IAM permission to install apps. Do not reuse the runtime
token. The same token works for other Edunzz Dynatrace apps that use
`npm run deploy:token`.

## 3. Outbound connections for App Functions

App Functions can only call allowlisted external hosts. Add the runtime host:

**Settings → General → External requests**
(`builtin:dt-javascript-runtime.allowed-outbound-connections`).

```bash
dtctl get settings --schema "builtin:dt-javascript-runtime.allowed-outbound-connections" -o json
```

The runtime certificate must be publicly trusted; functions cannot trust a
private CA or disable TLS verification.

## 4. Private runtimes: EdgeConnect

For runtimes without a public endpoint, deploy **Dynatrace EdgeConnect** in the
private network and add a host pattern that matches the runtime host (for
example `rocky-agent.company.internal`). App Function requests to that host are
then routed through EdgeConnect.

## 5. App installation and user permissions

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

## 6. Logs

Ingest the runtime's container logs (stdout JSON) into Dynatrace to keep the
gateway's audit events (`component: rocky-audit`) next to your other telemetry.
