// Turns Claude Code stream-json events (`claude -p --output-format stream-json
// --verbose --include-partial-messages`) into the message model the Rocky app
// renders: messages made of text, reasoning and tool parts.
//
// Event order for one content block, as emitted by Claude Code 2.1.308:
//   stream_event message_start -> content_block_start(i) -> content_block_delta*
//   -> assistant (the complete block) -> content_block_stop(i)
// Tool results arrive as `user` events with `tool_result` blocks. Subagent
// messages carry `parent_tool_use_id`.

import { randomUUID } from "node:crypto";

const MAX_TOOL_OUTPUT = 100_000;
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const RESULT_ERRORS = {
  error_max_turns: "The agent stopped after reaching the maximum number of turns.",
  error_during_execution: "The agent stopped because of an error during execution.",
  error_max_budget_usd: "The agent stopped after reaching the spending limit.",
};

export function messageId(raw) {
  const id = String(raw ?? "").replace(/[^A-Za-z0-9_-]/g, "") || randomUUID();
  return id.startsWith("msg_") ? id : `msg_${id}`;
}

export function toolTitle(tool, input) {
  if (!input || typeof input !== "object") return "";
  if (SUBAGENT_TOOLS.has(tool)) return [input.subagent_type, input.description].filter(Boolean).join(": ");
  const value =
    input.description ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.skill ?? input.command;
  return typeof value === "string" ? value.slice(0, 200) : "";
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block?.type === "text" ? block.text : block?.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content === undefined || content === null ? "" : JSON.stringify(content);
}

function truncate(text, max = MAX_TOOL_OUTPUT) {
  return text.length > max ? `${text.slice(0, max)}\n… [${text.length - max} more characters]` : text;
}

function partId(message, index) {
  return `prt_${message.info.id.replace(/^msg_/, "")}_${index}`;
}

function upsertPart(message, index, fields) {
  const part = { id: partId(message, index), sessionID: message.info.sessionID, messageID: message.info.id, ...fields };
  const at = message.parts.findIndex((p) => p.id === part.id);
  if (at >= 0) message.parts[at] = part;
  else message.parts.push(part);
  return part;
}

