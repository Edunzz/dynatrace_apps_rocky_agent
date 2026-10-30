import { useCallback, useEffect, useRef, useState } from "react";
import type { OcPermissionRequest } from "../models/runtime";

const storageKey = (sessionId: string) => `rocky-agent.autoApprove.${sessionId}`;

// Remembered per session and per browser tab only; storage may be unavailable.
function readEnabled(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(sessionId)) === "true";
  } catch {
    return false;
  }
}

// Auto-approve: while enabled and while the session page is open, answers every
// pending tool request with a one-time approval. It never sends "always" (the
// gateway refuses it anyway), it does not type the CONFIRM message that changes
// to Dynatrace require, and every approval is still audited by the runtime.
export function useAutoApprove(
  sessionId: string,
  permissions: OcPermissionRequest[],
  reply: (permissionId: string, reply: "once") => Promise<void>,
  onError: (error: unknown) => void,
) {
  const [enabled, setEnabledState] = useState(() => readEnabled(sessionId));
  const sent = useRef(new Set<string>());
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  useEffect(() => {
    setEnabledState(readEnabled(sessionId));
  }, [sessionId]);

  const setEnabled = useCallback(
    (value: boolean) => {
      setEnabledState(value);
      try {
        window.sessionStorage.setItem(storageKey(sessionId), String(value));
      } catch {
        // Ignore: the choice just is not remembered.
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!enabled) return;
    for (const request of permissions) {
      if (sent.current.has(request.id)) continue;
      sent.current.add(request.id);
      reply(request.id, "once").catch((error: unknown) => {
        // Let the next poll retry it, and show why it failed.
        sent.current.delete(request.id);
        errorHandler.current(error);
      });
    }
  }, [enabled, permissions, reply]);

  return [enabled, setEnabled] as const;
}
