import type { CliOptions } from "dt-app";

// The environment URL is only used by `dt-app dev` and `dt-app deploy`.
// Set DT_APP_ENVIRONMENT_URL locally or in CI; never commit a tenant URL.
const environmentUrl = process.env.DT_APP_ENVIRONMENT_URL ?? "https://abc12345.apps.dynatrace.com/";

const config: CliOptions = {
  environmentUrl,
  build: {
    sourceRoot: "src",
  },
  app: {
    id: "my.rocky.agent",
    name: "Rocky Agent",
    version: "0.2.0",
    description: "Run Dynatrace investigations with your own Rocky Agent (Claude Code) runtime.",
    scopes: [
      {
        name: "app-settings:objects:read",
        comment: "Read the current user's runtime connections (owner-only settings objects).",
      },
      {
        name: "app-settings:objects:write",
        comment: "Create, update and delete the current user's runtime connections.",
      },
      {
        name: "environment-api:credentials:read",
        comment: "Optional: read a runtime password from the Credential Vault inside the app's backend function.",
      },
      {
        name: "storage:files:read",
        comment: "List and read saved Rocky Agent sessions under /lookups/rocky-agent/ (restrict with IAM).",
      },
      {
        name: "storage:files:write",
        comment: "Save conversation snapshots and title metadata under /lookups/rocky-agent/ (restrict with IAM).",
      },
      {
        name: "storage:files:delete",
        comment: "Permanently delete saved Rocky Agent sessions under /lookups/rocky-agent/ (restrict with IAM).",
      },
      {
        name: "state:user-app-states:read",
        comment: "Read the user's optional default policy overlay.",
      },
      {
        name: "state:user-app-states:write",
        comment: "Store the user's optional default policy overlay when they choose to save it.",
      },
    ],
  },
};

export default config;
