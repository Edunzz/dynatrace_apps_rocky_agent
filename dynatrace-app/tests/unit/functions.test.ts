import { DEFAULT_PASSWORD_WARNING, MIN_CLAUDE_CODE_VERSION, testConnection } from "../../src/functions/connectionTest";
import { resolveConnection } from "../../src/functions/connections";
import { AppFunctionError } from "../../src/functions/envelope";
import { handleConnectionTest, handleRuntimeProxy, handleSessionStore } from "../../src/functions/handlers";
import { callRuntime } from "../../src/functions/runtimeClient";
import { buildOperation } from "../../src/functions/runtimeOperations";
import { fakeRuntimeFetch, jsonResponse, memoryDeps, PERMISSION, SESSION, STATUS } from "../fixtures";

const PASSWORD = "correct-password-123456";
const RUNTIME = { baseUrl: "https://rocky.example.com", username: "rocky", password: PASSWORD, timeoutSeconds: 30 };

describe("runtime operation allowlist", () => {
  it("rejects unknown operations and arbitrary paths", () => {
    expect(() => buildOperation("pty", {})).toThrow(AppFunctionError);
    expect(() => buildOperation("../../pty", {})).toThrow(AppFunctionError);
    expect(() => buildOperation("constructor", {})).toThrow(AppFunctionError);
  });

  it("validates IDs", () => {
    expect(() => buildOperation("getSession", { sessionId: "../pty" })).toThrow(/sessionId/);
    expect(() => buildOperation("replyPermission", { permissionId: "per_1/../x", reply: "once" })).toThrow();
    expect(() => buildOperation("getSession", { sessionId: "ses_e7591e887ffen74WiJDeGcpqvK" })).toThrow(/sessionId/);
  });

  it("refuses permanent approvals", () => {
    expect(() => buildOperation("replyPermission", { permissionId: PERMISSION.id, reply: "always" })).toThrow(/Permanent approvals/);
    expect(buildOperation("replyPermission", { permissionId: PERMISSION.id, reply: "once" })).toEqual({
      method: "POST",
      path: `/rocky/v1/permissions/${PERMISSION.id}/reply`,
      body: { reply: "once" },
    });
  });

  it("builds a text-only prompt and drops anything else", () => {
    expect(buildOperation("prompt", { sessionId: SESSION.id, text: "hi", agent: "plan", system: "x" })).toEqual({
      method: "POST",
      path: `/rocky/v1/sessions/${SESSION.id}/prompt`,
      body: { text: "hi" },
    });
    expect(() => buildOperation("prompt", { sessionId: SESSION.id, text: "" })).toThrow();
  });

  it("passes the model and thinking level chosen for a prompt", () => {
    expect(buildOperation("prompt", { sessionId: SESSION.id, text: "hi", model: "opus", effort: "xhigh" }).body).toEqual({ text: "hi", model: "opus", effort: "xhigh" });
    expect(() => buildOperation("prompt", { sessionId: SESSION.id, text: "hi", model: "--dangerously-skip-permissions --x" })).toThrow();
    expect(() => buildOperation("prompt", { sessionId: SESSION.id, text: "hi", effort: "HIGH" })).toThrow();
  });

  it("maps every operation to the Rocky API", () => {
    for (const [name, params] of [
      ["health", {}],
      ["listSessions", {}],
      ["sessionSnapshot", { sessionId: SESSION.id, limit: 30 }],
      ["artifacts", { sessionId: SESSION.id }],
      ["permissions", {}],
    ] as const) {
      expect(buildOperation(name, params).path).toMatch(/^\/rocky\/v1\//);
    }
    expect(() => buildOperation("diff", { sessionId: SESSION.id })).toThrow(AppFunctionError);
    expect(() => buildOperation("providers", {})).toThrow(AppFunctionError);
  });
});

describe("runtime client", () => {
  it("sends basic auth and refuses redirects", async () => {
    const fetch = fakeRuntimeFetch();
    await callRuntime(RUNTIME, { method: "GET", path: "/rocky/v1/health" }, fetch);
    const init = fetch.calls[0].init as RequestInit & { headers: Record<string, string> };
    expect(init.headers.authorization).toBe(`Basic ${btoa(`rocky:${PASSWORD}`)}`);
    expect(init.redirect).toBe("error");
  });

  it("maps 401 without leaking the password", async () => {
    const error = await callRuntime({ ...RUNTIME, password: "wrong-password" }, { method: "GET", path: "/rocky/v1/health" }, fakeRuntimeFetch()).catch((e: unknown) => e);
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
    const resolved = await resolveConnection({ adHoc: { runtimeUrl: "https://rocky.example.com/", username: "rocky", password: PASSWORD } }, memoryDeps(fakeRuntimeFetch()));
    expect(resolved.runtime.baseUrl).toBe("https://rocky.example.com");
    expect(resolved.connectionId).toBeNull();
  });

  it("rejects plain HTTP to remote hosts", async () => {
    await expect(resolveConnection({ adHoc: { runtimeUrl: "http://rocky.example.com", username: "rocky", password: "x" } }, memoryDeps(fakeRuntimeFetch()))).rejects.toMatchObject({ code: "invalid_url" });
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
      connection: { displayName: "x", runtimeUrl: "https://rocky.example.com", username: "rocky", authMode: "memory-only" },
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
  it("passes every step against a healthy, signed-in runtime", async () => {
    const result = await testConnection(RUNTIME, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.id, s.status])).toEqual([
      ["url", "pass"],
      ["reachability", "pass"],
      ["authentication", "pass"],
      ["agent", "pass"],
      ["claude", "pass"],
      ["capabilities", "pass"],
    ]);
    expect(result.agentVersion).toBe("2.1.308");
    expect(result.runtimeVersion).toBe("0.2.0");
    expect(MIN_CLAUDE_CODE_VERSION).toBe("2.1.300");
  });

  it("asks to change the public default password", async () => {
    const fetch = fakeRuntimeFetch({
      "GET /rocky/v1/status": () => jsonResponse(200, { ...STATUS, runtime: { ...STATUS.runtime, defaultPassword: true } }),
    });
    const result = await testConnection(RUNTIME, memoryDeps(fetch));
    const auth = result.steps.find((s) => s.id === "authentication");
    expect(auth?.status).toBe("warn");
    expect(auth?.detail).toBe(DEFAULT_PASSWORD_WARNING);
    expect(result.ok).toBe(true);
  });

  it("reports authentication failures and skips the rest", async () => {
    const result = await testConnection({ ...RUNTIME, password: "nope" }, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.id === "authentication")?.status).toBe("fail");
    expect(result.steps.find((s) => s.id === "claude")?.status).toBe("skip");
  });

  it("reports unreachable runtimes", async () => {
    const result = await testConnection(RUNTIME, memoryDeps(() => Promise.reject(new TypeError("fetch failed"))));
    expect(result.steps.find((s) => s.id === "reachability")?.status).toBe("fail");
    expect(result.steps.filter((s) => s.status === "skip")).toHaveLength(4);
  });

  it("explains how to sign in when Claude is not signed in", async () => {
    const fetch = fakeRuntimeFetch({
      "GET /rocky/v1/status": () => jsonResponse(200, { ...STATUS, claude: { ...STATUS.claude, status: "authentication_required", authMethod: "none" } }),
    });
    const result = await testConnection(RUNTIME, memoryDeps(fetch));
    const step = result.steps.find((s) => s.id === "claude");
    expect(step?.status).toBe("fail");
    expect(step?.detail).toContain("docker compose run --rm rocky-agent login");
    expect(result.ok).toBe(false);
  });

  it("flags old or incompatible runtimes", async () => {
    const fetch = fakeRuntimeFetch({
      "GET /rocky/v1/health": () => jsonResponse(200, { healthy: true, version: "0.2.0", agent: { version: "2.0.1" } }),
      "GET /rocky/v1/permissions": () => jsonResponse(404, {}),
    });
    const result = await testConnection(RUNTIME, memoryDeps(fetch));
    expect(result.steps.find((s) => s.id === "agent")?.status).toBe("warn");
    expect(result.steps.find((s) => s.id === "capabilities")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("fails when the runtime cannot run Claude Code", async () => {
    const fetch = fakeRuntimeFetch({ "GET /rocky/v1/health": () => jsonResponse(200, { healthy: true, version: "0.2.0", agent: { version: null } }) });
    const result = await testConnection(RUNTIME, memoryDeps(fetch));
    expect(result.steps.find((s) => s.id === "agent")?.status).toBe("fail");
  });
});

describe("handlers", () => {
  it("returns the session snapshot in one call", async () => {
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
    const result = await handleConnectionTest({ connection: { adHoc: { runtimeUrl: "notaurl", username: "rocky", password: "super-secret-value" } } }, memoryDeps(fakeRuntimeFetch()));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(await handleRuntimeProxy("nonsense", memoryDeps(fakeRuntimeFetch()))).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
    expect(await handleSessionStore({ action: "drop-table" }, memoryDeps(fakeRuntimeFetch()))).toMatchObject({ ok: false, error: { code: "unknown_action" } });
  });
});
