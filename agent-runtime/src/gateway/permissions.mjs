// Pending tool approvals.
//
// Claude Code asks the `mcp__rocky__approve` tool (mcp-permission.mjs) before
// a tool call that no permission rule allows. The helper forwards the request
// to the gateway's loopback endpoint, which keeps it here until the user
// answers in the app, the run ends or the request times out (then it is
// denied). An approval covers that single call only.

import { randomBytes } from "node:crypto";

const MAX_PENDING = 200;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

function text(value, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

// Maps a Claude Code tool call to the permission shape the app renders.
export function describePermission(toolName, input = {}) {
  if (SHELL_TOOLS.has(toolName)) {
    const command = text(input.command) ?? "";
    return { permission: "bash", patterns: [command], metadata: { command, description: text(input.description, 300) } };
  }
  if (EDIT_TOOLS.has(toolName)) {
    const filePath = text(input.file_path ?? input.notebook_path, 1000) ?? "";
    return { permission: "edit", patterns: [filePath], metadata: { filePath } };
  }
  if (toolName === "WebFetch") {
    const url = text(input.url, 1000) ?? "";
    return { permission: "webfetch", patterns: [url], metadata: { url } };
  }
  if (toolName === "WebSearch") {
    const query = text(input.query, 500) ?? "";
    return { permission: "websearch", patterns: [query], metadata: { query } };
  }
  const summary = JSON.stringify(input ?? {}).slice(0, 500);
  return { permission: String(toolName).toLowerCase(), patterns: [summary], metadata: { tool: toolName } };
}

export class PermissionRegistry {
  constructor({ timeoutMs = 15 * 60_000, onRequested = () => {}, onSettled = () => {} } = {}) {
    this.timeoutMs = timeoutMs;
    this.onRequested = onRequested;
    this.onSettled = onSettled;
    this.pending = new Map();
  }

  // Returns the request ID and a promise for Claude Code's permission tool
  // answer: {behavior: "allow", updatedInput} or {behavior: "deny", message}.
  request({ sessionId, runId, toolName, input, toolUseId, messageId }) {
    if (this.pending.size >= MAX_PENDING) {
      return { id: null, decision: Promise.resolve({ behavior: "deny", message: "Too many pending approvals in this runtime." }) };
    }
    const id = `per_${randomBytes(12).toString("hex")}`;
    const decision = new Promise((resolve) => {
      const entry = {
        id,
        sessionId,
        runId,
        toolName: String(toolName),
        input: input && typeof input === "object" ? input : {},
        toolUseId: toolUseId ? String(toolUseId) : null,
        messageId: messageId ?? null,
        createdAt: Date.now(),
        resolve,
      };
      entry.timer = setTimeout(
        () => this.settle(id, { behavior: "deny", message: "No one answered the approval request in time." }, "timeout"),
        this.timeoutMs,
      );
      entry.timer.unref?.();
      this.pending.set(id, entry);
      this.onRequested(entry);
    });
    return { id, decision };
  }

  settle(id, decision, reason) {
    const entry = this.pending.get(id);
    if (!entry) return null;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    this.onSettled(entry, decision, reason);
    return entry;
  }

  reply(id, reply, message) {
    const entry = this.pending.get(id);
    if (!entry) return null;
    const decision =
      reply === "once"
        ? { behavior: "allow", updatedInput: entry.input }
        : { behavior: "deny", message: message ? `Rejected by the user: ${message}` : "Rejected by the user." };
    return this.settle(id, decision, reply === "once" ? "approved" : "rejected");
  }

  get(id) {
    return this.pending.get(id) ?? null;
  }

  cancelRun(runId, message) {
    for (const entry of [...this.pending.values()]) {
      if (entry.runId === runId) this.settle(entry.id, { behavior: "deny", message }, "cancelled");
    }
  }

  // Public view (OpenCode-compatible shape used by the app).
  list(sessionId) {
    return [...this.pending.values()]
      .filter((entry) => !sessionId || entry.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => ({
        id: entry.id,
        sessionID: entry.sessionId,
        ...describePermission(entry.toolName, entry.input),
        always: [],
        ...(entry.toolUseId ? { tool: { messageID: entry.messageId ?? "", callID: entry.toolUseId } } : {}),
      }));
  }
}
