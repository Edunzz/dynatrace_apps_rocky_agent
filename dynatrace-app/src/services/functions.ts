import { functions } from "@dynatrace-sdk/app-utils";
import type { FunctionError, FunctionResult } from "../functions/envelope";

export class RockyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type FunctionName = "runtime-proxy" | "connection-test" | "session-store";

// Calls an app function and unwraps its envelope. Throws RockyError on failure.
export async function callFunction<T>(name: FunctionName, data: unknown, abortSignal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await functions.call(name, { data, abortSignal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new RockyError("function_unavailable", "The app backend could not be reached. Try again in a moment.");
  }
  const body = (await response.json().catch(() => null)) as FunctionResult<T> | null;
  if (!body || typeof body !== "object" || !("ok" in body)) {
    throw new RockyError("function_failed", `The app backend returned HTTP ${response.status}.`);
  }
  if (!body.ok) {
    const error: FunctionError = body.error;
    throw new RockyError(error.code, error.message, error.hint, error.details);
  }
  return body.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RockyError) return error.hint ? `${error.message} ${error.hint}` : error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}
