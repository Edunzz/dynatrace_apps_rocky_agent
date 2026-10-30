// Platform token guidance shown on the welcome page and mirrored in
// docs/dynatrace-setup.md. Scope lists come from dtctl's TOKEN_SCOPES.md
// (v0.45.0) plus the extra scopes the bundled RCA skill recommends.
//
// The entropy-based secret detector flags URLs and variable names below; this
// file contains scope names and documentation links only, no secret values.
/* eslint-disable noSecrets/no-secrets */

export const PLATFORM_TOKEN_PREFIX = "dt0s16.";
export const PLATFORM_TOKEN_URL = "https://myaccount.dynatrace.com/platformTokens";
export const PLATFORM_TOKEN_DOCS =
  "https://docs.dynatrace.com/docs/manage/identity-access-management/access-tokens-and-oauth-clients/platform-tokens";
export const DTCTL_SCOPES_DOCS = "https://github.com/dynatrace-oss/dtctl/blob/v0.45.0/docs/TOKEN_SCOPES.md";

// dtctl `readonly` safety level.
export const READONLY_SCOPES = [
  "document:documents:read",
  "document:direct-shares:read",
  "document:trash.documents:read",
  "automation:workflows:read",
  "slo:slos:read",
  "slo:objective-templates:read",
  "settings:schemas:read",
  "settings:objects:read",
  "app-settings:objects:read",
  "extensions:definitions:read",
  "extensions:configurations:read",
  "storage:logs:read",
  "storage:events:read",
  "storage:metrics:read",
  "storage:spans:read",
  "storage:bizevents:read",
  "storage:entities:read",
  "storage:smartscape:read",
  "storage:system:read",
  "storage:security.events:read",
  "storage:application.snapshots:read",
  "storage:user.events:read",
  "storage:user.sessions:read",
  "storage:user.replays:read",
  "storage:profiles:read",
  "storage:buckets:read",
  "storage:bucket-definitions:read",
  "storage:fieldsets:read",
  "storage:fieldset-definitions:read",
  "storage:files:read",
  "storage:filter-segments:read",
  "iam:users:read",
  "iam:groups:read",
  "notification:notifications:read",
  "davis:analyzers:read",
  "app-engine:apps:run",
  "app-engine:edge-connects:read",
  "openpipeline:configurations:read",
  "environment-api:dashboard-3rdgen-migration:execute",
] as const;

// dtctl `readwrite-mine` safety level (Rocky's default DTCTL_SAFETY_LEVEL).
export const READWRITE_MINE_SCOPES = [
  "document:documents:read",
  "document:documents:write",
  "document:documents:delete",
  "document:direct-shares:read",
  "document:direct-shares:write",
  "document:direct-shares:delete",
  "document:trash.documents:read",
  "document:trash.documents:restore",
  "automation:workflows:read",
  "automation:workflows:write",
  "automation:workflows:run",
  "document:environment-shares:claim",
  "dev-obs:breakpoints:set",
  "slo:slos:read",
  "slo:slos:write",
  "slo:objective-templates:read",
  "settings:schemas:read",
  "settings:objects:read",
  "settings:objects:write",
  "app-settings:objects:read",
  "extensions:definitions:read",
  "extensions:definitions:write",
  "extensions:configurations:read",
  "extensions:configurations:write",
  "storage:logs:read",
  "storage:events:read",
  "storage:metrics:read",
  "storage:spans:read",
  "storage:bizevents:read",
  "storage:entities:read",
  "storage:smartscape:read",
  "storage:system:read",
  "storage:security.events:read",
  "storage:buckets:read",
  "storage:bucket-definitions:read",
  "storage:files:read",
  "storage:files:write",
  "storage:filter-segments:read",
  "storage:filter-segments:write",
  "iam:users:read",
  "iam:groups:read",
  "notification:notifications:read",
  "davis:analyzers:read",
  "davis:analyzers:execute",
  "davis-copilot:conversations:execute",
  "app-engine:apps:run",
  "app-engine:functions:run",
  "app-engine:edge-connects:read",
  "openpipeline:configurations:read",
  "email:emails:send",
  "environment-api:dashboard-3rdgen-migration:execute",
] as const;

// The RCA skill also recommends these, which dtctl's readwrite-mine list omits.
export const RCA_EXTRA_SCOPES = ["storage:user.events:read", "storage:user.sessions:read"] as const;

export const RECOMMENDED_SCOPES = [...READWRITE_MINE_SCOPES, ...RCA_EXTRA_SCOPES];

// Minimum the RCA skill's prerequisite check requires.
export const RCA_REQUIRED_SCOPES = [
  "storage:buckets:read",
  "storage:events:read",
  "storage:logs:read",
  "storage:metrics:read",
  "storage:spans:read",
  "storage:entities:read",
  "storage:smartscape:read",
  "document:documents:read",
  "document:documents:write",
] as const;

// Small set for getting started: what the RCA skill requires plus what its
// prerequisite check recommends, reading lookup tables, and creating workflows
// and alerts (Davis anomaly detectors are settings objects).
export const STARTER_SCOPES = [
  ...RCA_REQUIRED_SCOPES,
  "storage:bizevents:read",
  "storage:user.events:read",
  "storage:user.sessions:read",
  "storage:system:read",
  "storage:files:read",
  "automation:workflows:read",
  "automation:workflows:write",
  "automation:workflows:run",
  "settings:schemas:read",
  "settings:objects:read",
  "settings:objects:write",
] as const;

// Separate token used only to deploy the app (dt-app deploy, Codespaces).
export const APP_DEPLOY_SCOPES = ["app-engine:apps:install", "app-engine:apps:run", "app-engine:apps:delete"] as const;

export interface TokenProfile {
  id: string;
  title: string;
  safetyLevel: string;
  description: string;
  scopes: readonly string[];
}

export const TOKEN_PROFILES: TokenProfile[] = [
  {
    id: "starter",
    title: "Starter",
    safetyLevel: "readwrite-mine",
    description:
      "Quickest to create: reads logs, metrics, traces, events, entities, business data and lookup tables, and lets the agent create its own notebooks (for example the RCA), workflows and alerts after you confirm.",
    scopes: STARTER_SCOPES,
  },
  {
    id: "recommended",
    title: "Recommended (default)",
    safetyLevel: "readwrite-mine",
    description:
      "Analysis plus creating your own notebooks, dashboards and workflows after you confirm. dtctl only lets the agent change resources owned by the token's user.",
    scopes: RECOMMENDED_SCOPES,
  },
  {
    id: "readonly",
    title: "Read-only",
    safetyLevel: "readonly",
    description:
      "Investigation only. The agent cannot publish anything (the RCA skill cannot publish its notebook). Set DTCTL_SAFETY_LEVEL=readonly too.",
    scopes: READONLY_SCOPES,
  },
];
