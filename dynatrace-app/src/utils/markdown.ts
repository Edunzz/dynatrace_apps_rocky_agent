import type { OcMessage, OcPart, OcSession, OcToolPart } from "../models/runtime";
import { redactWithCount } from "./redact";

export const MAX_TOOL_INPUT_CHARS = 2_000;
export const MAX_TOOL_OUTPUT_CHARS = 4_000;

export interface ExportMeta {
  savedAt?: string;
  modelProvider?: string;
  modelId?: string;
  dynatraceEnvironment?: string;
  runtimeName?: string;
}

export interface MarkdownExport {
  markdown: string;
  redactions: number;
  messageCount: number;
}

function iso(ms: number | undefined): string {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "unknown";
}

// Picks a fence longer than any backtick run inside the content.
export function fence(content: string, lang = "text"): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((r) => r.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toolSection(part: OcToolPart): string {
  const state = part.state;
  const title = "title" in state && state.title ? ` — ${state.title}` : "";
  const lines = [`**Tool \`${part.tool}\`**${title} · _${state.status}_`];
  const input = state.input && Object.keys(state.input).length > 0 ? JSON.stringify(state.input, null, 2) : "";
  if (input) lines.push("", "Input:", "", fence(truncate(input, MAX_TOOL_INPUT_CHARS), "json"));
  if (state.status === "completed" && state.output) {
    lines.push("", "Output:", "", fence(truncate(state.output, MAX_TOOL_OUTPUT_CHARS)));
  }
  if (state.status === "error") lines.push("", `Error: ${state.error}`);
  return lines.join("\n");
}

function partToMarkdown(part: OcPart): string | null {
  switch (part.type) {
    case "text":
      return part.synthetic || part.ignored ? null : part.text;
    case "tool":
      return toolSection(part);
    case "subtask":
      return `**Subagent task** (${part.agent}): ${part.description}`;
    case "file":
      return `_Attached file: ${part.filename ?? "unnamed"} (${part.mime})_`;
    case "reasoning": // Hidden model reasoning is never exported.
    default:
      return null;
  }
}

export function conversationToMarkdown(session: OcSession, messages: OcMessage[], meta: ExportMeta = {}): MarkdownExport {
  const header = [
    `# ${session.title || "Untitled session"}`,
    "",
    "| Field | Value |",
    "|---|---|",
    `| OpenCode session | ${escapeCell(session.id)} |`,
    `| Created | ${iso(session.time?.created)} |`,
    `| Saved | ${meta.savedAt ?? "not saved yet"} |`,
    `| Model | ${escapeCell(`${meta.modelProvider ?? "unknown"}/${meta.modelId ?? "unknown"}`)} |`,
  ];
  if (meta.runtimeName) header.push(`| Runtime | ${escapeCell(meta.runtimeName)} |`);
  if (meta.dynatraceEnvironment) header.push(`| Dynatrace environment | ${escapeCell(meta.dynatraceEnvironment)} |`);
  header.push(
    "",
    "> Exported from Rocky Agent. Only user-visible content is included: hidden model reasoning is excluded, long tool",
    "> payloads are truncated and secrets are replaced with `[REDACTED]`.",
    "",
  );

  const body: string[] = [];
  let count = 0;
  const ordered = [...messages].sort((a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0));
  for (const message of ordered) {
    const parts = message.parts.map(partToMarkdown).filter((p): p is string => Boolean(p && p.trim()));
    const error = message.info.role === "assistant" ? message.info.error : undefined;
    if (parts.length === 0 && !error) continue;
    count += 1;
    if (message.info.role === "user") {
      body.push(`## User · ${iso(message.info.time.created)}`);
    } else {
      const model = [message.info.providerID, message.info.modelID].filter(Boolean).join("/");
      const agent = message.info.agent ? ` (${message.info.agent}${model ? ` · ${model}` : ""})` : model ? ` (${model})` : "";
      body.push(`## Agent${agent} · ${iso(message.info.time.created)}`);
    }
    body.push("", parts.join("\n\n"));
    if (error) body.push("", `> Error: ${error.data?.message ?? error.name ?? "unknown error"}`);
    body.push("", "---", "");
  }

  const { text, count: redactions } = redactWithCount([...header, ...body].join("\n").trimEnd() + "\n");
  return { markdown: text, redactions, messageCount: count };
}
