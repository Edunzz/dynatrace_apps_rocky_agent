// Allowlist of runtime operations the app may call. The browser names an
// operation; the function builds the HTTP request against the Rocky runtime
// API (/rocky/v1). Arbitrary paths are never accepted from the client.

import { AppFunctionError } from "./envelope";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface OperationRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
}

type Params = Record<string, unknown>;

const API = "/rocky/v1";
const SESSION_ID = /^ses_[0-9a-f-]{36}$/;
const PERMISSION_ID = /^per_[0-9a-f]{24}$/;
const MAX_PROMPT = 100_000;

function str(params: Params, name: string, pattern?: RegExp, max = 200): string {
  const value = params[name];
  if (typeof value !== "string" || value.length === 0 || value.length > max || (pattern && !pattern.test(value))) {
    throw new AppFunctionError("invalid_parameter", `Parameter "${name}" is missing or invalid.`);
  }
  return value;
}

function optionalInt(params: Params, name: string, min: number, max: number): number | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new AppFunctionError("invalid_parameter", `Parameter "${name}" must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const session = (p: Params) => `${API}/sessions/${encodeURIComponent(str(p, "sessionId", SESSION_ID))}`;

export const OPERATIONS = {
  health: () => ({ method: "GET", path: `${API}/health` }),
  status: () => ({ method: "GET", path: `${API}/status` }),
  refreshStatus: () => ({ method: "POST", path: `${API}/status/refresh` }),
  policy: () => ({ method: "GET", path: `${API}/policy` }),
  skills: () => ({ method: "GET", path: `${API}/skills` }),
  getSessionPolicy: (p: Params) => ({ method: "GET", path: `${session(p)}/policy` }),
  setSessionPolicy: (p: Params) => {
    const overlay = p.overlay;
    if (typeof overlay !== "string" || overlay.length > 20_000) {
      throw new AppFunctionError("invalid_parameter", "The policy overlay must be text of at most 20,000 characters.");
    }
    return { method: "PUT", path: `${session(p)}/policy`, body: { overlay } };
  },
  listSessions: (p: Params) => {
    const limit = optionalInt(p, "limit", 1, 200) ?? 100;
    return { method: "GET", path: `${API}/sessions?limit=${limit}` };
  },
  sessionStatus: () => ({ method: "GET", path: `${API}/sessions/status` }),
  createSession: (p: Params) => {
    const title = p.title === undefined ? undefined : str(p, "title", undefined, 200);
    return { method: "POST", path: `${API}/sessions`, body: title ? { title } : {} };
  },
  getSession: (p: Params) => ({ method: "GET", path: session(p) }),
  renameSession: (p: Params) => ({ method: "PATCH", path: session(p), body: { title: str(p, "title", undefined, 200) } }),
  deleteSession: (p: Params) => ({ method: "DELETE", path: session(p) }),
  messages: (p: Params) => {
    const limit = optionalInt(p, "limit", 1, 500);
    return { method: "GET", path: `${session(p)}/messages${limit ? `?limit=${limit}` : ""}` };
  },
  // One call per chat poll: messages, session status, pending approvals and tasks.
  sessionSnapshot: (p: Params) => {
    const limit = optionalInt(p, "limit", 1, 500);
    return { method: "GET", path: `${session(p)}/snapshot${limit ? `?limit=${limit}` : ""}` };
  },
  prompt: (p: Params) => ({ method: "POST", path: `${session(p)}/prompt`, body: { text: str(p, "text", undefined, MAX_PROMPT) } }),
  abort: (p: Params) => ({ method: "POST", path: `${session(p)}/abort` }),
  todo: (p: Params) => ({ method: "GET", path: `${session(p)}/todo` }),
  artifacts: (p: Params) => ({ method: "GET", path: `${session(p)}/artifacts` }),
  permissions: () => ({ method: "GET", path: `${API}/permissions` }),
  replyPermission: (p: Params) => {
    const reply = p.reply;
    if (reply !== "once" && reply !== "reject") {
      throw new AppFunctionError("invalid_parameter", "reply must be 'once' or 'reject'. Permanent approvals are not supported.");
    }
    const body: Record<string, unknown> = { reply };
    if (typeof p.message === "string" && p.message.length > 0) body.message = p.message.slice(0, 2000);
    return { method: "POST", path: `${API}/permissions/${encodeURIComponent(str(p, "permissionId", PERMISSION_ID))}/reply`, body };
  },
} satisfies Record<string, (params: Params) => OperationRequest>;

export type OperationName = keyof typeof OPERATIONS;

export function buildOperation(name: unknown, params: unknown): OperationRequest {
  if (typeof name !== "string" || !Object.hasOwn(OPERATIONS, name)) {
    throw new AppFunctionError("unknown_operation", "The requested runtime operation is not supported.");
  }
  const safeParams = params && typeof params === "object" && !Array.isArray(params) ? (params as Params) : {};
  return OPERATIONS[name as OperationName](safeParams);
}
