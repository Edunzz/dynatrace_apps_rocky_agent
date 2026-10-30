import React, { createContext, useContext } from "react";
import { useEphemeralSessions, useRuntimeStatus, useSavedSessions } from "../hooks/useRuntimeData";
import type { PollingResult } from "../hooks/usePolling";
import type { SavedSessionSummary } from "../models/history";
import type { OcSession, RuntimeStatus } from "../models/runtime";
import { useConnection } from "./ConnectionContext";

interface RuntimeData {
  status: PollingResult<RuntimeStatus>;
  ephemeral: PollingResult<OcSession[]>;
  saved: PollingResult<SavedSessionSummary[]>;
}

const Context = createContext<RuntimeData | null>(null);

// Shares runtime status, ephemeral sessions and saved sessions between the
// status bar, the sidebar and the pages, with a single polling loop each.
export function RuntimeDataProvider({ children }: { children: React.ReactNode }) {
  const { connectionRef } = useConnection();
  const status = useRuntimeStatus(connectionRef);
  const ephemeral = useEphemeralSessions(connectionRef);
  const saved = useSavedSessions();
  return <Context.Provider value={{ status, ephemeral, saved }}>{children}</Context.Provider>;
}

export function useRuntimeData(): RuntimeData {
  const value = useContext(Context);
  if (!value) throw new Error("useRuntimeData must be used inside RuntimeDataProvider");
  return value;
}
