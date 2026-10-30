#!/usr/bin/env node
// Builds the inline OpenCode configuration (OPENCODE_CONFIG_CONTENT).
//
// Inline configuration has the highest precedence in OpenCode, so the
// protected `permission` and `instructions` from the baseline cannot be
// overridden by a project opencode.json written inside the workspace.
//
//   node compose-opencode-config.mjs <baseline.json> [extra.json]
//
// Environment: OPENCODE_MODEL, OPENCODE_PROVIDER, ROCKY_POLICY_FILE.
// The optional extra file may add providers, MCP servers or model settings;
// any attempt to change protected keys is dropped with a warning.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXTRA_ALLOWED_KEYS = [
  "provider",
  "model",
  "small_model",
  "enabled_providers",
  "disabled_providers",
  "mcp",
  "formatter",
  "lsp",
  "compaction",
  "tool_output",
  "agent",
];

function stripAgentPermissions(agents, warnings) {
  const out = {};
  for (const [name, config] of Object.entries(agents ?? {})) {
    if (!config || typeof config !== "object") continue;
    const { permission, tools, ...rest } = config;
    if (permission !== undefined || tools !== undefined) {
      warnings.push(`agent "${name}": permission/tools overrides are not allowed and were removed`);
    }
    out[name] = rest;
  }
  return out;
}

export function resolveModel(model, provider) {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return provider ? `${provider}/${model}` : model;
}

export function composeConfig(baseline, extra, env) {
  const warnings = [];
  const config = structuredClone(baseline);
  delete config.$schema;
  if (env.ROCKY_POLICY_FILE) config.instructions = [env.ROCKY_POLICY_FILE];

  if (extra && typeof extra === "object") {
    for (const [key, value] of Object.entries(extra)) {
      if (key === "$schema") continue;
      if (!EXTRA_ALLOWED_KEYS.includes(key)) {
        warnings.push(`extra configuration key "${key}" is not allowed and was ignored`);
        continue;
      }
      config[key] = key === "agent" ? stripAgentPermissions(value, warnings) : value;
    }
  }

  const model = resolveModel(env.OPENCODE_MODEL, env.OPENCODE_PROVIDER);
  if (model) config.model = model;
  if (env.OPENCODE_SMALL_MODEL) config.small_model = resolveModel(env.OPENCODE_SMALL_MODEL, env.OPENCODE_PROVIDER);

  // Re-assert the protected keys last.
  config.permission = structuredClone(baseline.permission);
  config.instructions = env.ROCKY_POLICY_FILE ? [env.ROCKY_POLICY_FILE] : structuredClone(baseline.instructions);
  config.autoupdate = false;
  config.share = "disabled";
  return { config, warnings };
}

function main(argv) {
  const [baselineFile, extraFile] = argv;
  if (!baselineFile) {
    process.stderr.write("usage: compose-opencode-config.mjs <baseline.json> [extra.json]\n");
    return 2;
  }
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const extra = extraFile ? JSON.parse(readFileSync(extraFile, "utf8")) : null;
  const { config, warnings } = composeConfig(baseline, extra, process.env);
  for (const warning of warnings) process.stderr.write(`compose-opencode-config: warning: ${warning}\n`);
  process.stdout.write(JSON.stringify(config));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`compose-opencode-config: ${error.message}\n`);
    process.exit(1);
  }
}
