// End-to-end test against a running Rocky runtime: the real image with Claude
// Code, talking to the mock Anthropic API (tests/integration/mock-anthropic.mjs).
//
//   ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npm run test:integration
//
// The test is skipped when ROCKY_IT_URL is not set.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BASE = process.env.ROCKY_IT_URL;
const USER = process.env.ROCKY_IT_USERNAME ?? "rocky";
const PASSWORD = process.env.ROCKY_IT_PASSWORD ?? "";
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;
const TIMEOUT_MS = Number.parseInt(process.env.ROCKY_IT_TIMEOUT_MS ?? "120000", 10);

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: AUTH, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function waitFor(check, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let delay = 250;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const snapshot = async (id) => (await call("GET", `/rocky/v1/sessions/${id}/snapshot`)).json;
const idle = (id) => waitFor(async () => (await snapshot(id)).status[id].type === "idle", "idle session");
const assistantTexts = (snap) =>
  snap.messages.filter((m) => m.info.role === "assistant").flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text));

describe("rocky runtime end to end", { skip: !BASE }, () => {
  let sessionId;

  it("reports health with the Claude Code version", async () => {
    const res = await call("GET", "/rocky/v1/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.healthy, true);
    assert.match(res.json.agent.version, /^\d+\.\d+\.\d+$/);
    const live = await fetch(`${BASE}/rocky/v1/livez`);
    assert.equal(live.status, 200);
  });

  it("reports extended status", async () => {
    const res = await call("GET", "/rocky/v1/status");
    assert.equal(res.status, 200);
    assert.equal(res.json.agent.status, "ready");
    assert.equal(res.json.claude.status, "connected");
    assert.ok(res.json.skills.items.length > 0);
    assert.doesNotMatch(res.text, new RegExp(PASSWORD));
  });

  it("serves no route outside the Rocky API", async () => {
    assert.equal((await call("POST", "/pty", {})).status, 404);
    assert.equal((await call("GET", "/file/content?path=/etc/passwd")).status, 404);
  });

  it("creates, lists and renames a session", async () => {
    const created = await call("POST", "/rocky/v1/sessions", { title: "Rocky integration" });
    assert.equal(created.status, 200, created.text);
    sessionId = created.json.id;
    assert.match(sessionId, /^ses_/);
    const renamed = await call("PATCH", `/rocky/v1/sessions/${sessionId}`, { title: "Rocky integration (renamed)" });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.title, "Rocky integration (renamed)");
    const list = await call("GET", "/rocky/v1/sessions");
    assert.ok(list.json.some((s) => s.id === sessionId));
  });

  it("runs Claude Code and receives the mocked model response", async () => {
    const sent = await call("POST", `/rocky/v1/sessions/${sessionId}/prompt`, { text: "ping" });
    assert.equal(sent.status, 202, sent.text);
    await idle(sessionId);
    const snap = await snapshot(sessionId);
    assert.ok(assistantTexts(snap).includes("pong"), JSON.stringify(snap.messages.at(-1)));
  });

  it("continues the same conversation on the next prompt", async () => {
    await call("POST", `/rocky/v1/sessions/${sessionId}/prompt`, { text: "ping again" });
    await idle(sessionId);
    const replies = assistantTexts(await snapshot(sessionId)).filter((t) => t === "pong");
    assert.equal(replies.length, 2);
  });

  it("surfaces a tool approval and accepts a one-time approval", async () => {
    const sent = await call("POST", `/rocky/v1/sessions/${sessionId}/prompt`, { text: "Please use bash" });
    assert.equal(sent.status, 202, sent.text);
    const request = await waitFor(async () => (await snapshot(sessionId)).permissions[0] ?? null, "permission request");
    assert.equal(request.permission, "bash");
    assert.match(request.metadata.command, /rocky-integration/);
    assert.equal((await call("POST", `/rocky/v1/permissions/${request.id}/reply`, { reply: "always" })).status, 400);
    const approved = await call("POST", `/rocky/v1/permissions/${request.id}/reply`, { reply: "once" });
    assert.equal(approved.status, 200, approved.text);
    await idle(sessionId);
    const snap = await snapshot(sessionId);
    assert.ok(assistantTexts(snap).includes("tool finished"));
    const tool = snap.messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "Bash");
    assert.equal(tool.state.status, "completed", JSON.stringify(tool.state));
  });

  it("stops a run that waits for approval", async () => {
    await call("POST", `/rocky/v1/sessions/${sessionId}/prompt`, { text: "Please use bash once more" });
    await waitFor(async () => (await snapshot(sessionId)).permissions[0] ?? null, "permission request");
    assert.deepEqual((await call("POST", `/rocky/v1/sessions/${sessionId}/abort`)).json, { aborted: true });
    await idle(sessionId);
    assert.deepEqual((await snapshot(sessionId)).permissions, []);
  });

  it("deletes the session", async () => {
    assert.equal((await call("DELETE", `/rocky/v1/sessions/${sessionId}`)).status, 200);
    const list = await call("GET", "/rocky/v1/sessions");
    assert.ok(!list.json.some((s) => s.id === sessionId));
  });
});
