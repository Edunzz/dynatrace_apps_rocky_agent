// Stand-in for the `claude` CLI in gateway unit tests. It speaks the same
// protocol as Claude Code 2.1.308 for the parts Rocky uses (see the captured
// streams next to this file):
//
//   --version, auth status          version string, auth JSON (FAKE_LOGGED_IN)
//   -p ... (stream-json on stdin)   prompt containing:
//     "use bash"   tool call that asks mcp__rocky__approve, then "tool finished"
//     "wait"       blocks until the process is stopped
//     "auth fail"  authentication_failed error, exit 1
//     anything     streamed text reply "pong"
//
// Every invocation appends its arguments to fake-claude-args.jsonl in the
// working directory so tests can check the flags.

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import readline from "node:readline";

const argv = process.argv.slice(2);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

if (argv[0] === "--version") {
  process.stdout.write("2.1.308 (Claude Code)\n");
  process.exit(0);
}
if (argv[0] === "auth" && argv[1] === "status") {
  const loggedIn = process.env.ANTHROPIC_API_KEY !== undefined || process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined;
  process.stdout.write(JSON.stringify({ loggedIn, authMethod: loggedIn ? "oauth_token" : "none", apiProvider: "firstParty" }));
  process.exit(loggedIn ? 0 : 1);
}

appendFileSync(
  "fake-claude-args.jsonl",
  `${JSON.stringify({ argv, env: { scrub: process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB ?? null, password: process.env.ROCKY_SERVER_PASSWORD ?? null } })}\n`,
);
const sessionId = flag("--session-id") ?? flag("--resume");

function streamText(id, text) {
  emit({ type: "stream_event", event: { type: "message_start", message: { id, role: "assistant", model: "claude-test", content: [] } }, parent_tool_use_id: null });
  emit({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null });
  emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null });
  emit({ type: "assistant", message: { id, role: "assistant", model: "claude-test", content: [{ type: "text", text }] }, parent_tool_use_id: null });
  emit({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, parent_tool_use_id: null });
}

// Minimal MCP client: start the server from --mcp-config and call approve.
function approve(toolName, input, toolUseId) {
  const config = JSON.parse(readFileSync(flag("--mcp-config"), "utf8")).mcpServers.rocky;
  const server = spawn(config.command, config.args, { stdio: ["pipe", "pipe", "inherit"] });
  const send = (msg) => server.stdin.write(`${JSON.stringify(msg)}\n`);
  return new Promise((resolve) => {
    readline.createInterface({ input: server.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approve", arguments: { tool_name: toolName, input, tool_use_id: toolUseId } } });
      } else if (msg.id === 2) {
        server.kill();
        resolve(JSON.parse(msg.result.content[0].text));
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fake-claude" } } });
  });
}

async function main(prompt) {
  emit({ type: "system", subtype: "init", session_id: sessionId, model: "claude-test", permissionMode: "default" });
  if (/auth fail/.test(prompt)) {
    emit({
      type: "assistant",
      message: { id: "f0a1", role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] },
      parent_tool_use_id: null,
      error: "authentication_failed",
      is_api_error_message: true,
    });
    emit({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", session_id: sessionId });
    process.exit(1);
  }
  if (/use bash/.test(prompt)) {
    const toolUseId = `toolu_fake_${Date.now()}`;
    const input = { command: "echo rocky > marker.txt", description: "Write a marker file" };
    emit({ type: "stream_event", event: { type: "message_start", message: { id: "msg_fake_tool", role: "assistant", content: [] } }, parent_tool_use_id: null });
    emit({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolUseId, name: "Bash", input: {} } }, parent_tool_use_id: null });
    emit({ type: "assistant", message: { id: "msg_fake_tool", role: "assistant", model: "claude-test", content: [{ type: "tool_use", id: toolUseId, name: "Bash", input }] }, parent_tool_use_id: null });
    emit({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, parent_tool_use_id: null });
    const decision = await approve("Bash", input, toolUseId);
    const result =
      decision.behavior === "allow"
        ? { type: "tool_result", tool_use_id: toolUseId, content: "rocky", is_error: false }
        : { type: "tool_result", tool_use_id: toolUseId, content: decision.message, is_error: true };
    emit({ type: "user", message: { role: "user", content: [result] }, parent_tool_use_id: null });
    if (/wait/.test(prompt)) await new Promise(() => {});
    streamText("msg_fake_done", "tool finished");
  } else if (/wait/.test(prompt)) {
    await new Promise(() => {});
  } else {
    streamText(`msg_fake_${Date.now()}`, "pong");
  }
  emit({ type: "result", subtype: "success", is_error: false, result: "done", session_id: sessionId });
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const message = JSON.parse(input.split("\n")[0]);
  main(message.message.content[0].text).catch((error) => {
    process.stderr.write(String(error?.stack ?? error));
    process.exit(2);
  });
});
