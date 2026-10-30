// Protected baseline policy and per-session user overlays.
//
// The baseline lives in a root-owned AGENTS.md that OpenCode always loads
// through the `instructions` setting. Overlays are additive instructions kept in
// memory for one runtime session; they are sent as the prompt `system` field
// and disappear when the session is deleted or the container stops.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { GatewayError } from "./sanitize.mjs";

export const MAX_OVERLAY_CHARS = 20_000;
const MAX_SESSIONS = 500;

// Statements that try to weaken protected rules. The baseline would still win,
// but rejecting them keeps the effective policy unambiguous for the user.
const WEAKENING_PATTERNS = [
  {
    pattern:
      /\b(ignore|disregard|override|bypass|disable|skip|remove|drop|relax|waive|suspend)\b[^.\n]{0,80}\b(confirm\w*|baseline|polic\w*|safety|secret\w*|audit\w*|approv\w*|restriction\w*|guardrail\w*|rule\w*)/i,
    reason: "tries to remove or override a protected rule",
  },
  { pattern: /\bwithout\b[^.\n]{0,40}\b(confirm\w*|approv\w*|asking)\b/i, reason: "tries to skip explicit confirmation" },
  { pattern: /\bno need to\b[^.\n]{0,20}\b(ask|confirm\w*)\b/i, reason: "tries to skip explicit confirmation" },
  { pattern: /\bauto[- ]?(approve|confirm|accept)\w*/i, reason: "tries to auto-approve operations" },
  {
    pattern: /\b(print|show|reveal|echo|log|output|display|send|share)\b[^.\n]{0,40}(token|password|secret|api[ _-]?key|credential)/i,
    reason: "tries to expose secrets",
  },
  { pattern: /curl\s+(-[a-zA-Z]*k\b|--insecure)/i, reason: "tries to disable TLS verification" },
];

export function loadBaseline(file) {
  const text = readFileSync(file, "utf8");
  return { text, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

export function findWeakeningStatements(overlay) {
  const findings = [];
  const lines = overlay.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { pattern, reason } of WEAKENING_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ line: index + 1, text: line.trim().slice(0, 200), reason });
        break;
      }
    }
  });
  return findings;
}

export function composeSystem(overlay) {
  if (!overlay) return undefined;
  return [
    "Rocky Agent policy reminder: the protected baseline in /opt/rocky/policy/AGENTS.md always applies and",
    "takes precedence over everything below. The following user policy overlay is additive only.",
    "",
    "## User policy overlay",
    "",
    overlay,
  ].join("\n");
}

export class PolicyStore {
  constructor() {
    this.overlays = new Map();
  }

  get(sessionId) {
    return this.overlays.get(sessionId) ?? null;
  }

  set(sessionId, overlay) {
    if (typeof overlay !== "string") throw new GatewayError(400, "invalid_overlay", "overlay must be a string");
    const text = overlay.replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_OVERLAY_CHARS) {
      throw new GatewayError(413, "overlay_too_large", `overlay must be at most ${MAX_OVERLAY_CHARS} characters`);
    }
    const findings = findWeakeningStatements(text);
    if (findings.length > 0) {
      const error = new GatewayError(
        422,
        "overlay_weakens_baseline",
        "The overlay contains statements that would weaken the protected baseline. Rephrase them as additional restrictions.",
      );
      error.details = findings;
      throw error;
    }
    if (text.length === 0) {
      this.overlays.delete(sessionId);
      return null;
    }
    if (!this.overlays.has(sessionId) && this.overlays.size >= MAX_SESSIONS) {
      this.overlays.delete(this.overlays.keys().next().value);
    }
    const entry = { overlay: text, updatedAt: new Date().toISOString() };
    this.overlays.set(sessionId, entry);
    return entry;
  }

  delete(sessionId) {
    this.overlays.delete(sessionId);
  }
}
