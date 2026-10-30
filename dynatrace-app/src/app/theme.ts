import Colors from "@dynatrace/strato-design-tokens/colors";
import type { ComponentState } from "../models/runtime";

// Every color is a Strato design token (a CSS custom property), so the app
// follows the user's light or dark Dynatrace theme without any code of its own.
export const Ui = {
  text: Colors.Text.Neutral.Default,
  muted: Colors.Text.Neutral.Subdued,
  primary: Colors.Text.Primary.Default,
  success: Colors.Text.Success.Default,
  warning: Colors.Text.Warning.Default,
  critical: Colors.Text.Critical.Default,
  mono: "var(--dt-typography-code-base-default-family, 'Roboto Mono', monospace)",
} as const;

export type Tone = "ok" | "info" | "warn" | "critical" | "neutral";

// Lamp colors: the accent tokens stay vivid on both themes.
export const toneColor: Record<Tone, string> = {
  ok: Colors.Background.Container.Success.Accent,
  info: Colors.Background.Container.Primary.Accent,
  warn: Colors.Background.Container.Warning.Accent,
  critical: Colors.Background.Container.Critical.Accent,
  neutral: Colors.Border.Neutral.Accent,
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
