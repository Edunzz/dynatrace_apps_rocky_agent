// Rocky gateway: the authenticated Rocky runtime API in front of Claude Code.
// It stores sessions, runs Claude Code for each prompt (runner.mjs) and
// brokers tool approvals between Claude Code and the app.
//
// Two listeners:
//   * public (ROCKY_PORT, default 4096): the app's API, basic auth;
//   * loopback (127.0.0.1, random port): permission requests from the
//     mcp-permission.mjs helper, authenticated by a per-run secret.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createAuditor, createLogger } from "./audit.mjs";
import { FailureLimiter, isAuthorized, safeEqual } from "./auth.mjs";
import { loadConfig } from "./config.mjs";
import { describePermission, PermissionRegistry } from "./permissions.mjs";
import { loadBaseline, MAX_OVERLAY_CHARS, normalizeOverlay } from "./policy.mjs";
import { intParam, isSafePath, matchRoute } from "./routes.mjs";
import { ClaudeRunner } from "./runner.mjs";
import { GatewayError, sanitizePermissionReply, sanitizePrompt, sanitizeSessionCreate, sanitizeSessionUpdate } from "./sanitize.mjs";
import { publicSession, SessionStore } from "./sessions.mjs";
import { collectStatus, createClaudeProbe, installedSkills } from "./status.mjs";

