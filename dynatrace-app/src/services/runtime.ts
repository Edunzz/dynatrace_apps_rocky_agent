import type { ConnectionRef, ConnectionTestResult } from "../models/connection";
import type {
  OcMessage,
  OcPermissionRequest,
  OcProviderList,
  OcSession,
  OcSessionStatus,
  RuntimePolicy,
  RuntimeStatus,
  SessionPolicy,
} from "../models/runtime";
import { callFunction } from "./functions";

export interface SessionSnapshot {
  messages: OcMessage[];
  status: Record<string, OcSessionStatus>;
  permissions: OcPermissionRequest[];
  children: OcSession[];
}

export interface FileDiff {
  file: string;
  additions?: number;
  deletions?: number;
}

export interface Todo {
  id?: string;
  content: string;
  status: string;
  priority?: string;
}

function op<T>(connection: ConnectionRef, operation: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
  return callFunction<T>("runtime-proxy", { connection, operation, params }, signal);
}

// Typed client for the runtime-proxy app function. Every call names an
// allowlisted operation; credentials are resolved inside the function.
export function runtimeApi(connection: ConnectionRef) {
  return {
    status: (signal?: AbortSignal) => op<RuntimeStatus>(connection, "status", {}, signal),
    refreshStatus: () => op<{ status: string }>(connection, "refreshStatus"),
    health: () => op<{ healthy: boolean; version: string }>(connection, "health"),
    providers: () => op<OcProviderList>(connection, "providers"),
    policy: () => op<RuntimePolicy>(connection, "policy"),
    getSessionPolicy: (sessionId: string) => op<SessionPolicy>(connection, "getSessionPolicy", { sessionId }),
    setSessionPolicy: (sessionId: string, overlay: string) => op<SessionPolicy>(connection, "setSessionPolicy", { sessionId, overlay }),
    listSessions: (signal?: AbortSignal) => op<OcSession[]>(connection, "listSessions", { limit: 100 }, signal),
    createSession: (title?: string) => op<OcSession>(connection, "createSession", title ? { title } : {}),
    getSession: (sessionId: string) => op<OcSession>(connection, "getSession", { sessionId }),
    renameSession: (sessionId: string, title: string) => op<OcSession>(connection, "renameSession", { sessionId, title }),
    deleteSession: (sessionId: string) => op<boolean>(connection, "deleteSession", { sessionId }),
    prompt: (sessionId: string, text: string) => op<null>(connection, "prompt", { sessionId, text }),
    abort: (sessionId: string) => op<boolean>(connection, "abort", { sessionId }),
    diff: (sessionId: string) => op<FileDiff[]>(connection, "diff", { sessionId }),
    todo: (sessionId: string) => op<Todo[]>(connection, "todo", { sessionId }),
    replyPermission: (permissionId: string, reply: "once" | "reject", message?: string) =>
      op<boolean>(connection, "replyPermission", { permissionId, reply, message }),
    snapshot: (sessionId: string, limit: number | undefined, signal?: AbortSignal) =>
      op<SessionSnapshot>(connection, "sessionSnapshot", { sessionId, limit }, signal),
  };
}

export type RuntimeApi = ReturnType<typeof runtimeApi>;

export function testConnection(connection: ConnectionRef): Promise<ConnectionTestResult> {
  return callFunction<ConnectionTestResult>("connection-test", { connection });
}
