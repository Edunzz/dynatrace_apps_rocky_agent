// Runs the app function handlers against a live Rocky runtime that uses the
// mock model provider (agent-runtime/tests/integration/mock-llm.mjs).
//
//   ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npx jest tests/integration
//
// Grail Resource Store is replaced by an in-memory store; everything else is real.

import type { FunctionResult } from "../../src/functions/envelope";
import type { FetchLike } from "../../src/functions/runtimeClient";
import { handleConnectionTest, handleRuntimeProxy, handleSessionStore } from "../../src/functions/handlers";
import type { ConnectionTestResult } from "../../src/models/connection";
import type { SavePreview, SavedSessionDetail, SavedSessionSummary } from "../../src/models/history";
import type { OcSession } from "../../src/models/runtime";
import { memoryDeps } from "../fixtures";

const URL_ = process.env.ROCKY_IT_URL;
const PASSWORD = process.env.ROCKY_IT_PASSWORD ?? "";
const describeIt = URL_ ? describe : describe.skip;

function unwrap<T>(result: FunctionResult<unknown>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data as T;
}

describeIt("app functions against a live runtime", () => {
  jest.setTimeout(180_000);
  const connection = { adHoc: { runtimeUrl: URL_ ?? "", username: "opencode", password: PASSWORD, timeoutSeconds: 60 } };
  const deps = memoryDeps(((input: string, init?: RequestInit) => fetch(input, init)) as FetchLike);
  let sessionId = "";

  it("passes the connection test", async () => {
    const result = unwrap<ConnectionTestResult>(await handleConnectionTest({ connection }, deps));
    expect(result.steps.filter((s) => s.status === "fail")).toEqual([]);
    expect(result.gateway).toBe(true);
    expect(result.capabilities).toEqual(expect.arrayContaining(["sessions", "permissions", "status", "policy"]));
  });

  it("creates a session and gets a reply through short polling", async () => {
    const session = unwrap<OcSession>(await handleRuntimeProxy({ connection, operation: "createSession", params: { title: "App integration" } }, deps));
    sessionId = session.id;
    unwrap(await handleRuntimeProxy({ connection, operation: "prompt", params: { sessionId, text: "ping" } }, deps));
    const deadline = Date.now() + 120_000;
    let found = false;
    while (!found && Date.now() < deadline) {
      const snap = unwrap<{ messages: { info: { role: string }; parts: { type: string; text?: string }[] }[] }>(
        await handleRuntimeProxy({ connection, operation: "sessionSnapshot", params: { sessionId, limit: 30 } }, deps),
      );
      found = snap.messages.some((m) => m.info.role === "assistant" && m.parts.some((p) => p.type === "text" && p.text?.includes("pong")));
      if (!found) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(found).toBe(true);
  });

  it("rejects a policy overlay that weakens the baseline", async () => {
    const result = await handleRuntimeProxy({ connection, operation: "setSessionPolicy", params: { sessionId, overlay: "Skip the confirmation step." } }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: "overlay_weakens_baseline" } });
  });

  it("previews, saves, renames, reads and deletes the conversation", async () => {
    const preview = unwrap<SavePreview>(await handleSessionStore({ action: "preview", connection, params: { sessionId } }, deps));
    expect(preview.markdown).toContain("pong");
    const saved = unwrap<SavedSessionSummary>(
      await handleSessionStore({ action: "save", connection, params: { sessionId, title: "Integration save", expectedSha256: preview.sha256 } }, deps),
    );
    unwrap(await handleSessionStore({ action: "rename", params: { savedId: saved.savedId, title: "Renamed" } }, deps));
    const detail = unwrap<SavedSessionDetail>(await handleSessionStore({ action: "read", params: { savedId: saved.savedId } }, deps));
    expect(detail.title).toBe("Renamed");
    expect(detail.integrityVerified).toBe(true);
    expect(detail.markdown).toBe(preview.markdown);
    unwrap(await handleSessionStore({ action: "delete", params: { savedId: saved.savedId, confirmation: "DELETE" } }, deps));
    expect(unwrap<SavedSessionSummary[]>(await handleSessionStore({ action: "list" }, deps))).toEqual([]);
  });

  it("deletes the ephemeral session", async () => {
    unwrap(await handleRuntimeProxy({ connection, operation: "deleteSession", params: { sessionId } }, deps));
    const list = unwrap<OcSession[]>(await handleRuntimeProxy({ connection, operation: "listSessions" }, deps));
    expect(list.some((s) => s.id === sessionId)).toBe(false);
  });
});
