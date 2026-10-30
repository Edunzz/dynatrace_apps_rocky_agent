import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../src/gateway/audit.mjs";
import { basicAuthHeader } from "../src/gateway/auth.mjs";
import { loadConfig } from "../src/gateway/config.mjs";
import { createRuntime } from "../src/gateway/server.mjs";

export const USER = "rocky";
export const PASSWORD = "test-password-0123456789";
export const FAKE_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude.mjs");

export function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Starts the Rocky runtime with fake-claude.mjs in place of the `claude` CLI.
export async function startRuntime({ env = {}, config: overrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rocky-gw-"));
  const dirs = Object.fromEntries(["state", "data", "claude", "workspace"].map((name) => [name, join(root, name)]));
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  for (const skill of ["dt-dql-essentials", "drawio"]) {
    mkdirSync(join(dirs.claude, "skills", skill), { recursive: true });
    writeFileSync(join(dirs.claude, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: test\n---\n`);
  }
  const policyFile = join(root, "AGENTS.md");
  writeFileSync(policyFile, "# Baseline\nNever print secrets.\n");
  const manifestFile = join(root, "skills-manifest.json");
  writeFileSync(
    manifestFile,
    JSON.stringify({ official: { skills: ["dt-dql-essentials", "dt-obs-logs"] }, custom: [], drawio: { name: "drawio" } }),
  );
  const config = loadConfig({
    ROCKY_SERVER_PASSWORD: PASSWORD,
    ROCKY_PORT: "0",
    HOME: root,
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    NODE_ENV: "production",
    LOG_LEVEL: "error",
    ALLOWED_ORIGINS: "https://abc12345.apps.dynatrace.com",
    DT_PLATFORM_URL: "https://abc12345.apps.dynatrace.com",
    ROCKY_STATE_DIR: dirs.state,
    ROCKY_DATA_DIR: dirs.data,
    CLAUDE_CONFIG_DIR: dirs.claude,
    WORKSPACE_PATH: dirs.workspace,
    ROCKY_POLICY_FILE: policyFile,
    ROCKY_SKILLS_MANIFEST: manifestFile,
    ROCKY_PERMISSION_TIMEOUT_MS: "10000",
    ROCKY_VERSION: "test",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-fake-test-token",
    ...env,
  });
  config.claude.bin = process.execPath;
  config.claude.binArgs = [FAKE_CLAUDE];
  Object.assign(config, overrides);
  const auditLines = [];
  const runtime = await createRuntime({
    config,
    logger: createLogger("error", () => {}),
    audit: async (type, fields) => auditLines.push({ type, ...fields }),
    runValidation: (cb) => cb(),
  });
  const port = await listen(runtime.server);
  const base = `http://127.0.0.1:${port}`;
  const auth = basicAuthHeader(USER, PASSWORD);
  const request = async (method, path, { body, headers = {}, authenticated = true } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(authenticated ? { authorization: auth } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  };
  return {
    request,
    runtime,
    config,
    dirs,
    auditLines,
    async stop() {
      await runtime.close();
    },
  };
}
