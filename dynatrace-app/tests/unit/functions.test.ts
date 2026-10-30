import { MIN_OPENCODE_VERSION, testConnection } from "../../src/functions/connectionTest";
import { resolveConnection } from "../../src/functions/connections";
import { AppFunctionError } from "../../src/functions/envelope";
import { handleConnectionTest, handleRuntimeProxy, handleSessionStore } from "../../src/functions/handlers";
import { callRuntime } from "../../src/functions/runtimeClient";
import { buildOperation } from "../../src/functions/runtimeOperations";
import { fakeRuntimeFetch, jsonResponse, memoryDeps, PERMISSION, SESSION } from "../fixtures";

const PASSWORD = "correct-password-123456";
const RUNTIME = { baseUrl: "https://rocky.example.com", username: "opencode", password: PASSWORD, timeoutSeconds: 30 };

describe("runtime operation allowlist", () => {
  it("rejects unknown operations and arbitrary paths", () => {
    expect(() => buildOperation("pty", {})).toThrow(AppFunctionError);
    expect(() => buildOperation("../../pty", {})).toThrow(AppFunctionError);
    expect(() => buildOperation("constructor", {})).toThrow(AppFunctionError);
  });

  it("validates IDs", () => {
    expect(() => buildOperation("getSession", { sessionId: "../pty" })).toThrow(/sessionId/);
    expect(() => buildOperation("replyPermission", { permissionId: "per_1/../x", reply: "once" })).toThrow();
  });

  it("refuses permanent approvals", () => {
    expect(() => buildOperation("replyPermission", { permissionId: "per_1", reply: "always" })).toThrow(/Permanent approvals/);
    expect(buildOperation("replyPermission", { permissionId: "per_1", reply: "once" })).toEqual({
      method: "POST",
      path: "/permission/per_1/reply",
      body: { reply: "once" },
    });
  });

  it("builds a text-only prompt", () => {
    expect(buildOperation("prompt", { sessionId: SESSION.id, text: "hi", agent: "plan" })).toEqual({
      method: "POST",
      path: `/session/${SESSION.id}/prompt_async`,
      body: { parts: [{ type: "text", text: "hi" }], agent: "plan" },
    });
    expect(() => buildOperation("prompt", { sessionId: SESSION.id, text: "" })).toThrow();
  });
});

describe("runtime client", () => {
  it("sends basic auth and refuses redirects", async () => {
    const fetch = fakeRuntimeFetch();
    await callRuntime(RUNTIME, { method: "GET", path: "/global/health" }, fetch);
    const init = fetch.calls[0].init as RequestInit & { headers: Record<string, string> };
    expect(init.headers.authorization).toBe(`Basic ${btoa(`opencode:${PASSWORD}`)}`);
    expect(init.redirect).toBe("error");
  });

  it("maps 401 without leaking the password", async () => {
    const error = await callRuntime({ ...RUNTIME, password: "wrong-password" }, { method: "GET", path: "/global/health" }, fakeRuntimeFetch()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppFunctionError);
    expect((error as AppFunctionError).code).toBe("authentication_failed");
    expect(JSON.stringify(error)).not.toContain("wrong-password");
  });

  it("explains unreachable runtimes", async () => {
    const error = (await callRuntime(RUNTIME, { method: "GET", path: "/x" }, () => Promise.reject(new TypeError("fetch failed"))).catch((e: unknown) => e)) as AppFunctionError;
    expect(error.code).toBe("runtime_unreachable");
    expect(error.extra.hint).toMatch(/allowed-outbound-connections/);
    expect(error.extra.hint).toMatch(/EdgeConnect/);
  });

  it("times out", async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const error = (await callRuntime({ ...RUNTIME, timeoutSeconds: 1 }, { method: "GET", path: "/x" }, hanging).catch((e: unknown) => e)) as AppFunctionError;
    expect(error.code).toBe("timeout");
  });
});

