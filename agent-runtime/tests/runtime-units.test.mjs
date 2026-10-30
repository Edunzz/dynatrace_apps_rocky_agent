// Unit tests for the permission registry, the MCP permission helper, the
// Claude Code command line and environment, and prepare-claude.mjs.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { approveApiKey } from "../scripts/prepare-claude.mjs";
import { DEFAULT_DISALLOWED_TOOLS, loadConfig } from "../src/gateway/config.mjs";
import { createHandler } from "../src/gateway/mcp-permission.mjs";
import { describePermission, PermissionRegistry } from "../src/gateway/permissions.mjs";
import { buildArgs, buildEnv, titleFrom } from "../src/gateway/runner.mjs";
import { SessionStore } from "../src/gateway/sessions.mjs";

describe("PermissionRegistry", () => {
  it("approves once with the original input", async () => {
    const settled = [];
    const registry = new PermissionRegistry({ onSettled: (entry, decision, reason) => settled.push(reason) });
    const { id, decision } = registry.request({ sessionId: "ses_1", runId: "r1", toolName: "Bash", input: { command: "ls" }, toolUseId: "tu_1" });
    assert.match(id, /^per_[0-9a-f]{24}$/);
    assert.equal(registry.list("ses_1").length, 1);
    assert.equal(registry.list("ses_2").length, 0);
    registry.reply(id, "once");
    assert.deepEqual(await decision, { behavior: "allow", updatedInput: { command: "ls" } });
    assert.deepEqual(settled, ["approved"]);
    assert.equal(registry.reply(id, "once"), null, "an answered request is gone");
  });

  it("denies on rejection, timeout and when the run ends", async () => {
    const registry = new PermissionRegistry({ timeoutMs: 20 });
    const rejected = registry.request({ sessionId: "s", runId: "r1", toolName: "Bash", input: {} });
    registry.reply(rejected.id, "reject", "too risky");
    assert.deepEqual(await rejected.decision, { behavior: "deny", message: "Rejected by the user: too risky" });
    const timedOut = registry.request({ sessionId: "s", runId: "r1", toolName: "Bash", input: {} });
    assert.equal((await timedOut.decision).behavior, "deny");
    const cancelled = registry.request({ sessionId: "s", runId: "r2", toolName: "Bash", input: {} });
    registry.cancelRun("r2", "Stopped by the user.");
    assert.deepEqual(await cancelled.decision, { behavior: "deny", message: "Stopped by the user." });
  });

  it("describes tool calls the way the app renders them", () => {
    assert.deepEqual(describePermission("Bash", { command: "dtctl apply -f x.yaml", description: "Apply" }), {
      permission: "bash",
      patterns: ["dtctl apply -f x.yaml"],
      metadata: { command: "dtctl apply -f x.yaml", description: "Apply" },
    });
    assert.equal(describePermission("Write", { file_path: "/workspace/a.md" }).permission, "edit");
    assert.equal(describePermission("WebFetch", { url: "https://example.com" }).patterns[0], "https://example.com");
    assert.equal(describePermission("mcp__x__y", { a: 1 }).permission, "mcp__x__y");
  });
});

describe("mcp-permission.mjs", () => {
  const run = { url: "http://127.0.0.1:1", secret: "s", runId: "r", sessionId: "ses" };

  it("answers the MCP handshake and lists the approve tool", async () => {
    const handle = createHandler(run, async () => ({ behavior: "allow", updatedInput: {} }));
    const init = await handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25" } });
    assert.equal(init.result.protocolVersion, "2025-11-25");
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    const list = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      ["approve"],
    );
    const unknown = await handle({ jsonrpc: "2.0", id: "probe", method: "server/discover" });
    assert.equal(unknown.error.code, -32601);
  });

  it("returns the gateway decision as JSON text", async () => {
    let asked;
    const handle = createHandler(run, async (_run, args) => {
      asked = args;
      return { behavior: "deny", message: "no" };
    });
    const res = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "approve", arguments: { tool_name: "Bash", input: { command: "rm x" }, tool_use_id: "tu" } },
    });
    assert.deepEqual(JSON.parse(res.result.content[0].text), { behavior: "deny", message: "no" });
    assert.equal(asked.tool_name, "Bash");
  });

  it("denies when the gateway cannot be reached", async () => {
    const { askGateway } = await import("../src/gateway/mcp-permission.mjs");
    const decision = await askGateway({ ...run, url: "http://127.0.0.1:9" }, { tool_name: "Bash", input: {} });
    assert.equal(decision.behavior, "deny");
  });
});

