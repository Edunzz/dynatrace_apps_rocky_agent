// Extended runtime status for the Rocky UI. Never includes secret values or
// environment variable contents.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, statfs } from "node:fs/promises";
import { join } from "node:path";
import { buildEnv } from "./runner.mjs";

export const STATUS_SCHEMA_VERSION = 2;
export const LOGIN_COMMAND = "docker compose run --rm rocky-agent login";
const AUTH_CACHE_MS = 60_000;

async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// Skill folders (with a SKILL.md) installed in CLAUDE_CONFIG_DIR/skills.
export async function installedSkills(configDir) {
  const dir = join(configDir, "skills");
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const checks = await Promise.all(
    names.map(async (name) => {
      try {
        await access(join(dir, name, "SKILL.md"), constants.R_OK);
        return name;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter(Boolean).sort();
}

export function summarizeSkills(installed, manifest) {
  if (!Array.isArray(installed)) {
    return { status: "unknown", count: 0, official: 0, custom: [], drawio: false, missing: [], items: [] };
  }
  const names = new Set(installed);
  const official = manifest?.official?.skills ?? [];
  const custom = (manifest?.custom ?? []).map((c) => c.name);
  const drawio = manifest?.drawio?.name ? [manifest.drawio.name] : [];
  const expected = [...official, ...custom, ...drawio];
  const missing = expected.filter((name) => !names.has(name));
  let status = "installed";
  if (expected.length === 0) status = installed.length > 0 ? "installed" : "missing";
  else if (missing.length === expected.length) status = "missing";
  else if (missing.length > 0) status = "partial";
  return {
    status,
    count: installed.length,
    official: official.filter((name) => names.has(name)).length,
    custom: custom.filter((name) => names.has(name)),
    drawio: drawio.length > 0 && names.has(drawio[0]),
    missing,
    items: installed.map((name) => ({ name, source: expected.includes(name) ? "rocky" : "user" })),
  };
}

async function workspaceStatus(path) {
  try {
    await access(path, constants.W_OK);
  } catch {
    try {
      await access(path, constants.R_OK);
      return { status: "read_only", path };
    } catch {
      return { status: "missing", path };
    }
  }
  try {
    const fs = await statfs(path);
    return { status: "ready", path, freeBytes: Number(fs.bavail) * Number(fs.bsize) };
  } catch {
    return { status: "ready", path };
  }
}

function run(execFileFn, bin, args, env) {
  return new Promise((resolve) => {
    execFileFn(bin, args, { env, timeout: 15_000, windowsHide: true }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? "") });
    });
  });
}

// Claude Code version and sign-in state. `claude auth status` prints JSON and
// exits 1 when no credential is configured; whether a configured credential
// actually works is learned from the runs (authentication_failed events).
export function createClaudeProbe({ config, execFileFn = execFile, now = () => Date.now() }) {
  let version;
  let auth = null;
  let authCheckedAt = 0;
  let lastFailure = 0;
  let lastSuccess = 0;

  async function getVersion() {
    if (version !== undefined) return version;
    const { code, stdout } = await run(execFileFn, config.claude.bin, [...config.claude.binArgs, "--version"], buildEnv(config));
    version = code === 0 ? (/(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null) : null;
    return version;
  }

  async function getAuth(force = false) {
    if (!force && auth && now() - authCheckedAt < AUTH_CACHE_MS) return auth;
    const { stdout } = await run(execFileFn, config.claude.bin, [...config.claude.binArgs, "auth", "status"], buildEnv(config));
    try {
      const parsed = JSON.parse(stdout);
      auth = {
        loggedIn: parsed.loggedIn === true,
        authMethod: typeof parsed.authMethod === "string" ? parsed.authMethod : "none",
        apiProvider: typeof parsed.apiProvider === "string" ? parsed.apiProvider : null,
      };
    } catch {
      auth = { loggedIn: false, authMethod: "unknown", apiProvider: null, error: true };
    }
    authCheckedAt = now();
    return auth;
  }

  return {
    getVersion,
    async collect(force = false) {
      const [v, a] = await Promise.all([getVersion(), getAuth(force)]);
      let status = "unknown";
      if (v === null) status = "unavailable";
      else if (a.error) status = "unknown";
      else if (!a.loggedIn) status = "authentication_required";
      else if (lastFailure > lastSuccess) status = "authentication_failed";
      else status = "connected";
      return { version: v, auth: a, status };
    },
    reportAuth(state) {
      if (state === "failed") {
        lastFailure = now();
        authCheckedAt = 0;
      } else lastSuccess = now();
    },
  };
}

export async function collectStatus({ config, probe, baselineSha256, startedAt, activeRuns, force = false }) {
  const warnings = [];
  if (config.usesDefaultPassword) {
    warnings.push("The public default password is in use. Change ROCKY_SERVER_PASSWORD (16+ characters) and update the app connection.");
  }

  const [claude, dynatrace, manifest, installed, workspace] = await Promise.all([
    probe.collect(force),
    readJsonFile(join(config.stateDir, "dynatrace-status.json")),
    readJsonFile(config.skillsManifestFile),
    installedSkills(config.claude.configDir),
    workspaceStatus(config.workspacePath),
  ]);
  if (claude.status === "authentication_required") {
    warnings.push(`Claude is not signed in. Run "${LOGIN_COMMAND}" or set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.`);
  } else if (claude.status === "authentication_failed") {
    warnings.push(`Claude rejected the configured credential. Sign in again with "${LOGIN_COMMAND}" or replace the token.`);
  }

  const dtStatus = dynatrace?.status ?? "unknown";
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
    runtime: {
      status: "connected",
      version: config.runtimeVersion,
      nodeEnv: config.nodeEnv,
      gateway: "enabled",
      defaultPassword: config.usesDefaultPassword,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      activeRuns,
    },
    agent: {
      status: claude.version ? "ready" : "unavailable",
      name: "Claude Code",
      version: claude.version,
    },
    claude: {
      status: claude.status,
      authMethod: claude.auth.authMethod,
      apiProvider: claude.auth.apiProvider,
      model: config.claude.model || null,
      loginCommand: LOGIN_COMMAND,
    },
    dynatrace: {
      status: dtStatus,
      environmentHost: dynatrace?.environmentHost ?? hostOf(config.dynatraceUrl),
      checkedAt: dynatrace?.checkedAt ?? null,
      detail: typeof dynatrace?.detail === "string" ? dynatrace.detail.slice(0, 300) : null,
    },
    dtctl: {
      status: dynatrace?.dtctlInstalled ? "ready" : dynatrace ? "missing" : "unknown",
      version: dynatrace?.dtctlVersion ?? null,
      safetyLevel: dynatrace?.safetyLevel ?? null,
    },
    skills: summarizeSkills(installed, manifest),
    workspace,
    policy: { baselineSha256 },
    warnings,
  };
}
