// End-to-end test against a running Rocky gateway backed by a real OpenCode
// server configured with the mock model provider (tests/integration/mock-llm.mjs).
//
//   ROCKY_IT_URL=http://127.0.0.1:4096 ROCKY_IT_PASSWORD=... npm run test:integration
//
// The test is skipped when ROCKY_IT_URL is not set.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BASE = process.env.ROCKY_IT_URL;
const USER = process.env.ROCKY_IT_USERNAME ?? "opencode";
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

function assistantTexts(messages) {
  return messages
    .filter((m) => m.info.role === "assistant")
    .flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text));
}

describe("rocky runtime end to end", { skip: !BASE }, () => {
  let sessionId;

  it("reports health through the gateway", async () => {
    const res = await call("GET", "/global/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.healthy, true);
    const live = await fetch(`${BASE}/rocky/v1/livez`);
    assert.equal(live.status, 200);
  });

  it("reports extended status", async () => {
    const res = await call("GET", "/rocky/v1/status");
    assert.equal(res.status, 200);
    assert.equal(res.json.opencode.status, "ready");
    assert.ok(res.json.skills.items.length > 0);
    assert.doesNotMatch(res.text, new RegExp(PASSWORD));
  });

  it("blocks terminal access on the real server", async () => {
    assert.equal((await call("POST", "/pty", {})).status, 403);
    assert.equal((await call("GET", "/file/content?path=/etc/passwd")).status, 404);
  });

  it("creates, lists and renames an ephemeral session", async () => {
    const created = await call("POST", "/session", { title: "Rocky integration", permission: [{ permission: "*", pattern: "*", action: "allow" }] });
    assert.equal(created.status, 200, created.text);
    sessionId = created.json.id;
    assert.match(sessionId, /^ses/);
    const renamed = await call("PATCH", `/session/${sessionId}`, { title: "Rocky integration (renamed)" });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.title, "Rocky integration (renamed)");
    const list = await call("GET", "/session");
    assert.ok(list.json.some((s) => s.id === sessionId));
  });

  it("sends a prompt and receives the mocked model response", async () => {
    const sent = await call("POST", `/session/${sessionId}/prompt_async`, { parts: [{ type: "text", text: "ping" }] });
    assert.equal(sent.status, 204, sent.text);
    const texts = await waitFor(async () => {
      const res = await call("GET", `/session/${sessionId}/message`);
      const found = assistantTexts(res.json ?? []);
      return found.some((t) => t.includes("pong")) ? found : null;
    }, "assistant reply");
    assert.ok(texts.some((t) => t.includes("pong")));
  });

  it("surfaces a tool permission request and accepts a one-time approval", async () => {
    const sent = await call("POST", `/session/${sessionId}/prompt_async`, { parts: [{ type: "text", text: "Please use bash" }] });
    assert.equal(sent.status, 204, sent.text);
    const request = await waitFor(async () => {
      const res = await call("GET", "/permission");
      return (res.json ?? []).find((p) => p.sessionID === sessionId) ?? null;
    }, "permission request");
    assert.equal(request.permission, "bash");
    assert.equal((await call("POST", `/permission/${request.id}/reply`, { reply: "always" })).status, 400);
    const approved = await call("POST", `/permission/${request.id}/reply`, { reply: "once" });
    assert.equal(approved.status, 200, approved.text);
    const texts = await waitFor(async () => {
      const res = await call("GET", `/session/${sessionId}/message`);
      const found = assistantTexts(res.json ?? []);
      return found.some((t) => t.includes("tool finished")) ? found : null;
    }, "tool completion");
    assert.ok(texts.length > 0);
  });

  it("aborts and deletes the session", async () => {
    assert.equal((await call("POST", `/session/${sessionId}/abort`)).status, 200);
    assert.equal((await call("DELETE", `/session/${sessionId}`)).status, 200);
    const list = await call("GET", "/session");
    assert.ok(!list.json.some((s) => s.id === sessionId));
  });
});
