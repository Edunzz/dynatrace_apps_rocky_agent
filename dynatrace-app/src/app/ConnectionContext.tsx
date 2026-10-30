import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConnectionRef, StoredConnection } from "../models/connection";
import { connectionsApi } from "../services/connections";
import { errorMessage } from "../services/functions";

const ACTIVE_KEY = "rocky-agent.activeConnection";

export interface ConnectionState {
  connections: StoredConnection[];
  loading: boolean;
  error: string | null;
  active: StoredConnection | null;
  // Usable reference for app functions, or null (none selected, or memory-only
  // without a password entered yet).
  connectionRef: ConnectionRef | null;
  needsPassword: boolean;
  select: (objectId: string | null) => void;
  setMemoryPassword: (password: string | null) => void;
  reload: () => Promise<void>;
}

const Context = createContext<ConnectionState | null>(null);

function readActive(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(readActive);
  // Memory-only passwords live in React state and are never persisted.
  const [memoryPassword, setMemoryPassword] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await connectionsApi.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = useCallback((objectId: string | null) => {
    setActiveId(objectId);
    setMemoryPassword(null);
    try {
      if (objectId) window.localStorage.setItem(ACTIVE_KEY, objectId);
      else window.localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // Storage may be unavailable; the selection then lasts for this page only.
    }
  }, []);

  const value = useMemo<ConnectionState>(() => {
    const active = connections.find((c) => c.objectId === activeId) ?? (connections.length === 1 ? connections[0] : null);
    const needsPassword = active?.authMode === "memory-only" && !memoryPassword;
    let connectionRef: ConnectionRef | null = null;
    if (active && !needsPassword) {
      connectionRef = active.authMode === "memory-only" && memoryPassword
        ? { connectionId: active.objectId, password: memoryPassword }
        : { connectionId: active.objectId };
    }
    return { connections, loading, error, active, connectionRef, needsPassword, select, setMemoryPassword, reload };
  }, [connections, loading, error, activeId, memoryPassword, select, reload]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnection(): ConnectionState {
  const value = useContext(Context);
  if (!value) throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}
