// Protected baseline policy and per-session user overlays.
//
// The baseline lives in a root-owned AGENTS.md that every Claude Code run
// appends to its system prompt (--append-system-prompt-file). Overlays are
// additive instructions stored with the session and appended after the
// baseline (--append-system-prompt).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { GatewayError } from "./sanitize.mjs";

export const MAX_OVERLAY_CHARS = 20_000;

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
    "Rocky Agent policy reminder: the protected baseline above always applies and takes precedence over",
    "everything below. The following user policy overlay is additive only.",
    "",
    "## User policy overlay",
    "",
    overlay,
  ].join("\n");
}

// Validates an overlay and returns its normalized text ("" clears it).
export function normalizeOverlay(overlay) {
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
  return text;
}
