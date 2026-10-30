// Structured, secret-free logging and audit events.
//
// Everything goes to stdout as JSON lines so the container platform
// (CloudWatch, Log Analytics, Kubernetes, Dynatrace log ingest) collects it.
// Audit events are also appended to an ephemeral file inside the runtime.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { redactDeep } from "./redact.mjs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info", write = (line) => process.stdout.write(`${line}\n`)) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const log = (lvl, msg, fields = {}) => {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, component: "rocky-gateway", msg, ...redactDeep(fields) }));
  };
  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
  };
}

export function createAuditor({ stateDir, write = (line) => process.stdout.write(`${line}\n`) }) {
  const file = join(stateDir, "audit.jsonl");
  const ready = mkdir(stateDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
  return async function audit(type, fields = {}) {
    const event = { time: new Date().toISOString(), level: "info", component: "rocky-audit", audit: true, type, ...redactDeep(fields) };
    const line = JSON.stringify(event);
    write(line);
    await ready;
    try {
      await appendFile(file, `${line}\n`, { mode: 0o600 });
    } catch {
      // The stdout copy is authoritative; a read-only state dir must not break requests.
    }
    return event;
  };
}
