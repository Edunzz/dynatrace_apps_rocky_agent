#!/usr/bin/env node
// MCP stdio server with one tool, `approve`, used as Claude Code's
// --permission-prompt-tool (mcp__rocky__approve).
//
// Claude Code calls it with {tool_name, input, tool_use_id} before a tool call
// that no permission rule allows. The helper asks the Rocky gateway over its
// loopback endpoint, waits for the user's answer and returns Claude Code's
// expected JSON text: {"behavior":"allow","updatedInput":{...}} or
// {"behavior":"deny","message":"..."}.
//
//   node mcp-permission.mjs <run-file>
//
// The run file (mode 0600, written by the gateway for one run) holds the
// endpoint URL, a per-run secret and the session and run IDs. Knowing the
// secret only allows asking; approvals come from the authenticated app.

import { readFileSync } from "node:fs";
import http from "node:http";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const TOOL = {
  name: "approve",
  description: "Asks the Rocky Agent user to approve or reject a tool call.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

export function askGateway(run, args) {
  const body = JSON.stringify({
    runId: run.runId,
    sessionId: run.sessionId,
    toolName: args?.tool_name,
    input: args?.input ?? {},
    toolUseId: args?.tool_use_id ?? null,
  });
  return new Promise((resolve) => {
    const deny = (message) => resolve({ behavior: "deny", message });
    const url = new URL("/internal/v1/permissions", run.url);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        agent: false,
        timeout: run.timeoutMs ?? 20 * 60_000,
        headers: {
          authorization: `Bearer ${run.secret}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const decision = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (res.statusCode === 200 && (decision.behavior === "allow" || decision.behavior === "deny")) return resolve(decision);
          } catch {
            // fall through
          }
          deny("Rocky could not get an answer for this approval.");
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => deny("Rocky could not ask for approval."));
    req.end(body);
  });
}

export function createHandler(run, ask = askGateway) {
  return async function handle(msg) {
    if (msg.id === undefined || msg.id === null) return null; // notifications
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "rocky", version: "1.0.0" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: [TOOL] });
      case "tools/call": {
        if (msg.params?.name !== TOOL.name) {
          return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` } };
        }
        const decision = await ask(run, msg.params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(decision) }] });
      }
      default:
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
    }
  };
}

function main(argv) {
  const run = JSON.parse(readFileSync(argv[0], "utf8"));
  const handle = createHandler(run);
  const send = (msg) => {
    if (msg) process.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    handle(msg).then(send, () => send({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: "Internal error" } }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
