// Anthropic Messages API mock used by integration tests. Claude Code talks to
// it through ANTHROPIC_BASE_URL; no real model provider is ever called.
//
//   * Default reply: "pong".
//   * A user message containing "use bash" gets a shell tool call
//     that writes rocky-integration.txt; writing a file needs approval, so
//     the call reaches the Rocky permission flow.
//   * A user message containing "show key" runs a read-only command that
//     names a credential variable; managed rules must deny it.
//   * A user message containing "use agent" starts a subagent, which replies
//     "pong".
//   * After a tool result, it replies "tool finished".
//   * Requests without tools (titles, summaries and other helper calls that
//     Claude Code makes) get a short neutral reply.

import http from "node:http";
import { pathToFileURL } from "node:url";

export const POLICY_MARKERS = ["Rocky Agent: protected baseline policy", "## User policy overlay"];

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = textOf(m.content);
    if (text.trim()) return text;
  }
  return "";
}

function endsWithToolResult(messages) {
  const last = messages[messages.length - 1];
  return last?.role === "user" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
}

export function decide(body) {
  // Claude Code appends mid-conversation system messages (for example a
  // token budget note); only user and assistant turns matter here.
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter((m) => m.role !== "system");
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.length === 0) return { text: "Rocky test" };
  if (endsWithToolResult(messages)) return { text: "tool finished" };
  const subagent = ["Agent", "Task"].find((name) => tools.some((t) => t.name === name));
  if (/use agent/i.test(lastUserText(messages)) && subagent) {
    return {
      toolUse: {
        id: `toolu_mock_${Date.now()}`,
        name: subagent,
        input: { description: "Answer ping", prompt: "Reply with pong.", subagent_type: "general-purpose" },
      },
    };
  }
  // Linux exposes the shell as Bash; Windows (local experiments) as PowerShell.
  const shell = ["Bash", "PowerShell"].find((name) => tools.some((t) => t.name === name));
  // A read-only command that would print a credential: managed rules must deny it.
  if (/show key/i.test(lastUserText(messages)) && shell) {
    return {
      toolUse: {
        id: `toolu_mock_${Date.now()}`,
        name: shell,
        input: { command: 'echo "key=${ANTHROPIC_API_KEY:-none}"', description: "Print a variable" },
      },
    };
  }
  if (/use bash/i.test(lastUserText(messages)) && shell) {
    return {
      toolUse: {
        id: `toolu_mock_${Date.now()}`,
        name: shell,
        input: { command: "echo rocky-integration > rocky-integration.txt", description: "Write a marker file" },
      },
    };
  }
  return { text: "pong" };
}

function message(model, decision) {
  const content = decision.toolUse
    ? [{ type: "tool_use", id: decision.toolUse.id, name: decision.toolUse.name, input: decision.toolUse.input }]
    : [{ type: "text", text: decision.text }];
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: decision.toolUse ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
  };
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function stream(res, model, decision) {
  const full = message(model, decision);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  sse(res, "message_start", { message: { ...full, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  if (decision.toolUse) {
    const { id, name, input } = decision.toolUse;
    sse(res, "content_block_start", { index: 0, content_block: { type: "tool_use", id, name, input: {} } });
    sse(res, "content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
  } else {
    sse(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    sse(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: decision.text } });
  }
  sse(res, "content_block_stop", { index: 0 });
  sse(res, "message_delta", { delta: { stop_reason: full.stop_reason, stop_sequence: null }, usage: { output_tokens: 2 } });
  sse(res, "message_stop", {});
  res.end();
}

export function createMockAnthropic() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "POST" && path === "/v1/messages/count_tokens") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (req.method !== "POST" || path !== "/v1/messages") {
        calls.push({ method: req.method, path, unknown: true });
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "mock: not found" } }));
      }
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        res.writeHead(400);
        return res.end();
      }
      const decision = decide(body);
      const system = typeof body.system === "string" ? body.system : textOf(body.system);
      calls.push({
        method: req.method,
        path,
        decision,
        // Lets tests check the model and effort chosen for a prompt.
        model: body.model,
        effort: body.output_config?.effort,
        messageCount: body.messages?.length ?? 0,
        tools: (body.tools ?? []).map((t) => t.name),
        // Lets tests check that the Rocky policy reached the model.
        policy: POLICY_MARKERS.filter((marker) => system.includes(marker)),
        tail: (body.messages ?? []).slice(-3).map((m) => ({
          role: m.role,
          blocks: (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).map(
            (b) => `${b.type}:${String(b.text ?? "").slice(0, 40)}`,
          ),
        })),
      });
      const model = body.model ?? "claude-mock";
      if (body.stream) return stream(res, model, decision);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(message(model, decision)));
    });
  });
  return { server, calls };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number.parseInt(process.env.MOCK_LLM_PORT ?? "8089", 10);
  const host = process.env.MOCK_LLM_HOST ?? "127.0.0.1";
  const { server, calls } = createMockAnthropic();
  server.listen(port, host, () => process.stdout.write(`mock-anthropic listening on http://${host}:${port}\n`));
  if (process.env.MOCK_LLM_LOG === "1") {
    setInterval(() => {
      while (calls.length) process.stdout.write(`${JSON.stringify(calls.shift())}\n`);
    }, 200).unref();
  }
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
