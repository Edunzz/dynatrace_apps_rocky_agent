import { Markdown, MessageContainer } from "@dynatrace/strato-components/content";
import { ChevronRightSmallIcon } from "@dynatrace/strato-icons";
import React from "react";
import { type Tone, toneColor, Ui } from "../app/theme";
import type { OcMessage, OcPart, OcToolPart } from "../models/runtime";

const TOOL_STATUS: Record<string, { tone: Tone; text: string }> = {
  pending: { tone: "neutral", text: Ui.muted },
  running: { tone: "info", text: Ui.primary },
  completed: { tone: "ok", text: Ui.success },
  error: { tone: "critical", text: Ui.critical },
};

function time(ms: number | undefined): string {
  return typeof ms === "number" ? new Date(ms).toLocaleTimeString() : "";
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more characters]` : text;
}

function ToolActivity({ part }: { part: OcToolPart }) {
  const state = part.state;
  const status = TOOL_STATUS[state.status] ?? TOOL_STATUS.pending;
  const title = "title" in state && state.title ? state.title : "";
  const input = state.input && Object.keys(state.input).length > 0 ? JSON.stringify(state.input, null, 2) : "";
  return (
    <details className="rk-tool">
      <summary>
        <span className="rk-tool__chev" aria-hidden="true">
          <ChevronRightSmallIcon />
        </span>
        <span aria-hidden="true" className="rk-dot" data-tone={status.tone} style={{ "--rk-dot": toneColor[status.tone] } as React.CSSProperties} />
        <span className="rk-tool__name">{part.tool}</span>
        <span className="rk-tool__title">{title}</span>
        <span className="rk-tool__status" style={{ color: status.text }}>
          {state.status}
        </span>
      </summary>
      {input && (
        <div className="rk-tool__section">
          <p className="rk-tool__label">Input</p>
          <pre>{truncate(input, 2000)}</pre>
        </div>
      )}
      {state.status === "completed" && state.output && (
        <div className="rk-tool__section">
          <p className="rk-tool__label">Output</p>
          <pre>{truncate(state.output)}</pre>
        </div>
      )}
      {state.status === "error" && (
        <div className="rk-tool__section">
          <p className="rk-tool__label">Error</p>
          <pre style={{ color: Ui.critical }}>{state.error}</pre>
        </div>
      )}
    </details>
  );
}

function PartView({ part }: { part: OcPart }) {
  switch (part.type) {
    case "text":
      if (part.synthetic || part.ignored || !part.text.trim()) return null;
      return (
        <div>
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "tool":
      return <ToolActivity part={part} />;
    case "subtask":
      return (
        <div className="rk-subtask">
          ↳ Subagent {part.agent}: {part.description}
        </div>
      );
    case "file":
      return (
        <p className="rk-small">
          Attached file: {part.filename ?? "unnamed"} ({part.mime})
        </p>
      );
    default:
      // Reasoning, step markers, snapshots and patches are not shown.
      return null;
  }
}

export function MessageTimeline({ messages, busy }: { messages: OcMessage[]; busy: boolean }) {
  if (messages.length === 0) {
    return <p className="rk-small">{busy ? "Waiting for the agent…" : "No messages yet."}</p>;
  }
  return (
    <ol aria-label="Conversation" className="rk-timeline">
      {messages.map((m) => {
        const isUser = m.info.role === "user";
        const error = m.info.role === "assistant" ? m.info.error : undefined;
        const model = m.info.role === "assistant" ? [m.info.providerID, m.info.modelID].filter(Boolean).join("/") : "";
        const parts = m.parts.map((p) => <PartView key={p.id} part={p} />);
        if (isUser) {
          return (
            <li key={m.info.id} aria-label="Your message" className="rk-msg rk-msg--user">
              <div className="rk-msg__meta">
                <span className="rk-msg__author">You</span>
                <span>{time(m.info.time.created)}</span>
              </div>
              <div className="rk-bubble">{parts}</div>
            </li>
          );
        }
        return (
          <li key={m.info.id} aria-label="Agent message" className="rk-msg">
            <div className="rk-msg__body">
              <div className="rk-msg__meta">
                <span className="rk-msg__author">Rocky</span>
                <span>{time(m.info.time.created)}</span>
                {model ? <span className="rk-mono">{model}</span> : null}
                {m.info.agent ? <span>{m.info.agent}</span> : null}
              </div>
              {parts}
              {error && (
                <MessageContainer variant="critical">
                  <MessageContainer.Description>
                    {error.data?.message ?? error.name ?? "The model returned an error."}
                  </MessageContainer.Description>
                </MessageContainer>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
