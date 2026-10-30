// Response envelope shared by all app functions. Functions never throw to the
// caller and never include secrets in error messages.

export interface FunctionError {
  code: string;
  message: string;
  hint?: string;
  status?: number;
  details?: unknown;
}

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; error: FunctionError };

export class AppFunctionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly extra: Omit<FunctionError, "code" | "message"> = {},
  ) {
    super(message);
  }
}

export function ok<T>(data: T): FunctionResult<T> {
  return { ok: true, data };
}

export function fail(error: unknown): FunctionResult<never> {
  if (error instanceof AppFunctionError) {
    return { ok: false, error: { code: error.code, message: error.message, ...error.extra } };
  }
  return { ok: false, error: { code: "internal_error", message: "Unexpected error in the app function." } };
}

export async function run<T>(work: () => Promise<T>): Promise<FunctionResult<T>> {
  try {
    return ok(await work());
  } catch (error) {
    return fail(error);
  }
}
