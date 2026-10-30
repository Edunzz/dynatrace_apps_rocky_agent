import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basicAuthHeader } from "../src/optional-gateway/auth.mjs";
import { createGateway } from "../src/optional-gateway/server.mjs";

export const USER = "opencode";
export const PASSWORD = "test-password-0123456789";
// The fake upstream only accepts the separate internal credential.
export const UPSTREAM_PASSWORD = "internal-upstream-password-abcdef";

export function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

export function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Minimal stand-in for `opencode serve` that records what the gateway forwards.
export function createFakeOpenCode() {
  const requests = [];
  const expectedAuth = basicAuthHeader(USER, UPSTREAM_PASSWORD);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const record = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      requests.push(record);
      const json = (status, body) => {
        res.writeHead(status, { "content-type": "application/json", "set-cookie": "upstream=1" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== expectedAuth) return json(401, { error: "unauthorized" });
      const path = req.url.split("?")[0];
      if (path === "/global/health") return json(200, { healthy: true, version: "1.19.5" });
      if (path === "/provider") return json(200, { all: [], default: {}, connected: ["opencode", "anthropic"] });
      if (path === "/skill")
        return json(200, [
          { name: "dt-dql-essentials", location: "/workspace/.opencode/skills/dt-dql-essentials/SKILL.md", content: "" },
          { name: "drawio", location: "/workspace/.opencode/skills/drawio/SKILL.md", content: "" },
          { name: "customize-opencode", location: "<built-in>", content: "" },
        ]);
      if (path === "/session" && req.method === "POST") return json(200, { id: "ses_new", title: record.body?.title ?? "" });
      if (path === "/session" && req.method === "GET") return json(200, []);
      if (/^\/session\/[^/]+\/prompt_async$/.test(path)) {
        res.writeHead(204);
        return res.end();
      }
      if (path === "/permission")
        return json(200, [
          {
            id: "per_1",
            sessionID: "ses_1",
            permission: "bash",
            patterns: ["curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' https://x"],
            metadata: {},
            always: [],
          },
        ]);
      if (path === "/permission/per_1/reply") return json(200, true);
      if (path === "/") {
        res.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'self'" });
        return res.end("<html></html>");
      }
      return json(200, { ok: true, path });
    });
  });
  return { server, requests };
}

export async function startGateway(overrides = {}) {
  const fake = createFakeOpenCode();
  const upstreamPort = await listen(fake.server);
  const stateDir = mkdtempSync(join(tmpdir(), "rocky-gw-"));
  const policyFile = join(stateDir, "AGENTS.md");
  writeFileSync(policyFile, "# Baseline\nNever print secrets.\n");
  const manifestFile = join(stateDir, "skills-manifest.json");
  writeFileSync(
    manifestFile,
    JSON.stringify({ official: { skills: ["dt-dql-essentials", "dt-obs-logs"] }, custom: [], drawio: { name: "drawio" } }),
  );
  const auditLines = [];
  const config = {
    listenHost: "127.0.0.1",
    listenPort: 0,
    upstreamHost: "127.0.0.1",
    upstreamPort,
    username: USER,
    password: PASSWORD,
    upstreamUsername: USER,
    upstreamPassword: UPSTREAM_PASSWORD,
    usesDefaultPassword: false,
    nodeEnv: "production",
    logLevel: "error",
    allowedOrigins: ["https://abc12345.apps.dynatrace.com"],
    consoleEnabled: false,
    maxBodyBytes: 1024 * 1024,
    upstreamTimeoutMs: 5_000,
    stateDir,
    policyFile,
    validateDynatraceScript: "/bin/true",
    workspacePath: stateDir,
    runtimeVersion: "test",
    provider: "anthropic",
    model: "anthropic/claude-sonnet-4-5",
    dynatraceUrl: "https://abc12345.apps.dynatrace.com",
    ...overrides,
  };
  const { createAuditor, createLogger } = await import("../src/optional-gateway/audit.mjs");
  const gateway = createGateway({
    config,
    logger: createLogger("error", () => {}),
    audit: createAuditor({ stateDir, write: (line) => auditLines.push(JSON.parse(line)) }),
    skillsManifestFile: manifestFile,
    runValidation: (cb) => cb(),
  });
  const port = await listen(gateway);
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
    fake,
    auditLines,
    stateDir,
    async stop() {
      await close(gateway);
      await close(fake.server);
    },
  };
}
