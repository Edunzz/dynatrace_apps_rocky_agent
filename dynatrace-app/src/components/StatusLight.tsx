import { Text } from "@dynatrace/strato-components/typography";
import React from "react";
import { Console, type Tone, toneColor } from "../app/theme";

export interface StatusLightProps {
  label: string;
  value: string;
  tone: Tone;
  detail?: string | null;
}

// A labelled status lamp. Color is never the only signal: the state is
// always written next to the lamp and exposed to assistive technology.
export function StatusLight({ label, value, tone, detail }: StatusLightProps) {
  const color = toneColor[tone];
  return (
    <div
      role="status"
      aria-label={`${label}: ${value}${detail ? `. ${detail}` : ""}`}
      title={detail ?? undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${Console.border}`,
        background: Console.surfaceRaised,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          boxShadow: tone === "neutral" ? "none" : `0 0 6px ${color}, 0 0 12px ${color}66`,
          flex: "0 0 auto",
        }}
      />
      <Text style={{ color: Console.muted, fontFamily: Console.mono, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: Console.text, fontFamily: Console.mono, fontSize: 12, fontWeight: 600 }}>{value}</Text>
    </div>
  );
}
