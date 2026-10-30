// Gateway configuration, read once from the environment.
// Secret values are kept in this object only; they are never logged.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PASSWORD = "edunzzxgundam79";
const HERE = dirname(fileURLToPath(import.meta.url));

// Tools that make no sense behind a web UI (scheduling, worktrees, push
// notifications, interactive questions) are removed from every run.
export const DEFAULT_DISALLOWED_TOOLS = [
  "AskUserQuestion",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "PushNotification",
  "EnterWorktree",
  "ExitWorktree",
];

export const MODEL_PATTERN = /^[A-Za-z0-9._:@/[\]-]{1,200}$/;

function intFromEnv(env, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

export function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const parseAllowedOrigins = parseList;

export function loadConfig(env = process.env, secrets = {}) {
  const password = secrets.password ?? env.ROCKY_SERVER_PASSWORD ?? "";
  if (!password) {
    throw new Error("ROCKY_SERVER_PASSWORD is required");
  }
  const model = env.ROCKY_MODEL || "";
  if (model && !MODEL_PATTERN.test(model)) throw new Error("ROCKY_MODEL has an invalid format");
  const home = env.HOME || "/home/rocky";
  const permissionTimeoutMs = intFromEnv(env, "ROCKY_PERMISSION_TIMEOUT_MS", 15 * 60_000, { min: 10_000 });
  return {
    listenHost: env.ROCKY_GATEWAY_HOST || "0.0.0.0",
    listenPort: intFromEnv(env, "ROCKY_PORT", 4096, { min: 0, max: 65535 }),
    username: env.ROCKY_SERVER_USERNAME || "rocky",
    password,
    usesDefaultPassword: password === DEFAULT_PASSWORD,
    nodeEnv: env.NODE_ENV || "production",
    logLevel: (env.LOG_LEVEL || "info").toLowerCase(),
    allowedOrigins: parseList(env.ALLOWED_ORIGINS),
    maxBodyBytes: intFromEnv(env, "ROCKY_MAX_BODY_BYTES", 1024 * 1024),
    stateDir: env.ROCKY_STATE_DIR || "/tmp/rocky",
    dataDir: env.ROCKY_DATA_DIR || join(home, ".rocky"),
    policyFile: env.ROCKY_POLICY_FILE || "/opt/rocky/policy/AGENTS.md",
    skillsManifestFile: env.ROCKY_SKILLS_MANIFEST || "/opt/rocky/skills-manifest.json",
    validateDynatraceScript: env.ROCKY_VALIDATE_DYNATRACE_SCRIPT || "/opt/rocky/scripts/validate-dynatrace.sh",
    workspacePath: env.WORKSPACE_PATH || "/workspace",
    runtimeVersion: env.ROCKY_VERSION || "0.0.0-dev",
    dynatraceUrl: env.DT_PLATFORM_URL || "",
    claude: {
      bin: env.ROCKY_CLAUDE_BIN || "claude",
      binArgs: [], // tests run a script through node
      // Source of the variables passed through to Claude Code (runner.mjs PASS_ENV).
      sourceEnv: env,
      configDir: env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
      model,
      maxConcurrentRuns: intFromEnv(env, "ROCKY_MAX_CONCURRENT_RUNS", 4, { max: 32 }),
      runTimeoutMs: intFromEnv(env, "ROCKY_RUN_TIMEOUT_MS", 60 * 60_000, { min: 10_000 }),
      permissionTimeoutMs,
      subprocessEnvScrub: boolFromEnv(env, "ROCKY_SUBPROCESS_ENV_SCRUB", true),
      disallowedTools: env.ROCKY_DISALLOWED_TOOLS === undefined ? DEFAULT_DISALLOWED_TOOLS : parseList(env.ROCKY_DISALLOWED_TOOLS),
      permissionHelper: env.ROCKY_PERMISSION_HELPER || join(HERE, "mcp-permission.mjs"),
      nodeBin: process.execPath,
    },
  };
}

export { DEFAULT_PASSWORD };
