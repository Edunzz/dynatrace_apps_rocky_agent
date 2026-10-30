// Client-side copy of the gateway's overlay check
// (agent-runtime/src/optional-gateway/policy.mjs) for instant feedback.
// The gateway remains the enforcement point.

export const MAX_OVERLAY_CHARS = 20_000;

const WEAKENING_PATTERNS: { pattern: RegExp; reason: string }[] = [
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

export interface OverlayFinding {
  line: number;
  text: string;
  reason: string;
}

export function findWeakeningStatements(overlay: string): OverlayFinding[] {
  const findings: OverlayFinding[] = [];
  overlay.split(/\r?\n/).forEach((line, index) => {
    for (const { pattern, reason } of WEAKENING_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ line: index + 1, text: line.trim().slice(0, 200), reason });
        break;
      }
    }
  });
  return findings;
}
