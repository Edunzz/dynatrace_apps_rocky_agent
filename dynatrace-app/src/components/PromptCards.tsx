import { BarChartIcon, LogsIcon, NotificationActiveIcon, ResearchIcon } from "@dynatrace/strato-icons";
import React from "react";
import { Ui } from "../app/theme";

export interface SuggestedPrompt {
  id: string;
  title: string;
  accent: string;
  icon: React.ReactNode;
  text: string;
}

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: "rca",
    title: "Root cause analysis",
    accent: Ui.critical,
    icon: <ResearchIcon />,
    text: "Perform an RCA for a problem or incident. Ask for the affected service, impact, and time range before analysis.",
  },
  {
    id: "logs",
    title: "Log value and sensitive data",
    accent: Ui.primary,
    icon: <LogsIcon />,
    text: "Analyze tenant logs, classify valuable and low-value data, identify sensitive data, and propose a remediation plan.",
  },
  {
    id: "alerts",
    title: "Alert quality report",
    accent: Ui.warning,
    icon: <NotificationActiveIcon />,
    text: "Analyze alert quality and create a Dynatrace Notebook report describing noisy alerts, missing alerts, and recommended improvements.",
  },
  {
    id: "business",
    title: "Business data dashboard",
    accent: Ui.success,
    icon: <BarChartIcon />,
    text: "Identify business data in logs and propose a dashboard for the relevant business indicators.",
  },
];

// Prompt cards are native buttons: keyboard focus is visible and they work
// with assistive technology. Hover, press and selection live in styles.css.
export function PromptCards({ selected, onPick }: { selected: string | null; onPick: (prompt: SuggestedPrompt) => void }) {
  return (
    <div role="group" aria-label="Suggested prompts" className="rk-prompts" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
      {SUGGESTED_PROMPTS.map((p) => (
        <button
          key={p.id}
          type="button"
          className="rk-prompt"
          aria-pressed={selected === p.id}
          onClick={() => onPick(p)}
          style={{ "--rk-accent": p.accent } as React.CSSProperties}
        >
          <span className="rk-prompt__head">
            <span className="rk-prompt__icon" aria-hidden="true">
              {p.icon}
            </span>
            {p.title}
          </span>
          <span className="rk-prompt__text">{p.text}</span>
        </button>
      ))}
    </div>
  );
}
