// Entry points used by the app functions in ../../api. Each handler validates
// its payload, never throws and never returns secrets.

import type { ConnectionTestResult } from "../models/connection";
import type { SavePreview, SavedSessionDetail, SavedSessionSummary } from "../models/history";
import { testConnection } from "./connectionTest";
import { resolveConnection } from "./connections";
import type { PlatformDeps } from "./deps";
import { AppFunctionError, type FunctionResult, run } from "./envelope";
import { callRuntime } from "./runtimeClient";
import { buildOperation } from "./runtimeOperations";
import { deleteSaved, listSaved, previewSave, readSaved, renameSaved, saveSession } from "./sessionStore";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new AppFunctionError("invalid_payload", "The request payload must be an object.");
}

export function handleRuntimeProxy(payload: unknown, deps: PlatformDeps): Promise<FunctionResult<unknown>> {
  return run(async () => {
    const input = asRecord(payload);
    const request = buildOperation(input.operation, input.params);
    const { runtime } = await resolveConnection(input.connection, deps);
    return (await callRuntime(runtime, request, deps.fetch)).data;
  });
}

export function handleConnectionTest(payload: unknown, deps: PlatformDeps): Promise<FunctionResult<ConnectionTestResult>> {
  return run(async () => {
    const input = asRecord(payload);
    const { runtime } = await resolveConnection(input.connection, deps);
    return testConnection(runtime, deps);
  });
}

type StoreResult = SavePreview | SavedSessionSummary | SavedSessionSummary[] | SavedSessionDetail | { savedId: string; deleted: true };

export function handleSessionStore(payload: unknown, deps: PlatformDeps): Promise<FunctionResult<StoreResult>> {
  return run<StoreResult>(async () => {
    const input = asRecord(payload);
    const params = input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : {};
    switch (input.action) {
      case "preview":
        return previewSave(await resolveConnection(input.connection, deps), params, deps);
      case "save":
        return saveSession(await resolveConnection(input.connection, deps), params, deps);
      case "list":
        return listSaved(deps);
      case "read":
        return readSaved(params, deps);
      case "rename":
        return renameSaved(params, deps);
      case "delete":
        return deleteSaved(params, deps);
      default:
        throw new AppFunctionError("unknown_action", "Unsupported session store action.");
    }
  });
}
