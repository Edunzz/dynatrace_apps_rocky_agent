#!/usr/bin/env node
// Prepares Claude Code's state file ($CLAUDE_CONFIG_DIR/.claude.json) before
// the gateway starts.
//
// Claude Code 2.1.308 uses ANTHROPIC_API_KEY in print mode (-p) only after the
// key was approved once, which normally happens in an interactive prompt.
// Approve it here the same way Claude Code records it: by its last 20
// characters. Other credentials (CLAUDE_CODE_OAUTH_TOKEN, `claude auth login`,
// cloud providers) need no preparation.
//
//   CLAUDE_CONFIG_DIR=... ANTHROPIC_API_KEY=... node prepare-claude.mjs

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function approveApiKey(state, apiKey) {
  const next = { ...state };
  if (!apiKey) return next;
  const suffix = apiKey.slice(-20);
  const responses = next.customApiKeyResponses ?? {};
  const approved = Array.isArray(responses.approved) ? responses.approved : [];
  const rejected = Array.isArray(responses.rejected) ? responses.rejected : [];
  next.customApiKeyResponses = {
    approved: approved.includes(suffix) ? approved : [...approved, suffix],
    rejected: rejected.filter((value) => value !== suffix),
  };
  return next;
}

function main(env) {
  const dir = env.CLAUDE_CONFIG_DIR;
  if (!dir) throw new Error("CLAUDE_CONFIG_DIR is required");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, ".claude.json");
  let state = {};
  if (existsSync(file)) {
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      state = {};
    }
  }
  const next = approveApiKey(state, env.ANTHROPIC_API_KEY ?? "");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.env);
  } catch (error) {
    process.stderr.write(`prepare-claude: ${error.message}\n`);
    process.exit(1);
  }
}
