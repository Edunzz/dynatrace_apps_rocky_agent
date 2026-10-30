// Extended runtime status for the Rocky UI. Never includes secret values or
// environment variable contents.

import { constants } from "node:fs";
import { access, readFile, statfs } from "node:fs/promises";
import { join } from "node:path";

export const STATUS_SCHEMA_VERSION = 1;

async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export function selectedProvider(config) {
  if (config.provider) return config.provider;
  const slash = config.model.indexOf("/");
  return slash > 0 ? config.model.slice(0, slash) : "";
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function summarizeSkills(discovered, manifest) {
  if (!Array.isArray(discovered)) {
    return { status: "unknown", count: 0, official: 0, custom: [], drawio: false, missing: [], items: [] };
  }
  const items = discovered
    .map((skill) => ({
      name: String(skill.name ?? ""),
      source: String(skill.location ?? "").startsWith("<built-in>") ? "built-in" : "project",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Set(items.map((s) => s.name));
  const expected = [
    ...(manifest?.official?.skills ?? []),
    ...(manifest?.custom ?? []).map((c) => c.name),
    ...(manifest?.drawio?.name ? [manifest.drawio.name] : []),
  ];
  const missing = expected.filter((name) => !names.has(name));
  const official = (manifest?.official?.skills ?? []).filter((name) => names.has(name)).length;
  const custom = (manifest?.custom ?? []).map((c) => c.name).filter((name) => names.has(name));
  let status = "installed";
  if (expected.length === 0) status = items.length > 0 ? "installed" : "missing";
  else if (missing.length === expected.length) status = "missing";
  else if (missing.length > 0) status = "partial";
  return {
    status,
    count: items.filter((s) => s.source === "project").length,
    official,
    custom,
    drawio: manifest?.drawio?.name ? names.has(manifest.drawio.name) : false,
    missing,
    items,
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

export async function collectStatus({ config, upstreamJson, baselineSha256, startedAt, skillsManifestFile }) {
  const warnings = [];
  if (config.usesDefaultPassword) {
    warnings.push("The default development password is in use. Set OPENCODE_SERVER_PASSWORD before exposing this runtime.");
  }
  if (config.consoleEnabled) {
    warnings.push("Console mode is enabled: the OpenCode web console is reachable through the gateway.");
  }

  const [health, providers, skills, dynatrace, manifest, workspace] = await Promise.all([
    upstreamJson("GET", "/global/health").catch(() => null),
    upstreamJson("GET", "/provider").catch(() => null),
    upstreamJson("GET", "/skill").catch(() => null),
    readJsonFile(join(config.stateDir, "dynatrace-status.json")),
    readJsonFile(skillsManifestFile),
    workspaceStatus(config.workspacePath),
  ]);

  const opencodeUp = health?.status === 200 && health.body?.healthy === true;
  const provider = selectedProvider(config);
  const connected = Array.isArray(providers?.body?.connected) ? providers.body.connected : [];
  let modelStatus = "unknown";
  if (providers?.status === 200) {
    if (provider) modelStatus = connected.includes(provider) ? "connected" : "authentication_required";
    else modelStatus = connected.length > 0 ? "connected" : "authentication_required";
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
      consoleEnabled: config.consoleEnabled,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    },
    opencode: {
      status: opencodeUp ? "ready" : health ? "degraded" : "unavailable",
      version: health?.body?.version ?? null,
    },
    modelProvider: {
      status: modelStatus,
      provider: provider || null,
      model: config.model || null,
      connectedProviders: connected.filter((id) => typeof id === "string").slice(0, 50),
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
    skills: summarizeSkills(skills?.status === 200 ? skills.body : null, manifest),
    workspace,
    policy: { baselineSha256 },
    warnings,
  };
}
