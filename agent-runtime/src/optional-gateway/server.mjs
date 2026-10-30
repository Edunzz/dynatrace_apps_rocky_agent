// Rocky gateway: authenticated, allowlisted reverse proxy in front of
// `opencode serve`, plus the extended status and policy endpoints.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createAuditor, createLogger } from "./audit.mjs";
import { basicAuthHeader, FailureLimiter, isAuthorized } from "./auth.mjs";
import { loadConfig } from "./config.mjs";
import { composeSystem, loadBaseline, MAX_OVERLAY_CHARS, PolicyStore } from "./policy.mjs";
import { consoleSanitizer, filterQuery, hardDenyReason, isSafePath, matchRoute } from "./routes.mjs";
import { GatewayError, SANITIZERS } from "./sanitize.mjs";
import { collectStatus } from "./status.mjs";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "set-cookie",
  "www-authenticate",
]);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
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

function clientKey(req) {
  return req.socket.remoteAddress ?? "unknown";
}

export function createGateway({
  config,
  logger = createLogger(config.logLevel),
  audit = createAuditor({ stateDir: config.stateDir }),
  baseline = loadBaseline(config.policyFile),
  policyStore = new PolicyStore(),
  limiter = new FailureLimiter(),
  skillsManifestFile = process.env.ROCKY_SKILLS_MANIFEST || "/opt/rocky/skills-manifest.json",
  runValidation = (cb) => execFile(config.validateDynatraceScript, [], { timeout: 60_000 }, cb),
} = {}) {
  const startedAt = Date.now();
  const upstreamAuth = basicAuthHeader(
    config.upstreamUsername ?? config.username,
    config.upstreamPassword ?? config.password,
  );
  let lastRefresh = 0;

  function upstreamRequest(method, path, { headers = {}, body } = {}) {
    return http.request({
      host: config.upstreamHost,
      port: config.upstreamPort,
      method,
      path,
      timeout: config.upstreamTimeoutMs,
      headers: {
        accept: "application/json",
        "user-agent": "rocky-gateway",
        ...headers,
        authorization: upstreamAuth,
        ...(body !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
    });
  }

  function upstreamJson(method, path, payload) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = upstreamRequest(method, path, { body });
      req.on("timeout", () => req.destroy(new GatewayError(504, "upstream_timeout", "OpenCode did not respond in time")));
      req.on("error", reject);
      req.on("response", (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.end(body);
    });
  }

  function proxy(req, res, { path, body, requestId, passThroughBody = false }) {
    const forwardHeaders = {
      accept: req.headers.accept ?? "application/json",
      "x-request-id": requestId,
    };
    const upstream = upstreamRequest(req.method, path, { headers: forwardHeaders, body });
    upstream.on("timeout", () => upstream.destroy(new GatewayError(504, "upstream_timeout", "OpenCode did not respond in time")));
    upstream.on("error", (error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const gatewayError =
        error instanceof GatewayError ? error : new GatewayError(502, "upstream_unavailable", "OpenCode is not reachable");
      sendError(res, gatewayError, requestId);
    });
    upstream.on("response", (upstreamRes) => {
      const headers = { ...SECURITY_HEADERS };
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
      }
      if (config.consoleEnabled && upstreamRes.headers["content-security-policy"]) {
        headers["content-security-policy"] = upstreamRes.headers["content-security-policy"];
      }
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      upstreamRes.pipe(res);
    });
    if (body !== undefined) upstream.end(body);
    else if (passThroughBody) req.pipe(upstream);
    else upstream.end();
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!config.allowedOrigins.includes(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-credentials", "true");
    return true;
  }

  async function handleNative(route, params, req, res, requestId) {
    switch (route.name) {
      case "rocky.livez": {
        const health = await upstreamJson("GET", "/global/health").catch(() => null);
        const ok = health?.status === 200 && health.body?.healthy === true;
        return sendJson(res, ok ? 200 : 503, { status: ok ? "ok" : "unavailable" });
      }
      case "rocky.status": {
        const status = await collectStatus({
          config,
          upstreamJson,
          baselineSha256: baseline.sha256,
          startedAt,
          skillsManifestFile,
        });
        return sendJson(res, 200, status);
      }
      case "rocky.status.refresh": {
        if (Date.now() - lastRefresh < 60_000) {
          return sendJson(res, 429, { error: "refresh_throttled", message: "Status was refreshed less than 60 seconds ago", requestId });
        }
        lastRefresh = Date.now();
        await new Promise((resolve) => runValidation(() => resolve()));
        return sendJson(res, 202, { status: "refreshed" });
      }
      case "rocky.policy":
        return sendJson(res, 200, {
          baseline: baseline.text,
          baselineSha256: baseline.sha256,
          overlayMaxChars: MAX_OVERLAY_CHARS,
          protectedRules: ["secret-protection", "explicit-confirmation", "destructive-action-restrictions", "audit"],
        });
      case "rocky.session.policy.get": {
        const entry = policyStore.get(params[0]);
        return sendJson(res, 200, { sessionID: params[0], overlay: entry?.overlay ?? "", updatedAt: entry?.updatedAt ?? null });
      }
      case "rocky.session.policy.put": {
        const body = await readJsonBody(req, config.maxBodyBytes);
        if (!body || typeof body !== "object") throw new GatewayError(400, "invalid_body", "Body must be {\"overlay\": string}");
        const entry = policyStore.set(params[0], body.overlay);
        await audit("policy.overlay.updated", { sessionID: params[0], overlayChars: entry?.overlay.length ?? 0, requestId });
        return sendJson(res, 200, { sessionID: params[0], overlay: entry?.overlay ?? "", updatedAt: entry?.updatedAt ?? null });
      }
      default:
        throw new GatewayError(404, "route_not_allowed", "Route is not available");
    }
  }

  async function prepareBody(sanitizerName, req, sessionId) {
    const parsed = await readJsonBody(req, config.maxBodyBytes);
    const sanitizer = SANITIZERS[sanitizerName];
    if (sanitizerName === "prompt") {
      return JSON.stringify(sanitizer(parsed, { system: composeSystem(policyStore.get(sessionId)?.overlay) }));
    }
    return JSON.stringify(sanitizer(parsed));
  }

  async function auditPermissionReply(requestIdOfPermission, reply, requestId) {
    const pending = await upstreamJson("GET", "/permission").catch(() => null);
    const match = Array.isArray(pending?.body) ? pending.body.find((p) => p.id === requestIdOfPermission) : null;
    return {
      permissionRequestID: requestIdOfPermission,
      sessionID: match?.sessionID ?? null,
      permission: match?.permission ?? null,
      patterns: Array.isArray(match?.patterns) ? match.patterns.slice(0, 20) : [],
      reply,
      requestId,
    };
  }

  async function handle(req, res) {
    const requestId = randomUUID();
    const started = Date.now();
    let routeName = "unmatched";
    res.on("finish", () => {
      logger.info("request", {
        requestId,
        method: req.method,
        route: routeName,
        status: res.statusCode,
        durationMs: Date.now() - started,
      });
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
        return await handleNative(matched.route, matched.params, req, res, requestId);
      }

      const key = clientKey(req);
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

      if (matched) {
        const { route, params } = matched;
        routeName = route.name;
        if (route.native) return await handleNative(route, params, req, res, requestId);

        const path = url.pathname + filterQuery(url.searchParams, route.query);
        let body;
        if (route.sanitize) body = await prepareBody(route.sanitize, req, params[0]);

        if (route.name === "permission.reply") {
          const reply = JSON.parse(body);
          const event = await auditPermissionReply(params[0], reply.reply, requestId);
          const result = await upstreamJson("POST", path, reply);
          const type =
            result.status !== 200 ? "permission.reply.failed" : reply.reply === "once" ? "permission.approved" : "permission.rejected";
          await audit(type, { ...event, upstreamStatus: result.status });
          return sendJson(res, result.status ?? 502, result.body);
        }
        if (route.name === "session.delete") policyStore.delete(params[0]);
        return proxy(req, res, { path, body, requestId });
      }

      const denied = hardDenyReason(req.method, url.pathname);
      if (denied) {
        routeName = "hard-deny";
        throw new GatewayError(403, "route_blocked", `Blocked by the Rocky gateway: ${denied}`);
      }
      if (config.consoleEnabled) {
        routeName = "console";
        const sanitizer = consoleSanitizer(req.method, url.pathname);
        const sessionId = /^\/session\/([^/]+)/.exec(url.pathname)?.[1];
        const body = sanitizer ? await prepareBody(sanitizer, req, sessionId) : undefined;
        // The console runs inside the workspace only: drop directory overrides.
        url.searchParams.delete("directory");
        url.searchParams.delete("workspace");
        const query = url.searchParams.toString();
        return proxy(req, res, {
          path: url.pathname + (query ? `?${query}` : ""),
          body,
          requestId,
          passThroughBody: body === undefined,
        });
      }
      throw new GatewayError(404, "route_not_allowed", "Route is not available through the Rocky gateway");
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
  server.requestTimeout = config.upstreamTimeoutMs + 10_000;
  return server;
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = createGateway({ config, logger });
  server.listen(config.listenPort, config.listenHost, () => {
    logger.info("gateway listening", {
      host: config.listenHost,
      port: config.listenPort,
      upstream: `${config.upstreamHost}:${config.upstreamPort}`,
      consoleEnabled: config.consoleEnabled,
    });
  });
  const shutdown = (signal) => {
    logger.info("gateway stopping", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
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
