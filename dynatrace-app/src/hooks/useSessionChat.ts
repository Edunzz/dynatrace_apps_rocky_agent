import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionRef } from "../models/connection";
import { runtimeApi } from "../services/runtime";
import { type PollerState, SessionPoller } from "./sessionPoller";

const INITIAL: PollerState = {
  messages: [],
  status: { type: "idle" },
  permissions: [],
  childIds: [],
  error: null,
  polling: false,
  stalled: false,
  initialized: false,
};

export function useSessionChat(connection: ConnectionRef | null, sessionId: string | undefined) {
  const [state, setState] = useState<PollerState>(INITIAL);
  const poller = useRef<SessionPoller | null>(null);
  const api = useMemo(() => (connection ? runtimeApi(connection) : null), [connection]);

  useEffect(() => {
    setState(INITIAL);
    if (!api || !sessionId) return;
    const instance = new SessionPoller(sessionId, (limit, signal) => api.snapshot(sessionId, limit, signal), setState);
    poller.current = instance;
    instance.start();
    return () => {
      instance.stop();
      poller.current = null;
    };
  }, [api, sessionId]);

  const send = useCallback(
    async (text: string) => {
      if (!api || !sessionId) return;
      poller.current?.markBusy();
      await api.prompt(sessionId, text);
      poller.current?.nudge();
    },
    [api, sessionId],
  );

  const stopGeneration = useCallback(async () => {
    if (!api || !sessionId) return;
    await api.abort(sessionId);
    poller.current?.nudge();
  }, [api, sessionId]);

  const replyPermission = useCallback(
    async (permissionId: string, reply: "once" | "reject") => {
      if (!api) return;
      await api.replyPermission(permissionId, reply);
      poller.current?.nudge();
    },
    [api],
  );

  const resume = useCallback(() => poller.current?.nudge(), []);

  return { ...state, send, stopGeneration, replyPermission, resume, busy: state.status.type !== "idle" };
}
