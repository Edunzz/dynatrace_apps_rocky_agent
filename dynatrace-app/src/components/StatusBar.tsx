import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import { RefreshIcon } from "@dynatrace/strato-icons";
import React from "react";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { Console, stateLabel, stateTone } from "../app/theme";
import type { RuntimeStatus } from "../models/runtime";
import { errorMessage, RockyError } from "../services/functions";
import { StatusLight } from "./StatusLight";

const AUTH_METHODS: Record<string, string> = {
  "claude.ai": "Claude subscription",
  oauth_token: "Subscription token",
  api_key: "API key",
  api_key_helper: "API key helper",
  third_party: "Cloud provider",
};

function claudeLight(claude: RuntimeStatus["claude"]) {
  const method = AUTH_METHODS[claude.authMethod] ?? claude.authMethod;
  switch (claude.status) {
    case "connected":
      return { value: "Signed in", tone: "ok" as const, detail: [method, claude.model].filter(Boolean).join(" · ") };
    case "authentication_failed":
      return { value: "Sign-in rejected", tone: "critical" as const, detail: `Sign in again: ${claude.loginCommand}` };
    case "authentication_required":
      return { value: "Not signed in", tone: "critical" as const, detail: `Run on the runtime host: ${claude.loginCommand}` };
    default:
      return { value: stateLabel(claude.status), tone: stateTone(claude.status), detail: null };
  }
}

// Independent status indicators for every layer: runtime, Claude Code, Claude
// sign-in, Dynatrace, dtctl, skills and the runtime version.
export function StatusBar() {
  const { active, connectionRef, needsPassword } = useConnection();
  const { status } = useRuntimeData();
  const s = status.data;
  const error = status.error;
  const authFailed = error instanceof RockyError && error.code === "authentication_failed";
  const reachable = Boolean(s) && !error;

  let runtimeValue = "Not connected";
  let runtimeTone: "ok" | "warn" | "critical" | "neutral" = "neutral";
  if (active && needsPassword) {
    runtimeValue = "Password required";
    runtimeTone = "warn";
  } else if (connectionRef && error) {
    runtimeValue = authFailed ? "Authentication failed" : "Unavailable";
    runtimeTone = "critical";
  } else if (connectionRef && s) {
    runtimeValue = "Connected";
    runtimeTone = "ok";
  } else if (connectionRef) {
    runtimeValue = "Connecting…";
  }

  const lights = reachable && s
    ? [
        { label: "Claude Code", value: s.agent.status === "ready" ? "Ready" : "Unavailable", tone: stateTone(s.agent.status), detail: s.agent.version ? `Claude Code ${s.agent.version}` : null },
        { label: "Claude", ...claudeLight(s.claude) },
        { label: "Dynatrace", value: stateLabel(s.dynatrace.status), tone: stateTone(s.dynatrace.status), detail: s.dynatrace.detail ?? s.dynatrace.environmentHost },
        { label: "dtctl", value: s.dtctl.status === "ready" ? "Ready" : "Missing", tone: stateTone(s.dtctl.status), detail: s.dtctl.version ? `dtctl ${s.dtctl.version} · ${s.dtctl.safetyLevel ?? ""}` : null },
        { label: "Skills", value: `${s.skills.count} installed`, tone: stateTone(s.skills.status), detail: s.skills.missing.length ? `Missing: ${s.skills.missing.join(", ")}` : null },
      ]
    : [];

  return (
    <header
      aria-label="Runtime status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        background: Console.background,
        borderBottom: `1px solid ${Console.border}`,
      }}
    >
      <Text style={{ color: Console.green, fontFamily: Console.mono, fontWeight: 700, letterSpacing: 1, marginRight: 8 }}>
        ROCKY://AGENT
      </Text>
      <StatusLight label="Runtime" value={runtimeValue} tone={runtimeTone} detail={error ? errorMessage(error) : active?.displayName} />
      {lights.map((light) => (
        <StatusLight key={light.label} {...light} />
      ))}
      {reachable && s && (
        <Text style={{ color: Console.muted, fontFamily: Console.mono, fontSize: 12, marginLeft: "auto" }}>
          runtime v{s.runtime.version}
        </Text>
      )}
      {connectionRef && (
        <Button
          size="condensed"
          aria-label="Refresh runtime status"
          onClick={() => status.refresh()}
          style={{ marginLeft: reachable ? 0 : "auto" }}
        >
          <Button.Prefix>
            <RefreshIcon />
          </Button.Prefix>
          Refresh
        </Button>
      )}
    </header>
  );
}
