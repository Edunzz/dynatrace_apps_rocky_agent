// Fixtures shaped after real Rocky runtime responses (Claude Code translated by the gateway).
import type { PlatformDeps, UploadLookupArgs } from "../src/functions/deps";
import type { FetchLike } from "../src/functions/runtimeClient";
import type { OcMessage, OcPermissionRequest, OcSession } from "../src/models/runtime";

export const SESSION: OcSession = {
  id: "ses_6a1f2c3d-4b5e-4f60-8a71-9b2c3d4e5f60",
  title: "Checkout latency RCA",
  time: { created: 1793323833000, updated: 1793323836721 },
};

export const MESSAGES: OcMessage[] = [
  {
    info: { id: "msg_1", sessionID: SESSION.id, role: "user", time: { created: 1793323834023 } },
    parts: [{ id: "prt_1", sessionID: SESSION.id, messageID: "msg_1", type: "text", text: "Please use bash" }],
  },
  {
    info: {
      id: "msg_2",
      sessionID: SESSION.id,
      role: "assistant",
      time: { created: 1793323834044, completed: 1793323836632 },
      modelID: "claude-sonnet-5-5",
      providerID: "anthropic",
      finish: "tool_use",
    },
    parts: [
      { id: "prt_2", sessionID: SESSION.id, messageID: "msg_2", type: "step-start" },
      { id: "prt_r", sessionID: SESSION.id, messageID: "msg_2", type: "reasoning", text: "HIDDEN-REASONING-should-never-be-saved" },
      {
        id: "prt_3",
        sessionID: SESSION.id,
        messageID: "msg_2",
        type: "tool",
        callID: "toolu_01",
        tool: "Bash",
        state: {
          status: "completed",
          input: { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' https://x.example.com", description: "Call API" },
          output: "rocky-integration\nDT_PLATFORM_TOKEN=dt0s16.ABCDEFGH12345678.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          title: "Call API",
        },
      },
      { id: "prt_4", sessionID: SESSION.id, messageID: "msg_2", type: "step-finish" },
    ],
  },
  {
    info: {
      id: "msg_3",
      sessionID: SESSION.id,
      role: "assistant",
      time: { created: 1793323836637, completed: 1793323836721 },
      modelID: "claude-sonnet-5-5",
      providerID: "anthropic",
    },
    parts: [{ id: "prt_5", sessionID: SESSION.id, messageID: "msg_3", type: "text", text: "tool finished — see ```code``` blocks" }],
  },
];

export const PERMISSION: OcPermissionRequest = {
  id: "per_0123456789abcdef01234567",
  sessionID: SESSION.id,
  permission: "bash",
  patterns: ["echo rocky-integration > marker.txt"],
  metadata: { command: "echo rocky-integration > marker.txt", description: "Write a marker file" },
  always: [],
  tool: { messageID: "msg_2", callID: "toolu_01" },
};

export const STATUS = {
  schemaVersion: 2,
  checkedAt: "2026-10-30T10:00:00Z",
  runtime: { status: "connected", version: "0.2.0", nodeEnv: "production", gateway: "enabled", uptimeSeconds: 10, activeRuns: 0 },
  agent: { status: "ready", name: "Claude Code", version: "2.1.308" },
  claude: { status: "connected", authMethod: "claude.ai", apiProvider: "firstParty", model: null, loginCommand: "docker compose run --rm rocky-agent login" },
  dynatrace: { status: "connected", environmentHost: "abc12345.apps.dynatrace.com", checkedAt: null, detail: null },
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Minimal fake of the Rocky gateway for function tests.
export function fakeRuntimeFetch(overrides: Record<string, () => Response> = {}): FetchLike & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    if (overrides[key]) return overrides[key]();
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (path === "/rocky/v1/livez") return jsonResponse(200, { status: "ok" });
    if (auth !== `Basic ${btoa("rocky:correct-password-123456")}`) return jsonResponse(401, { error: "unauthorized" });
    const api = "/rocky/v1";
    const session = `${api}/sessions/${SESSION.id}`;
    if (path === `${api}/health`) return jsonResponse(200, { healthy: true, version: "0.2.0", agent: { name: "Claude Code", version: "2.1.308" } });
    if (path === `${api}/status`) return jsonResponse(200, STATUS);
    if (path === `${api}/sessions` && (init?.method ?? "GET") === "GET") return jsonResponse(200, [SESSION]);
    if (path === `${api}/sessions` && init?.method === "POST") return jsonResponse(200, { ...SESSION, title: JSON.parse(String(init.body)).title });
    if (path === session && (init?.method ?? "GET") === "GET") return jsonResponse(200, SESSION);
    if (path === `${session}/messages`) return jsonResponse(200, MESSAGES);
    if (path === `${session}/snapshot`) {
      return jsonResponse(200, { messages: MESSAGES, status: { [SESSION.id]: { type: "idle" } }, permissions: [PERMISSION], children: [], todos: [] });
    }
    if (path === `${api}/sessions/status`) return jsonResponse(200, {});
    if (path === `${api}/permissions`) return jsonResponse(200, [PERMISSION]);
    if (path === `${api}/skills`) return jsonResponse(200, []);
    return jsonResponse(404, { error: "route_not_allowed", message: "Route is not available" });
  }) as FetchLike & { calls: { url: string; init?: RequestInit }[] };
  fn.calls = calls;
  return fn;
}

