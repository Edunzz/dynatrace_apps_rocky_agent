import type { OcMessage } from "../../src/models/runtime";
import { conversationToMarkdown, fence } from "../../src/utils/markdown";
import { mergeMessages } from "../../src/utils/messages";
import { MESSAGES, SESSION } from "../fixtures";

describe("conversationToMarkdown", () => {
  const { markdown, redactions, messageCount } = conversationToMarkdown(SESSION, MESSAGES, {
    modelProvider: "mock",
    modelId: "mock-model",
    dynatraceEnvironment: "abc12345.apps.dynatrace.com",
  });

  it("includes user-visible content and tool activity", () => {
    expect(markdown).toContain("# Checkout latency RCA");
    expect(markdown).toContain("Please use bash");
    expect(markdown).toContain("**Tool `bash`** — Call API · _completed_");
    expect(markdown).toContain("tool finished");
    expect(messageCount).toBe(3);
  });

  it("never exports hidden model reasoning", () => {
    expect(markdown).not.toContain("HIDDEN-REASONING");
  });

  it("redacts secrets and authorization headers", () => {
    expect(markdown).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(markdown).not.toMatch(/dt0s16\.ABCDEFGH/);
    expect(markdown).toContain("[REDACTED]");
    expect(redactions).toBeGreaterThanOrEqual(2);
  });

  it("uses fences longer than any backtick run in the content", () => {
    expect(fence("a ```b``` c")).toMatch(/^````text\n/);
    expect(fence("plain")).toMatch(/^```text\n/);
  });

  it("truncates very long tool output", () => {
    const long: OcMessage = {
      info: { id: "msg_x", sessionID: SESSION.id, role: "assistant", time: { created: 1 } },
      parts: [
        {
          id: "prt_x",
          sessionID: SESSION.id,
          messageID: "msg_x",
          type: "tool",
          callID: "c",
          tool: "bash",
          state: { status: "completed", input: {}, output: "x".repeat(10_000), title: "big" },
        },
      ],
    };
    expect(conversationToMarkdown(SESSION, [long]).markdown).toMatch(/truncated 6000 characters/);
  });
});

describe("mergeMessages", () => {
  it("adds new messages without duplicates", () => {
    const first = mergeMessages([], MESSAGES.slice(0, 2));
    const second = mergeMessages(first.messages, MESSAGES);
    expect(second.messages.map((m) => m.info.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(second.changed).toBe(true);
    expect(mergeMessages(second.messages, MESSAGES).changed).toBe(false);
  });

  it("replaces updated parts by ID", () => {
    const streaming: OcMessage = {
      info: MESSAGES[2].info,
      parts: [{ id: "prt_5", sessionID: SESSION.id, messageID: "msg_3", type: "text", text: "tool" }],
    };
    const before = mergeMessages([], [streaming]);
    const after = mergeMessages(before.messages, [MESSAGES[2]]);
    expect(after.changed).toBe(true);
    expect(after.messages[0].parts).toHaveLength(1);
    expect((after.messages[0].parts[0] as { text: string }).text).toContain("tool finished");
  });

  it("orders by creation time", () => {
    const merged = mergeMessages([], [MESSAGES[2], MESSAGES[0], MESSAGES[1]]);
    expect(merged.messages.map((m) => m.info.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
  });
});
