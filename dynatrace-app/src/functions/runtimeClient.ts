import { joinUrl } from "../utils/url";
import { AppFunctionError } from "./envelope";
import type { OperationRequest } from "./runtimeOperations";

export interface ResolvedRuntime {
  baseUrl: string;
  username: string;
  password: string;
  timeoutSeconds: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// App functions stop after 120 s; keep every runtime call well below that.
export const MAX_TIMEOUT_SECONDS = 100;

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `Basic ${btoa(binary)}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2000);
  }
}

function errorFromStatus(status: number, body: unknown): AppFunctionError {
  const upstream = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const upstreamMessage = typeof upstream.message === "string" ? upstream.message : undefined;
  const upstreamCode = typeof upstream.error === "string" ? upstream.error : undefined;
  if (status === 401) {
    return new AppFunctionError("authentication_failed", "The runtime rejected the username or password.", { status });
  }
  if (status === 429) {
    return new AppFunctionError("rate_limited", upstreamMessage ?? "The runtime is rate limiting requests.", { status });
  }
  if (status === 403 && upstreamCode === "route_blocked") {
    return new AppFunctionError("route_blocked", upstreamMessage ?? "The runtime gateway blocked this operation.", { status });
  }
  if (status === 404 && upstreamCode === "route_not_allowed") {
    return new AppFunctionError(
      "capability_missing",
      "The runtime does not support this operation. Make sure the Rocky gateway is enabled.",
      { status },
    );
  }
  return new AppFunctionError(upstreamCode ?? (status >= 500 ? "runtime_error" : "runtime_request_failed"), upstreamMessage ?? `The runtime returned HTTP ${status}.`, {
    status,
    details: upstream.details,
  });
}

export async function callRuntime<T = unknown>(
  runtime: ResolvedRuntime,
  request: OperationRequest,
  fetchImpl: FetchLike = fetch,
  { authenticated = true }: { authenticated?: boolean } = {},
): Promise<{ status: number; data: T }> {
  const timeoutMs = Math.min(Math.max(runtime.timeoutSeconds, 1), MAX_TIMEOUT_SECONDS) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: "application/json" };
  if (authenticated) headers.authorization = basicAuth(runtime.username, runtime.password);
  if (request.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetchImpl(joinUrl(runtime.baseUrl, request.path), {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AppFunctionError("timeout", `The runtime did not answer within ${timeoutMs / 1000} seconds.`);
    }
    throw new AppFunctionError("runtime_unreachable", "The runtime could not be reached from Dynatrace.", {
      hint:
        "Check that the URL is correct, the host is allowed in Settings > General > External requests " +
        "(builtin:dt-javascript-runtime.allowed-outbound-connections), the certificate is publicly trusted, " +
        "and private runtimes are routed through EdgeConnect.",
      details: error instanceof Error ? error.name : undefined,
    });
  } finally {
    clearTimeout(timer);
  }

  const body = await readBody(response);
  if (!response.ok) throw errorFromStatus(response.status, body);
  return { status: response.status, data: body as T };
}
