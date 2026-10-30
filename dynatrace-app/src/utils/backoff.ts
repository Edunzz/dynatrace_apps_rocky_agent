export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
  random?: () => number;
}

// Exponential backoff with bounded jitter.
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 1000, maxMs = 15_000, factor = 2, jitter = 0.2, random = Math.random } = options;
  const raw = Math.min(maxMs, baseMs * factor ** Math.max(0, attempt));
  const spread = raw * jitter;
  return Math.max(0, Math.round(raw - spread + random() * spread * 2));
}