describe("Claude Code command line and environment", () => {
  const config = loadConfig({
    ROCKY_SERVER_PASSWORD: "p".repeat(20),
    ROCKY_MODEL: "sonnet",
    PATH: "/usr/bin",
    HOME: "/home/rocky",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
    DT_PLATFORM_TOKEN: "dt0s16.secret",
    ROCKY_SERVER_USERNAME: "rocky",
    SOME_OTHER_SECRET: "x",
  });

  it("starts a new conversation, then resumes it", () => {
    const first = buildArgs({ session: { started: false, claudeSessionId: "u-1" }, config, overlay: "", mcpConfigFile: "/tmp/m.json" });
    assert.deepEqual(first.slice(-2), ["--session-id", "u-1"]);
    assert.ok(!first.includes("--append-system-prompt"), "no overlay, no extra system text");
    assert.equal(first[first.indexOf("--model") + 1], "sonnet");
    assert.equal(first[first.indexOf("--disallowedTools") + 1], DEFAULT_DISALLOWED_TOOLS.join(","));
    assert.equal(first[first.indexOf("--permission-prompt-tool") + 1], "mcp__rocky__approve");
    const next = buildArgs({ session: { started: true, claudeSessionId: "u-1" }, config, overlay: "Be brief.", mcpConfigFile: "/tmp/m.json" });
    assert.deepEqual(next.slice(-2), ["--resume", "u-1"]);
    assert.match(next[next.indexOf("--append-system-prompt") + 1], /## User policy overlay\n\nBe brief\./);
  });

  it("lets a prompt choose the model and the effort", () => {
    const session = { started: true, claudeSessionId: "u-1" };
    const base = { session, config, overlay: "", mcpConfigFile: "/tmp/m.json" };
    const chosen = buildArgs({ ...base, options: { model: "opus", effort: "xhigh" } });
    assert.equal(chosen[chosen.indexOf("--model") + 1], "opus", "wins over ROCKY_MODEL");
    assert.equal(chosen[chosen.indexOf("--effort") + 1], "xhigh");
    const plain = buildArgs(base);
    assert.equal(plain[plain.indexOf("--model") + 1], "sonnet", "ROCKY_MODEL stays the default");
    assert.ok(!plain.includes("--effort"), "no effort unless chosen");
  });

  it("passes only allowlisted variables and the fixed settings", () => {
    const env = buildEnv(config);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat01-x");
    assert.equal(env.PATH, "/usr/bin");
    for (const name of ["DT_PLATFORM_TOKEN", "ROCKY_SERVER_PASSWORD", "SOME_OTHER_SECRET", "ROCKY_SERVER_USERNAME"]) {
      assert.equal(env[name], undefined, name);
    }
    assert.equal(env.CLAUDE_CONFIG_DIR, join("/home/rocky", ".claude"));
    assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, undefined, "off by default");
    const scrubbed = buildEnv(loadConfig({ ROCKY_SERVER_PASSWORD: "x", ROCKY_SUBPROCESS_ENV_SCRUB: "true" }));
    assert.equal(scrubbed.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, "1");
    assert.equal(env.DISABLE_AUTOUPDATER, "1");
    assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
    assert.equal(Number(env.MCP_TOOL_TIMEOUT) > config.claude.permissionTimeoutMs, true);
  });

  it("validates the model name and parses the tool list", () => {
    assert.throws(() => loadConfig({ ROCKY_SERVER_PASSWORD: "x", ROCKY_MODEL: "sonnet; rm -rf /" }), /ROCKY_MODEL/);
    const custom = loadConfig({ ROCKY_SERVER_PASSWORD: "x", ROCKY_DISALLOWED_TOOLS: "WebSearch, WebFetch" });
    assert.deepEqual(custom.claude.disallowedTools, ["WebSearch", "WebFetch"]);
    assert.deepEqual(loadConfig({ ROCKY_SERVER_PASSWORD: "x", ROCKY_DISALLOWED_TOOLS: "" }).claude.disallowedTools, []);
    assert.throws(() => loadConfig({}), /ROCKY_SERVER_PASSWORD is required/);
  });

  it("names sessions after the first line of the prompt", () => {
    assert.equal(titleFrom("  Investigate   P-1\nDetails"), "Investigate P-1");
    assert.equal(titleFrom("x".repeat(100)).length, 80);
  });
});

describe("SessionStore", () => {
  it("creates, renames and reloads sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rocky-store-"));
    const store = new SessionStore({ dir: join(dir, "sessions"), claudeConfigDir: join(dir, "claude") });
    await store.load();
    const session = store.create({ title: "One" });
    store.rename(session.id, "Two");
    await store.flush();
    const again = new SessionStore({ dir: join(dir, "sessions"), claudeConfigDir: join(dir, "claude") });
    assert.equal(await again.load(), 1);
    assert.equal(again.get(session.id).title, "Two");
    assert.equal(again.list()[0].id, session.id);
    assert.throws(() => again.get("ses_missing"), { code: "session_not_found" });
  });
});

describe("prepare-claude.mjs", () => {
  it("approves ANTHROPIC_API_KEY by its last 20 characters", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const state = approveApiKey({ customApiKeyResponses: { approved: [], rejected: [key.slice(-20)] }, other: 1 }, key);
    assert.deepEqual(state.customApiKeyResponses, { approved: [key.slice(-20)], rejected: [] });
    assert.equal(state.other, 1);
    assert.doesNotMatch(JSON.stringify(state), /sk-ant-api03/, "the full key is never stored");
    assert.deepEqual(approveApiKey(state, key).customApiKeyResponses.approved, [key.slice(-20)], "idempotent");
    assert.deepEqual(approveApiKey({}, ""), {});
  });
});
