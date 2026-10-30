// Allowlist of runtime operations the app may call. The browser names an
// operation; the function builds the HTTP request. Arbitrary paths are never
// accepted from the client.

import { AppFunctionError } from "./envelope";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface OperationRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
}

type Params = Record<string, unknown>;

const SESSION_ID = /^ses[A-Za-z0-9_-]{1,128}$/;
const PERMISSION_ID = /^per[A-Za-z0-9_-]{1,128}$/;
const QUESTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
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

const session = (p: Params) => encodeURIComponent(str(p, "sessionId", SESSION_ID));

export const OPERATIONS = {
  health: () => ({ method: "GET", path: "/global/health" }),
  status: () => ({ method: "GET", path: "/rocky/v1/status" }),
  refreshStatus: () => ({ method: "POST", path: "/rocky/v1/status/refresh" }),
  policy: () => ({ method: "GET", path: "/rocky/v1/policy" }),
  getSessionPolicy: (p: Params) => ({ method: "GET", path: `/rocky/v1/sessions/${session(p)}/policy` }),
  setSessionPolicy: (p: Params) => {
    const overlay = p.overlay;
    if (typeof overlay !== "string" || overlay.length > 20_000) {
      throw new AppFunctionError("invalid_parameter", "The policy overlay must be text of at most 20,000 characters.");
    }
    return { method: "PUT", path: `/rocky/v1/sessions/${session(p)}/policy`, body: { overlay } };
  },
  providers: () => ({ method: "GET", path: "/provider" }),
  skills: () => ({ method: "GET", path: "/skill" }),
  agents: () => ({ method: "GET", path: "/agent" }),
  listSessions: (p: Params) => {
    const limit = optionalInt(p, "limit", 1, 200) ?? 100;
    return { method: "GET", path: `/session?roots=true&limit=${limit}` };
  },
  sessionStatus: () => ({ method: "GET", path: "/session/status" }),
  createSession: (p: Params) => {
    const title = p.title === undefined ? undefined : str(p, "title", undefined, 200);
    return { method: "POST", path: "/session", body: title ? { title } : {} };
  },
  getSession: (p: Params) => ({ method: "GET", path: `/session/${session(p)}` }),
  renameSession: (p: Params) => ({
    method: "PATCH",
    path: `/session/${session(p)}`,
    body: { title: str(p, "title", undefined, 200) },
  }),
  deleteSession: (p: Params) => ({ method: "DELETE", path: `/session/${session(p)}` }),
  messages: (p: Params) => {
    const limit = optionalInt(p, "limit", 1, 500);
    return { method: "GET", path: `/session/${session(p)}/message${limit ? `?limit=${limit}` : ""}` };
  },
  prompt: (p: Params) => {
    const text = str(p, "text", undefined, MAX_PROMPT);
    const body: Record<string, unknown> = { parts: [{ type: "text", text }] };
    if (p.agent !== undefined) {
      if (p.agent !== "build" && p.agent !== "plan") throw new AppFunctionError("invalid_parameter", "agent must be build or plan.");
      body.agent = p.agent;
    }
    return { method: "POST", path: `/session/${session(p)}/prompt_async`, body };
  },
  abort: (p: Params) => ({ method: "POST", path: `/session/${session(p)}/abort` }),
  diff: (p: Params) => ({ method: "GET", path: `/session/${session(p)}/diff` }),
  todo: (p: Params) => ({ method: "GET", path: `/session/${session(p)}/todo` }),
  children: (p: Params) => ({ method: "GET", path: `/session/${session(p)}/children` }),
  permissions: () => ({ method: "GET", path: "/permission" }),
  replyPermission: (p: Params) => {
    const reply = p.reply;
    if (reply !== "once" && reply !== "reject") {
      throw new AppFunctionError("invalid_parameter", "reply must be 'once' or 'reject'. Permanent approvals are not supported.");
    }
    const body: Record<string, unknown> = { reply };
    if (typeof p.message === "string" && p.message.length > 0) body.message = p.message.slice(0, 2000);
    return { method: "POST", path: `/permission/${encodeURIComponent(str(p, "permissionId", PERMISSION_ID))}/reply`, body };
  },
  questions: () => ({ method: "GET", path: "/question" }),
  replyQuestion: (p: Params) => {
    const answers = p.answers;
    if (!Array.isArray(answers) || !answers.every((a) => Array.isArray(a) && a.every((x) => typeof x === "string"))) {
      throw new AppFunctionError("invalid_parameter", "answers must be an array of string arrays.");
    }
    return { method: "POST", path: `/question/${encodeURIComponent(str(p, "questionId", QUESTION_ID))}/reply`, body: { answers } };
  },
  rejectQuestion: (p: Params) => ({
    method: "POST",
    path: `/question/${encodeURIComponent(str(p, "questionId", QUESTION_ID))}/reject`,
  }),
} satisfies Record<string, (params: Params) => OperationRequest>;

export type OperationName = keyof typeof OPERATIONS;

export function buildOperation(name: unknown, params: unknown): OperationRequest {
  if (typeof name !== "string" || !Object.hasOwn(OPERATIONS, name)) {
    throw new AppFunctionError("unknown_operation", "The requested runtime operation is not supported.");
  }
  const safeParams = params && typeof params === "object" && !Array.isArray(params) ? (params as Params) : {};
  return OPERATIONS[name as OperationName](safeParams);
}
