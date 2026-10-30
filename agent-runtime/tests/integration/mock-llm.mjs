// OpenAI-compatible mock model used by integration tests. It never calls a
// real provider.
//
//   * Default reply: "pong".
//   * A user message containing "use bash" gets a `bash` tool call
//     (`echo rocky-integration`), which triggers an OpenCode permission request.
//   * After a tool result, it replies "tool finished".

import http from "node:http";
import { pathToFileURL } from "node:url";

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((c) => c.text ?? "").join(" ");
  }
  return "";
}

export function decide(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (last?.role === "tool") return { text: "tool finished" };
  if (/use bash/i.test(lastUserText(messages)) && Array.isArray(body.tools) && body.tools.some((t) => t.function?.name === "bash")) {
    return {
      toolCall: {
        id: `call_${Date.now()}`,
        name: "bash",
        arguments: JSON.stringify({ command: "echo rocky-integration", description: "Print a marker" }),
      },
    };
  }
  return { text: "pong" };
}

function chunk(model, delta, finish = null, usage) {
  const payload = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function createMockLlm() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "GET" && req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      }
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
        res.writeHead(404);
        return res.end();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const decision = decide(body);
      calls.push({ decision, messageCount: body.messages?.length ?? 0 });
      const model = body.model ?? "mock-model";
      const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
      if (!body.stream) {
        const message = decision.toolCall
          ? {
              role: "assistant",
              content: null,
              tool_calls: [{ id: decision.toolCall.id, type: "function", function: { name: decision.toolCall.name, arguments: decision.toolCall.arguments } }],
            }
          : { role: "assistant", content: decision.text };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message, finish_reason: decision.toolCall ? "tool_calls" : "stop" }],
            usage,
          }),
        );
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      if (decision.toolCall) {
        res.write(
          chunk(model, {
            role: "assistant",
            tool_calls: [
              { index: 0, id: decision.toolCall.id, type: "function", function: { name: decision.toolCall.name, arguments: decision.toolCall.arguments } },
            ],
          }),
        );
        res.write(chunk(model, {}, "tool_calls", usage));
      } else {
        res.write(chunk(model, { role: "assistant", content: decision.text }));
        res.write(chunk(model, {}, "stop", usage));
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return { server, calls };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number.parseInt(process.env.MOCK_LLM_PORT ?? "8089", 10);
  const host = process.env.MOCK_LLM_HOST ?? "127.0.0.1";
  const { server } = createMockLlm();
  server.listen(port, host, () => process.stdout.write(`mock-llm listening on http://${host}:${port}/v1\n`));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
