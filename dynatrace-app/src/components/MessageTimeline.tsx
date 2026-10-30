import { Markdown, MessageContainer } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";
import React from "react";
import { Console } from "../app/theme";
import type { OcMessage, OcPart, OcToolPart } from "../models/runtime";

const TOOL_COLORS: Record<string, string> = {
  pending: Console.muted,
  running: Console.cyan,
  completed: Console.green,
  error: Console.red,
};

function time(ms: number | undefined): string {
  return typeof ms === "number" ? new Date(ms).toLocaleTimeString() : "";
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more characters]` : text;
}

function ToolActivity({ part }: { part: OcToolPart }) {
  const state = part.state;
  const color = TOOL_COLORS[state.status] ?? Console.muted;
  const title = "title" in state && state.title ? state.title : "";
  const input = state.input && Object.keys(state.input).length > 0 ? JSON.stringify(state.input, null, 2) : "";
  return (
    <details style={{ margin: "4px 0 4px 20px", borderLeft: `2px solid ${color}`, paddingLeft: 10 }}>
      <summary style={{ cursor: "pointer", color: Console.text, fontFamily: Console.mono, fontSize: 13 }}>
        <span aria-hidden="true" style={{ color }}>
          ●{" "}
        </span>
        <span style={{ color: Console.cyan }}>{part.tool}</span>
        {title ? <span style={{ color: Console.muted }}> — {title}</span> : null}
        <span style={{ color }}> [{state.status}]</span>
      </summary>
      {input && (
        <pre style={{ color: Console.muted, fontFamily: Console.mono, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {truncate(input, 2000)}
        </pre>
      )}
      {state.status === "completed" && state.output && (
        <pre style={{ color: Console.text, fontFamily: Console.mono, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 320, overflowY: "auto" }}>
          {truncate(state.output)}
        </pre>
      )}
      {state.status === "error" && <Text style={{ color: Console.red, fontFamily: Console.mono, fontSize: 12 }}>{state.error}</Text>}
    </details>
  );
}

function PartView({ part }: { part: OcPart }) {
  switch (part.type) {
    case "text":
      if (part.synthetic || part.ignored || !part.text.trim()) return null;
      return (
        <div style={{ color: Console.text }}>
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "tool":
      return <ToolActivity part={part} />;
    case "subtask":
      return (
        <div style={{ margin: "4px 0 4px 20px", paddingLeft: 10, borderLeft: `2px dashed ${Console.orange}` }}>
          <Text style={{ color: Console.orange, fontFamily: Console.mono, fontSize: 13 }}>
            ↳ subagent {part.agent}: {part.description}
          </Text>
        </div>
      );
    case "file":
      return <Text style={{ color: Console.muted, fontSize: 12 }}>Attached file: {part.filename ?? "unnamed"} ({part.mime})</Text>;
    default:
      // Reasoning, step markers, snapshots and patches are not shown.
      return null;
  }
}

export function MessageTimeline({ messages, busy }: { messages: OcMessage[]; busy: boolean }) {
  if (messages.length === 0) {
    return <Text style={{ color: Console.muted }}>{busy ? "Waiting for the agent…" : "No messages yet."}</Text>;
  }
  return (
    <ol aria-label="Conversation" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      {messages.map((m) => {
        const isUser = m.info.role === "user";
        const error = m.info.role === "assistant" ? m.info.error : undefined;
        const model = m.info.role === "assistant" ? [m.info.providerID, m.info.modelID].filter(Boolean).join("/") : "";
        return (
          <li key={m.info.id} aria-label={isUser ? "Your message" : "Agent message"}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <Text style={{ color: isUser ? Console.cyan : Console.green, fontFamily: Console.mono, fontWeight: 700 }}>
                {isUser ? "you ›" : "rocky ›"}
              </Text>
              <Text style={{ color: Console.muted, fontFamily: Console.mono, fontSize: 11 }}>
                {time(m.info.time.created)}
                {model ? ` · ${model}` : ""}
                {m.info.agent && !isUser ? ` · ${m.info.agent}` : ""}
              </Text>
            </div>
            <div style={{ paddingLeft: isUser ? 0 : 4 }}>
              {m.parts.map((p) => (
                <PartView key={p.id} part={p} />
              ))}
              {error && (
                <MessageContainer variant="critical">
                  {error.data?.message ?? error.name ?? "The model returned an error."}
                </MessageContainer>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
