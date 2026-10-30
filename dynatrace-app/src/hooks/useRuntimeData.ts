import { useCallback, useMemo } from "react";
import type { ConnectionRef } from "../models/connection";
import type { SavedSessionSummary } from "../models/history";
import type { OcSession, RuntimeStatus } from "../models/runtime";
import { historyApi } from "../services/history";
import { runtimeApi } from "../services/runtime";
import { usePolling } from "./usePolling";

export function useRuntimeStatus(connection: ConnectionRef | null) {
  const load = useMemo(
    () => (connection ? (signal: AbortSignal) => runtimeApi(connection).status(signal) : null),
    [connection],
  );
  return usePolling<RuntimeStatus>(load, { intervalMs: 30_000 });
}

export function useEphemeralSessions(connection: ConnectionRef | null) {
  const load = useMemo(
    () =>
      connection
        ? async (signal: AbortSignal) =>
            (await runtimeApi(connection).listSessions(signal))
              .filter((s) => !s.parentID && !s.time?.archived)
              .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
        : null,
    [connection],
  );
  return usePolling<OcSession[]>(load, { intervalMs: 20_000 });
}

export function useSavedSessions() {
  const load = useCallback(() => historyApi.list(), []);
  return usePolling<SavedSessionSummary[]>(load, { intervalMs: 120_000 });
}
