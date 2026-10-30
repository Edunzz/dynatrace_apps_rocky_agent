import Colors from "@dynatrace/strato-design-tokens/colors";
import type { ComponentState } from "../models/runtime";

// Console palette for the command surfaces (dark operations-center look).
// Contrast on `surface`: text ≈ 15:1, muted ≈ 7.5:1, accents ≥ 8:1 (WCAG AA+).
export const Console = {
  background: "#07090d",
  surface: "#0d1117",
  surfaceRaised: "#131a23",
  border: "#243142",
  text: "#e6edf3",
  muted: "#9aa7b4",
  green: "#39ff88",
  cyan: "#22d3ee",
  orange: "#ffa53d",
  red: "#ff5c6c",
  mono: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export type Tone = "ok" | "warn" | "critical" | "neutral";

export const toneColor: Record<Tone, string> = {
  ok: Console.green,
  warn: Console.orange,
  critical: Console.red,
  neutral: Console.muted,
};

// Chrome colors follow the user's Dynatrace theme through Strato tokens.
export const Chrome = {
  text: Colors.Text.Neutral.Default,
  border: Colors.Border.Neutral.Default,
  surface: Colors.Background.Surface.Default,
  base: Colors.Background.Base.Default,
};

export function stateTone(state: ComponentState | undefined): Tone {
  switch (state) {
    case "connected":
    case "ready":
    case "installed":
      return "ok";
    case "degraded":
    case "partial":
    case "authentication_required":
    case "read_only":
      return "warn";
    case "unavailable":
    case "authentication_failed":
    case "missing":
      return "critical";
    default:
      return "neutral";
  }
}

const STATE_LABELS: Partial<Record<ComponentState, string>> = {
  connected: "Connected",
  ready: "Ready",
  degraded: "Degraded",
  unavailable: "Unavailable",
  authentication_required: "Authentication required",
  authentication_failed: "Authentication failed",
  not_configured: "Not configured",
  installed: "Installed",
  partial: "Partially installed",
  missing: "Missing",
  read_only: "Read-only",
  unknown: "Unknown",
};

export function stateLabel(state: ComponentState | undefined): string {
  return (state && STATE_LABELS[state]) ?? "Unknown";
}
