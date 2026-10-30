// Translator tests over event streams captured from Claude Code 2.1.308
// (tests/fixtures/claude-stream, sanitized) with Rocky's flags.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { messageId, RunTranslator, toolTitle } from "../src/gateway/translate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function events(name) {
  return readFileSync(join(here, "fixtures", "claude-stream", `${name}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function replay(name, session = { id: "ses_test", messages: [], todos: [], artifacts: [] }) {
  let clock = 1_000;
  const translator = new RunTranslator(session, { now: () => (clock += 10) });
  for (const event of events(name)) translator.handle(event);
  return { session, translator };
}

const assistant = (session) => session.messages.filter((m) => m.info.role === "assistant");
const parts = (session, type) => session.messages.flatMap((m) => m.parts.filter((p) => p.type === type));

describe("RunTranslator with captured Claude Code streams", () => {
  it("turns a streamed text reply into one completed assistant message", () => {
    const { session, translator } = replay("text-reply");
    const [message] = assistant(session);
    assert.equal(assistant(session).length, 1);
    assert.deepEqual(
      message.parts.map((p) => [p.type, p.text]),
      [["text", "pong"]],
      "deltas and the final block share one part",
    );
    assert.ok(message.info.time.completed >= message.info.time.created);
    assert.equal(session.started, true);
    assert.equal(translator.result.isError, false);
  });

  it("records an approved tool call with its output, then the follow-up reply", () => {
    const { session } = replay("tool-approved");
    const [tool] = parts(session, "tool");
    assert.equal(tool.state.status, "completed");
    assert.equal(tool.state.input.command, "echo rocky-integration > rocky-integration.txt");
    assert.equal(tool.state.title, "Write a marker file");
    assert.equal(tool.state.output, "Shell cwd was reset to /workspace");
    assert.deepEqual(
      parts(session, "text").map((p) => p.text),
      ["tool finished"],
    );
    assert.equal(assistant(session).length, 2);
  });

  it("records a rejected tool call as an error", () => {
    const { session } = replay("tool-rejected");
    const [tool] = parts(session, "tool");
    assert.equal(tool.state.status, "error");
    assert.equal(tool.state.error, "Rejected by the Rocky user");
  });

  it("labels subagent messages and completes the subagent tool call", () => {
    const { session } = replay("subagent");
    const [tool] = parts(session, "tool");
    assert.equal(tool.tool, "Agent");
    assert.equal(tool.state.status, "completed");
    assert.equal(tool.state.title, "general-purpose: Answer ping");
    const sub = assistant(session).filter((m) => m.info.agent);
    assert.equal(sub.length, 1);
    assert.equal(sub[0].info.agent, "general-purpose");
    assert.equal(sub[0].parts[0].text, "pong");
    assert.deepEqual(
      assistant(session)
        .filter((m) => !m.info.agent)
        .flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text)),
      ["tool finished"],
    );
  });

  it("reports a missing login as an error instead of a reply", () => {
    const { session, translator } = replay("not-logged-in");
    const [message] = assistant(session);
    assert.equal(message.parts.length, 0);
    assert.equal(message.info.error.name, "authentication_failed");
    assert.match(message.info.error.data.message, /Not logged in/);
    assert.equal(translator.authFailed, true);
    assert.equal(assistant(session).length, 1, "the failed result adds no second error");
  });

  it("continues an existing session without duplicating parts", () => {
    const { session } = replay("text-reply");
    const again = replay("tool-approved", session).session;
    assert.equal(again.messages.length, 3);
    const ids = again.messages.flatMap((m) => m.parts.map((p) => p.id));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("RunTranslator edge cases", () => {
  const session = () => ({ id: "ses_x", messages: [], todos: [], artifacts: [] });

  it("marks unfinished tools and reports an abort", () => {
    const s = session();
    const t = new RunTranslator(s);
    t.handle({ type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "sleep 100" } }] } });
    t.finish({ aborted: true, code: null, signal: "SIGINT" });
    assert.equal(s.messages[0].parts[0].state.status, "error");
    assert.equal(s.messages[0].parts[0].state.error, "Stopped by the user.");
    assert.equal(s.messages[0].info.error.name, "MessageAbortedError");
  });

  it("reports a process that exits without a result", () => {
    const s = session();
    new RunTranslator(s).finish({ code: 1 });
    assert.match(s.messages[0].info.error.data.message, /exited unexpectedly \(exit code 1\)/);
  });

  it("reports a binary that cannot start", () => {
    const s = session();
    new RunTranslator(s).finish({ spawnError: "spawn claude ENOENT" });
    assert.match(s.messages[0].info.error.data.message, /could not be started: spawn claude ENOENT/);
  });

  it("explains result errors without text", () => {
    const s = session();
    const t = new RunTranslator(s);
    t.handle({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Working" }] } });
    t.handle({ type: "result", subtype: "error_max_turns", is_error: true });
    assert.match(s.messages[0].info.error.data.message, /maximum number of turns/);
  });

  it("tracks API retries as the session status", () => {
    const t = new RunTranslator(session(), { now: () => 1000 });
    t.handle({ type: "system", subtype: "api_retry", attempt: 2, error: "rate_limit", error_status: 429, retry_delay_ms: 500 });
    assert.deepEqual(t.retry, { type: "retry", attempt: 2, message: "rate_limit (HTTP 429)", next: 1500 });
    t.handle({ type: "stream_event", event: { type: "message_start", message: { id: "msg_2" } } });
    assert.equal(t.retry, null);
  });

  it("keeps the task list and written files", () => {
    const s = session();
    const t = new RunTranslator(s);
    t.handle({
      type: "assistant",
      message: {
        id: "msg_1",
        content: [
          { type: "tool_use", id: "tu_1", name: "TodoWrite", input: { todos: [{ content: "Query logs", status: "in_progress", activeForm: "Querying" }] } },
          { type: "tool_use", id: "tu_2", name: "Write", input: { file_path: "/workspace/artifacts/rca.md", content: "x" } },
          { type: "tool_use", id: "tu_3", name: "Edit", input: { file_path: "/workspace/artifacts/rca.md" } },
        ],
      },
    });
    assert.deepEqual(s.todos, [{ content: "Query logs", status: "in_progress" }]);
    assert.deepEqual(s.artifacts, [{ file: "/workspace/artifacts/rca.md" }]);
    assert.deepEqual(
      s.messages[0].parts.map((p) => p.id),
      ["prt_1_0", "prt_1_1", "prt_1_2"],
    );
  });

  it("truncates very large tool output", () => {
    const s = session();
    const t = new RunTranslator(s);
    t.handle({ type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/x" } }] } });
    t.handle({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "a".repeat(150_000) }] } });
    assert.match(s.messages[0].parts[0].state.output, /… \[50000 more characters\]$/);
  });

  it("normalizes message IDs and builds tool titles", () => {
    assert.equal(messageId("msg_01Abc"), "msg_01Abc");
    assert.equal(messageId("06257b2c-4387"), "msg_06257b2c-4387");
    assert.equal(messageId("a/b c"), "msg_abc");
    assert.equal(toolTitle("Agent", { subagent_type: "Explore", description: "Find files" }), "Explore: Find files");
    assert.equal(toolTitle("Read", { file_path: "/workspace/a.md" }), "/workspace/a.md");
    assert.equal(toolTitle("Bash", { command: "dtctl get workflows" }), "dtctl get workflows");
  });
});
