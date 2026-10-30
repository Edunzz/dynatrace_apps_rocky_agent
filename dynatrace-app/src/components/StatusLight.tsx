import React from "react";
import { type Tone, toneColor } from "../app/theme";

export interface StatusLightProps {
  label: string;
  value: string;
  tone: Tone;
  detail?: string | null;
}

// A labelled status lamp. Color is never the only signal: the state is
// always written next to the lamp and exposed to assistive technology.
export function StatusLight({ label, value, tone, detail }: StatusLightProps) {
  return (
    <div role="status" aria-label={`${label}: ${value}${detail ? `. ${detail}` : ""}`} title={detail ?? undefined} className="rk-pill">
      <span aria-hidden="true" className="rk-dot" data-tone={tone} style={{ "--rk-dot": toneColor[tone] } as React.CSSProperties} />
      <span className="rk-pill__label">{label}</span>
      <span className="rk-pill__value">{value}</span>
    </div>
  );
}
