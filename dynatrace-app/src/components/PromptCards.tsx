import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import React from "react";
import { Console } from "../app/theme";

export interface SuggestedPrompt {
  id: string;
  title: string;
  accent: string;
  text: string;
}

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: "rca",
    title: "Root cause analysis",
    accent: Console.red,
    text: "Perform an RCA for a problem or incident. Ask for the affected service, impact, and time range before analysis.",
  },
  {
    id: "logs",
    title: "Log value and sensitive data",
    accent: Console.cyan,
    text: "Analyze tenant logs, classify valuable and low-value data, identify sensitive data, and propose a remediation plan.",
  },
  {
    id: "alerts",
    title: "Alert quality report",
    accent: Console.orange,
    text: "Analyze alert quality and create a Dynatrace Notebook report describing noisy alerts, missing alerts, and recommended improvements.",
  },
  {
    id: "business",
    title: "Business data dashboard",
    accent: Console.green,
    text: "Identify business data in logs and propose a dashboard for the relevant business indicators.",
  },
];

// Rounded prompt cards. They are Strato buttons, so keyboard focus is visible
// and they work with assistive technology.
export function PromptCards({ selected, onPick }: { selected: string | null; onPick: (prompt: SuggestedPrompt) => void }) {
  return (
    <div role="group" aria-label="Suggested prompts" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
      {SUGGESTED_PROMPTS.map((p) => {
        const isSelected = selected === p.id;
        return (
          <Button
            key={p.id}
            width="full"
            textAlign="start"
            aria-pressed={isSelected}
            onClick={() => onPick(p)}
            style={{
              height: "auto",
              minHeight: 110,
              whiteSpace: "normal",
              borderRadius: 16,
              padding: 16,
              background: Console.surfaceRaised,
              border: `1px solid ${isSelected ? p.accent : Console.border}`,
              boxShadow: isSelected ? `0 0 0 1px ${p.accent}, 0 0 18px ${p.accent}40` : "none",
              color: Console.text,
              alignItems: "flex-start",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Text style={{ color: p.accent, fontFamily: Console.mono, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>
                {p.title}
              </Text>
              <Text style={{ color: Console.text, lineHeight: 1.4 }}>{p.text}</Text>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