export class RunTranslator {
  constructor(session, { now = () => Date.now() } = {}) {
    this.session = session;
    this.now = now;
    this.messages = new Map(session.messages.map((m) => [m.info.id, m]));
    this.calls = new Map();
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (part.type === "tool") this.calls.set(part.callID, { messageId: message.info.id, partId: part.id });
      }
    }
    this.blockState = new Map(); // message ID -> { open, next }
    this.streaming = new Map(); // parent tool use ID ("" for the main thread) -> message ID
    this.runMessages = new Set();
    this.errorReported = false;
    this.authFailed = false;
    this.retry = null;
    this.result = null;
  }

  // Applies one event; returns true when the session changed.
  handle(event) {
    switch (event?.type) {
      case "system":
        return this.onSystem(event);
      case "stream_event":
        return this.onStream(event);
      case "assistant":
        return this.onAssistant(event);
      case "user":
        return this.onUser(event);
      case "result":
        return this.onResult(event);
      default:
        return false;
    }
  }

  onSystem(event) {
    if (event.subtype === "init") {
      this.session.started = true;
      if (typeof event.model === "string") this.session.model = event.model;
      return true;
    }
    if (event.subtype === "api_retry") {
      const status = event.error_status ? ` (HTTP ${event.error_status})` : "";
      this.retry = {
        type: "retry",
        attempt: Number(event.attempt) || 1,
        message: `${event.error ?? "error"}${status}`,
        next: this.now() + (Number(event.retry_delay_ms) || 0),
      };
      if (event.error === "authentication_failed") this.authFailed = true;
      return true;
    }
    return false;
  }

  state(id) {
    let state = this.blockState.get(id);
    if (!state) {
      state = { open: null, next: 0 };
      this.blockState.set(id, state);
    }
    return state;
  }

  ensureAssistant(rawId, event) {
    const id = messageId(rawId);
    let message = this.messages.get(id);
    if (!message) {
      // A new main-thread message completes the previous one.
      if (!event.parent_tool_use_id) this.completeOpen(false);
      message = {
        info: { id, sessionID: this.session.id, role: "assistant", time: { created: this.now() }, providerID: "anthropic" },
        parts: [],
      };
      this.session.messages.push(message);
      this.messages.set(id, message);
      this.runMessages.add(id);
    }
    if (event.parent_tool_use_id && !message.info.agent) message.info.agent = event.subagent_type ?? "subagent";
    return message;
  }

  onStream(event) {
    const ev = event.event ?? {};
    const key = event.parent_tool_use_id ?? "";
    if (ev.type === "message_start") {
      const message = this.ensureAssistant(ev.message?.id, event);
      this.streaming.set(key, message.info.id);
      this.retry = null;
      return true;
    }
    const message = this.messages.get(this.streaming.get(key));
    if (!message) return false;
    const state = this.state(message.info.id);
    switch (ev.type) {
      case "content_block_start": {
        const block = ev.content_block ?? {};
        state.open = ev.index;
        if (block.type === "text") upsertPart(message, ev.index, { type: "text", text: block.text ?? "" });
        else if (block.type === "thinking") upsertPart(message, ev.index, { type: "reasoning", text: block.thinking ?? "" });
        else if (block.type === "tool_use") {
          upsertPart(message, ev.index, { type: "tool", callID: block.id, tool: block.name, state: { status: "pending", input: {} } });
        } else return false;
        return true;
      }
      case "content_block_delta": {
        const part = message.parts.find((p) => p.id === partId(message, ev.index));
        if (!part) return false;
        if (ev.delta?.type === "text_delta" && part.type === "text") part.text += ev.delta.text ?? "";
        else if (ev.delta?.type === "thinking_delta" && part.type === "reasoning") part.text += ev.delta.thinking ?? "";
        else return false;
        return true;
      }
      case "content_block_stop":
        state.open = null;
        return false;
      case "message_delta":
        if (ev.delta?.stop_reason) message.info.finish = ev.delta.stop_reason;
        return false;
      default:
        return false;
    }
  }

  onAssistant(event) {
    const raw = event.message ?? {};
    const message = this.ensureAssistant(raw.id, event);
    if (typeof raw.model === "string" && raw.model !== "<synthetic>") message.info.modelID = raw.model;
    const blocks = Array.isArray(raw.content) ? raw.content : [];
    if (event.error) {
      const text = blocks
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("\n");
      message.info.error = { name: String(event.error), data: { message: text || String(event.error) } };
      this.errorReported = true;
      if (event.error === "authentication_failed") this.authFailed = true;
      return true;
    }
    const state = this.state(message.info.id);
    let index = state.open ?? state.next;
    for (const block of blocks) {
      this.applyBlock(message, index, block);
      index += 1;
    }
    state.next = index;
    return true;
  }

  applyBlock(message, index, block) {
    switch (block?.type) {
      case "text":
        upsertPart(message, index, { type: "text", text: String(block.text ?? "") });
        return;
      case "thinking":
        upsertPart(message, index, { type: "reasoning", text: String(block.thinking ?? "") });
        return;
      case "tool_use": {
        const input = block.input && typeof block.input === "object" ? block.input : {};
        const part = upsertPart(message, index, {
          type: "tool",
          callID: String(block.id),
          tool: String(block.name),
          state: { status: "running", input, title: toolTitle(block.name, input) },
        });
        this.calls.set(part.callID, { messageId: message.info.id, partId: part.id });
        this.track(block.name, input);
        return;
      }
      default:
    }
  }

  // Task list and written files, shown next to the conversation.
  track(tool, input) {
    if (tool === "TodoWrite" && Array.isArray(input.todos)) {
      this.session.todos = input.todos.slice(0, 200).map((todo) => ({
        content: String(todo?.content ?? todo?.activeForm ?? "").slice(0, 500),
        status: String(todo?.status ?? "pending"),
        ...(todo?.priority ? { priority: String(todo.priority) } : {}),
      }));
    }
    const file = input.file_path ?? input.notebook_path;
    if (FILE_TOOLS.has(tool) && typeof file === "string" && file) {
      const artifacts = this.session.artifacts ?? (this.session.artifacts = []);
      if (!artifacts.some((a) => a.file === file) && artifacts.length < 500) artifacts.push({ file });
    }
  }

  onUser(event) {
    const content = event.message?.content;
    if (!Array.isArray(content)) return false;
    let changed = false;
    for (const block of content) {
      if (block?.type !== "tool_result") continue;
      const ref = this.calls.get(block.tool_use_id);
      const part = ref && this.messages.get(ref.messageId)?.parts.find((p) => p.id === ref.partId);
      if (!part || part.type !== "tool") continue;
      const text = truncate(resultText(block.content));
      const input = part.state.input ?? {};
      part.state = block.is_error
        ? { status: "error", input, error: text || "The tool failed." }
        : { status: "completed", input, output: text, title: part.state.title || toolTitle(part.tool, input) };
      changed = true;
    }
    return changed;
  }

  onResult(event) {
    this.result = {
      isError: Boolean(event.is_error),
      subtype: event.subtype ?? null,
      terminalReason: event.terminal_reason ?? null,
    };
    this.retry = null;
    if (event.is_error && !this.errorReported) {
      const text = typeof event.result === "string" && event.result ? event.result : RESULT_ERRORS[event.subtype];
      this.reportError(String(event.subtype ?? "error"), text ?? "The agent run failed.");
    }
    this.completeOpen(true);
    return true;
  }

  lastRunMessage() {
    const ids = [...this.runMessages];
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const message = this.messages.get(ids[i]);
      if (message && !message.info.agent) return message;
    }
    return null;
  }

  reportError(name, text) {
    let message = this.lastRunMessage();
    if (!message) message = this.ensureAssistant(`msg_rocky_${randomUUID()}`, {});
    message.info.error = { name, data: { message: text } };
    this.errorReported = true;
  }

  completeOpen(all) {
    for (const id of this.runMessages) {
      const message = this.messages.get(id);
      if (message && !message.info.time.completed && (all || !message.info.agent)) message.info.time.completed = this.now();
    }
  }

  // Called once when the Claude Code process has exited.
  finish({ code = 0, signal = null, aborted = false, spawnError = null } = {}) {
    if (spawnError) {
      this.reportError("RuntimeError", `Claude Code could not be started: ${spawnError}`);
    } else if (aborted) {
      const message = this.lastRunMessage();
      if (message) message.info.error = { name: "MessageAbortedError", data: { message: "Stopped by the user." } };
      else this.reportError("MessageAbortedError", "Stopped by the user.");
    } else if (!this.result && code !== 0) {
      this.reportError("RuntimeError", `Claude Code exited unexpectedly (${signal ?? `exit code ${code}`}).`);
    }
    const reason = aborted ? "Stopped by the user." : "The run ended before the tool finished.";
    for (const id of this.runMessages) {
      for (const part of this.messages.get(id)?.parts ?? []) {
        if (part.type === "tool" && (part.state.status === "running" || part.state.status === "pending")) {
          part.state = { status: "error", input: part.state.input ?? {}, error: reason };
        }
      }
    }
    this.completeOpen(true);
    this.retry = null;
  }
}