// Headers added by reverse proxies and tunnels (cloudflared, ALB, ingress).
const PROXY_HEADERS = ["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip"];

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, error, requestId) {
  const status = error instanceof GatewayError ? error.status : 500;
  const code = error instanceof GatewayError ? error.code : "internal_error";
  const message = error instanceof GatewayError ? error.message : "Unexpected gateway error";
  const body = { error: code, message, requestId };
  if (error?.details) body.details = error.details;
  sendJson(res, status, body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new GatewayError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  if (raw.length === 0) return undefined;
  const type = String(req.headers["content-type"] ?? "");
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new GatewayError(415, "unsupported_media_type", "Request body must be application/json");
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new GatewayError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

const AUDIT_TYPES = {
  approved: "permission.approved",
  rejected: "permission.rejected",
  timeout: "permission.timeout",
  cancelled: "permission.cancelled",
};

function permissionAudit(entry) {
  const view = describePermission(entry.toolName, entry.input);
  return {
    permissionRequestID: entry.id,
    sessionID: entry.sessionId,
    runId: entry.runId,
    tool: entry.toolName,
    permission: view.permission,
    patterns: view.patterns.slice(0, 5),
  };
}

// Loopback endpoint used only by mcp-permission.mjs. The request stays open
// until the user answers; if Claude Code goes away first, it is withdrawn.
function createInternalServer({ runner, permissions }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/internal/v1/permissions") throw new GatewayError(404, "not_found", "Not found");
      const body = await readJsonBody(req, 256 * 1024);
      const run = typeof body?.runId === "string" ? runner.findRun(body.runId) : null;
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (!run || !safeEqual(token, run.secret)) throw new GatewayError(401, "unauthorized", "Unknown run");
      const toolUseId = typeof body.toolUseId === "string" ? body.toolUseId : null;
      const { id, decision } = permissions.request({
        sessionId: run.sessionId,
        runId: run.id,
        toolName: String(body.toolName ?? "unknown"),
        input: body.input,
        toolUseId,
        messageId: toolUseId ? (run.translator.calls.get(toolUseId)?.messageId ?? null) : null,
      });
      res.on("close", () => {
        if (!res.writableFinished && id) permissions.settle(id, { behavior: "deny", message: "The request was withdrawn." }, "cancelled");
      });
      sendJson(res, 200, await decision);
    } catch (error) {
      if (!res.headersSent) sendError(res, error, null);
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  return server;
}

export async function createRuntime({
  config,
  logger = createLogger(config.logLevel),
  audit = createAuditor({ stateDir: config.stateDir }),
  baseline = loadBaseline(config.policyFile),
  probe = createClaudeProbe({ config }),
  limiter = new FailureLimiter(),
  spawnFn,
  runValidation = (cb) => execFile(config.validateDynatraceScript, [], { timeout: 60_000 }, cb),
} = {}) {
  const startedAt = Date.now();
  const store = new SessionStore({ dir: join(config.dataDir, "sessions"), claudeConfigDir: config.claude.configDir, logger });
  await store.load();
  const permissions = new PermissionRegistry({
    timeoutMs: config.claude.permissionTimeoutMs,
    onRequested: (entry) => void audit("permission.requested", permissionAudit(entry)),
    onSettled: (entry, _decision, reason) => void audit(AUDIT_TYPES[reason] ?? "permission.settled", permissionAudit(entry)),
  });
  const runner = new ClaudeRunner({
    config,
    store,
    permissions,
    logger,
    audit,
    onAuthState: (state) => probe.reportAuth(state),
    ...(spawnFn ? { spawnFn } : {}),
  });
  const internal = createInternalServer({ runner, permissions });
  const internalPort = await listen(internal, 0, "127.0.0.1");
  runner.internalUrl = `http://127.0.0.1:${internalPort}`;
  let lastRefresh = 0;

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!config.allowedOrigins.includes(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-credentials", "true");
    return true;
  }

  function sessionView(session) {
    return { ...publicSession(session), status: runner.status(session.id) };
  }

  async function dispatch(name, params, url, req, res, requestId) {
    const sessionId = params[0];
    switch (name) {
      case "livez":
        return sendJson(res, 200, { status: "ok" });
      case "health":
        return sendJson(res, 200, {
          healthy: true,
          version: config.runtimeVersion,
          agent: { name: "Claude Code", version: await probe.getVersion() },
        });
      case "status":
        return sendJson(
          res,
          200,
          await collectStatus({ config, probe, baselineSha256: baseline.sha256, startedAt, activeRuns: runner.activeCount }),
        );
      case "status.refresh": {
        if (Date.now() - lastRefresh < 60_000) {
          return sendJson(res, 429, { error: "refresh_throttled", message: "Status was refreshed less than 60 seconds ago", requestId });
        }
        lastRefresh = Date.now();
        await Promise.all([new Promise((resolve) => runValidation(() => resolve())), probe.collect(true)]);
        return sendJson(res, 202, { status: "refreshed" });
      }
      case "policy":
        return sendJson(res, 200, {
          baseline: baseline.text,
          baselineSha256: baseline.sha256,
          overlayMaxChars: MAX_OVERLAY_CHARS,
          protectedRules: ["secret-protection", "explicit-confirmation", "destructive-action-restrictions", "audit"],
        });
      case "skills":
        return sendJson(res, 200, ((await installedSkills(config.claude.configDir)) ?? []).map((skill) => ({ name: skill })));
      case "session.list":
        return sendJson(res, 200, store.list(intParam(url.searchParams, "limit", 100, 500)));
      case "session.create": {
        const body = sanitizeSessionCreate(await readJsonBody(req, config.maxBodyBytes));
        const session = store.create(body);
        await audit("session.created", { sessionID: session.id, requestId });
        return sendJson(res, 200, sessionView(session));
      }
      case "session.status":
        return sendJson(res, 200, runner.statusMap());
      case "session.get":
        return sendJson(res, 200, sessionView(store.get(sessionId)));
      case "session.update": {
        const body = sanitizeSessionUpdate(await readJsonBody(req, config.maxBodyBytes));
        return sendJson(res, 200, sessionView(store.rename(sessionId, body.title)));
      }
      case "session.delete": {
        store.get(sessionId);
        if (runner.status(sessionId).type !== "idle") {
          throw new GatewayError(409, "session_busy", "Stop the agent before deleting this session.");
        }
        await store.delete(sessionId);
        await audit("session.deleted", { sessionID: sessionId, requestId });
        return sendJson(res, 200, true);
      }
      case "session.messages": {
        const messages = store.get(sessionId).messages;
        return sendJson(res, 200, messages.slice(-intParam(url.searchParams, "limit", messages.length || 1, 5000)));
      }
      case "session.snapshot": {
        const session = store.get(sessionId);
        const limit = intParam(url.searchParams, "limit", session.messages.length || 1, 5000);
        return sendJson(res, 200, {
          messages: session.messages.slice(-limit),
          status: { [sessionId]: runner.status(sessionId) },
          permissions: permissions.list(sessionId),
          children: [],
          todos: session.todos ?? [],
        });
      }
      case "session.prompt": {
        const { text } = sanitizePrompt(await readJsonBody(req, config.maxBodyBytes));
        const session = store.get(sessionId);
        const message = await runner.prompt(session, text, session.policy?.overlay);
        return sendJson(res, 202, { accepted: true, messageID: message.info.id });
      }
      case "session.abort":
        store.get(sessionId);
        return sendJson(res, 200, { aborted: runner.abort(sessionId) });
      case "session.todo":
        return sendJson(res, 200, store.get(sessionId).todos ?? []);
      case "session.artifacts":
        return sendJson(res, 200, store.get(sessionId).artifacts ?? []);
      case "session.policy.get": {
        const policy = store.get(sessionId).policy;
        return sendJson(res, 200, { sessionID: sessionId, overlay: policy?.overlay ?? "", updatedAt: policy?.updatedAt ?? null });
      }
      case "session.policy.put": {
        const body = await readJsonBody(req, config.maxBodyBytes);
        if (!body || typeof body !== "object") throw new GatewayError(400, "invalid_body", 'Body must be {"overlay": string}');
        const session = store.get(sessionId);
        const overlay = normalizeOverlay(body.overlay);
        session.policy = overlay ? { overlay, updatedAt: new Date().toISOString() } : undefined;
        store.save(sessionId);
        await audit("policy.overlay.updated", { sessionID: sessionId, overlayChars: overlay.length, requestId });
        return sendJson(res, 200, { sessionID: sessionId, overlay, updatedAt: session.policy?.updatedAt ?? null });
      }
      case "permission.list":
        return sendJson(res, 200, permissions.list());
      case "permission.reply": {
        const body = sanitizePermissionReply(await readJsonBody(req, config.maxBodyBytes));
        if (!permissions.reply(params[0], body.reply, body.message)) {
          throw new GatewayError(404, "permission_not_found", "This approval request is no longer pending.");
        }
        return sendJson(res, 200, true);
      }
      default:
        throw new GatewayError(404, "route_not_allowed", "Route is not available");
    }
  }

  async function handle(req, res) {
    const requestId = randomUUID();
    const started = Date.now();
    let routeName = "unmatched";
    res.on("finish", () => {
      logger.info("request", { requestId, method: req.method, route: routeName, status: res.statusCode, durationMs: Date.now() - started });
    });

    try {
      const url = new URL(req.url ?? "/", "http://gateway.local");
      if (!isSafePath(url.pathname)) throw new GatewayError(400, "invalid_path", "Path is not allowed");
      if (!applyCors(req, res)) throw new GatewayError(403, "origin_not_allowed", "Origin is not allowed");
      if (req.method === "OPTIONS") {
        res.writeHead(req.headers.origin ? 204 : 405, {
          ...SECURITY_HEADERS,
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-max-age": "600",
        });
        return res.end();
      }

      const matched = matchRoute(req.method, url.pathname);
      if (matched?.route.public) {
        routeName = matched.route.name;
        return await dispatch(matched.route.name, matched.params, url, req, res, requestId);
      }

      const key = req.socket.remoteAddress ?? "unknown";
      if (limiter.isBlocked(key)) throw new GatewayError(429, "too_many_failures", "Too many failed authentication attempts");
      if (!isAuthorized(req.headers.authorization, config)) {
        limiter.recordFailure(key);
        return sendJson(
          res,
          401,
          { error: "unauthorized", message: "Valid credentials are required", requestId },
          { "www-authenticate": 'Basic realm="Rocky Agent", charset="UTF-8"' },
        );
      }
      limiter.recordSuccess(key);

      // The public development password is only acceptable for direct local
      // connections, never through a proxy or tunnel.
      if (config.usesDefaultPassword && PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) {
        throw new GatewayError(
          403,
          "default_password_remote",
          "The development default password is not accepted through a proxy or tunnel. Set ROCKY_SERVER_PASSWORD (16+ characters) and NODE_ENV=production.",
        );
      }

      if (!matched) throw new GatewayError(404, "route_not_allowed", "Route is not available");
      routeName = matched.route.name;
      return await dispatch(matched.route.name, matched.params, url, req, res, requestId);
    } catch (error) {
      if (!(error instanceof GatewayError)) logger.error("request failed", { requestId, error: String(error?.message ?? error) });
      if (!res.headersSent) sendError(res, error, requestId);
      else res.destroy();
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;

  return {
    server,
    internal,
    runner,
    store,
    permissions,
    async close() {
      runner.abortAll();
      await store.flush();
      await Promise.all([server, internal].map((s) => new Promise((resolve) => (s.listening ? s.close(() => resolve()) : resolve()))));
    },
  };
}

// The entrypoint hands the runtime password over in a file that is removed
// right away, so it never appears in this process's environment.
export function readSecrets(file) {
  if (!file) return {};
  const secrets = JSON.parse(readFileSync(file, "utf8"));
  unlinkSync(file);
  return secrets;
}

async function main() {
  const config = loadConfig(process.env, readSecrets(process.env.ROCKY_SECRET_FILE));
  const logger = createLogger(config.logLevel);
  const runtime = await createRuntime({ config, logger });
  await listen(runtime.server, config.listenPort, config.listenHost);
  logger.info("gateway listening", { host: config.listenHost, port: config.listenPort, sessions: runtime.store.sessions.size });
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info("gateway stopping", { signal });
    runtime.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`rocky-gateway: ${error.message}\n`);
    process.exit(1);
  });
}