describe("connection resolution", () => {
  it("resolves an ad-hoc connection for testing before saving", async () => {
    const resolved = await resolveConnection({ adHoc: { runtimeUrl: "https://rocky.example.com/", username: "opencode", password: PASSWORD } }, memoryDeps(fakeRuntimeFetch()));
    expect(resolved.runtime.baseUrl).toBe("https://rocky.example.com");
    expect(resolved.connectionId).toBeNull();
  });

  it("rejects plain HTTP to remote hosts", async () => {
    await expect(resolveConnection({ adHoc: { runtimeUrl: "http://rocky.example.com", username: "opencode", password: "x" } }, memoryDeps(fakeRuntimeFetch()))).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("reads the owner-only secret for a saved connection", async () => {
    const resolved = await resolveConnection({ connectionId: "conn-object-0001" }, memoryDeps(fakeRuntimeFetch()));
    expect(resolved.runtime.password).toBe(PASSWORD);
    expect(resolved.displayName).toBe("Test runtime");
  });

  it("does not reveal whether someone else's connection exists", async () => {
    await expect(resolveConnection({ connectionId: "conn-object-9999" }, memoryDeps(fakeRuntimeFetch()))).rejects.toMatchObject({ code: "connection_not_found" });
  });

  it("requires the password for memory-only connections", async () => {
    const deps = memoryDeps(fakeRuntimeFetch(), {
      connection: { displayName: "x", runtimeUrl: "https://rocky.example.com", username: "opencode", authMode: "memory-only" },
    });
    await expect(resolveConnection({ connectionId: "conn-object-0001" }, deps)).rejects.toMatchObject({ code: "password_required" });
    const ok = await resolveConnection({ connectionId: "conn-object-0001", password: PASSWORD }, deps);
    expect(ok.runtime.password).toBe(PASSWORD);
  });

  it("reads Credential Vault entries", async () => {
    const deps = memoryDeps(fakeRuntimeFetch(), {
      connection: { displayName: "x", runtimeUrl: "https://rocky.example.com", username: "ignored", authMode: "credential-vault", credentialVaultId: "CREDENTIALS_VAULT-ABC123" },
    });
    const resolved = await resolveConnection({ connectionId: "conn-object-0001" }, deps);
    expect(resolved.runtime.password).toBe(PASSWORD);
  });
});

describe("connection test", () => {
  it("passes every step against a healthy runtime with the gateway", async () => {
    const result = await testConnection(RUNTIME, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.id, s.status])).toEqual([
      ["url", "pass"],
      ["reachability", "pass"],
      ["authentication", "pass"],
      ["health", "pass"],
      ["version", "pass"],
      ["gateway", "pass"],
      ["capabilities", "pass"],
    ]);
    expect(result.opencodeVersion).toBe("1.19.5");
    expect(MIN_OPENCODE_VERSION).toBe("1.19.0");
  });

  it("reports authentication failures and skips the rest", async () => {
    const result = await testConnection({ ...RUNTIME, password: "nope" }, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.id === "authentication")?.status).toBe("fail");
    expect(result.steps.find((s) => s.id === "health")?.status).toBe("skip");
  });

  it("reports unreachable runtimes", async () => {
    const result = await testConnection(RUNTIME, memoryDeps(() => Promise.reject(new TypeError("fetch failed"))));
    expect(result.steps.find((s) => s.id === "reachability")?.status).toBe("fail");
    expect(result.steps.filter((s) => s.status === "skip")).toHaveLength(4);
  });

  it("flags old or incompatible runtimes", async () => {
    const fetch = fakeRuntimeFetch({
      "GET /global/health": () => jsonResponse(200, { healthy: true, version: "1.0.3" }),
      "GET /rocky/v1/status": () => jsonResponse(404, { error: "route_not_allowed" }),
      "GET /permission": () => jsonResponse(404, {}),
    });
    const result = await testConnection(RUNTIME, memoryDeps(fetch));
    expect(result.steps.find((s) => s.id === "version")?.status).toBe("warn");
    expect(result.steps.find((s) => s.id === "gateway")?.status).toBe("warn");
    expect(result.steps.find((s) => s.id === "capabilities")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });
});

describe("handlers", () => {
  it("returns a combined session snapshot", async () => {
    const result = await handleRuntimeProxy(
      { connection: { connectionId: "conn-object-0001" }, operation: "sessionSnapshot", params: { sessionId: SESSION.id, limit: 30 } },
      memoryDeps(fakeRuntimeFetch()),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { messages: unknown[]; permissions: unknown[]; children: unknown[] };
      expect(data.messages).toHaveLength(3);
      expect(data.permissions).toEqual([PERMISSION]);
      expect(data.children).toEqual([]);
    }
  });

  it("never throws and never echoes credentials", async () => {
    const result = await handleConnectionTest({ connection: { adHoc: { runtimeUrl: "notaurl", username: "opencode", password: "super-secret-value" } } }, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(await handleRuntimeProxy("nonsense", memoryDeps(fakeRuntimeFetch()))).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(await handleSessionStore({ action: "drop-table" }, memoryDeps(fakeRuntimeFetch()))).toMatchObject({ ok: false, error: { code: "unknown_action" } });
  });
});