export interface MemoryStore {
  files: Map<string, UploadLookupArgs>;
  logs: Record<string, unknown>[];
}

// PlatformDeps with an in-memory Resource Store that parses the CSV the same
// way the verified DPL pattern does (quoted fields, doubled quotes).
export function memoryDeps(fetchImpl: FetchLike, opts: { userId?: string; connection?: Record<string, unknown> } = {}): PlatformDeps & { store: MemoryStore } {
  const store: MemoryStore = { files: new Map(), logs: [] };
  let clock = Date.parse("2026-10-29T10:15:00Z");
  return {
    store,
    fetch: fetchImpl,
    async getConnectionObject(objectId) {
      if (objectId !== "conn-object-0001") throw new Error("not found");
      return {
        value: opts.connection ?? {
          displayName: "Test runtime",
          runtimeUrl: "https://rocky.example.com",
          username: "rocky",
          authMode: "settings-secret",
          password: "correct-password-123456",
          timeoutSeconds: 30,
        },
      };
    },
    async getVaultCredentials() {
      return { username: "rocky", password: "correct-password-123456" };
    },
    async currentUser() {
      return { userId: opts.userId ?? "11111111-2222-3333-4444-555555555555" };
    },
    async uploadLookup(args) {
      if (store.files.has(args.filePath) && !args.overwrite) {
        const { AppFunctionError } = await import("../src/functions/envelope");
        throw new AppFunctionError("already_exists", "exists", { status: 409 });
      }
      store.files.set(args.filePath, args);
    },
    async deleteLookup(filePath) {
      store.files.delete(filePath);
    },
    async query(dql) {
      const load = /^load "([^"]+)"$/.exec(dql.trim());
      if (load) {
        const file = store.files.get(load[1]);
        return file ? [parseSingleRowCsv(file.content)] : [];
      }
      const prefix = /startsWith\(name, "([^"]+)"\)/.exec(dql)?.[1];
      if (prefix) {
        return [...store.files.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, f]) => ({ name, display_name: f.displayName, "modified.timestamp": "2026-10-29T10:16:00Z" }));
      }
      return [];
    },
    log(event) {
      store.logs.push(event);
    },
    now() {
      clock += 1000;
      return new Date(clock);
    },
  };
}

export function parseSingleRowCsv(content: string): Record<string, string> {
  const fields: string[][] = [[]];
  let i = 0;
  let row = 0;
  while (i < content.length) {
    if (content[i] === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (content[i] === '"' && content[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (content[i] === '"') {
          i += 1;
          break;
        } else {
          value += content[i];
          i += 1;
        }
      }
      fields[row].push(value);
    } else if (content[i] === ",") {
      i += 1;
    } else if (content[i] === "\n") {
      i += 1;
      row += 1;
      fields[row] = [];
    } else {
      throw new Error(`unexpected character ${JSON.stringify(content[i])} at ${i}`);
    }
  }
  const [header, values] = fields;
  return Object.fromEntries(header.map((h, idx) => [h, values[idx]]));
}
