import { useCallback, useEffect, useRef, useState } from "react";
import { backoffDelay } from "../utils/backoff";

export interface PollingResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refresh(): void;
}

// Polls `load` every `intervalMs`; failures back off exponentially up to
// `maxBackoffMs`. Stops when unmounted or when `enabled` is false.
export function usePolling<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  { intervalMs, maxBackoffMs = 120_000 }: { intervalMs: number; maxBackoffMs?: number },
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const failures = useRef(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!load) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const result = await load(controller.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
        failures.current = 0;
        timer = setTimeout(() => void run(), intervalMs);
      } catch (e) {
        if (cancelled) return;
        setError(e);
        failures.current += 1;
        timer = setTimeout(() => void run(), backoffDelay(failures.current, { baseMs: intervalMs, maxMs: maxBackoffMs }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [load, intervalMs, maxBackoffMs, tick]);

  return { data, error, loading, refresh };
}
