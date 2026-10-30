import type { ConnectionTestResult, ConnectionTestStep } from "../models/connection";
import { isAtLeast } from "../utils/semver";
import type { PlatformDeps } from "./deps";
import { AppFunctionError } from "./envelope";
import { callRuntime, type ResolvedRuntime } from "./runtimeClient";

// Oldest OpenCode version the app was tested against.
export const MIN_OPENCODE_VERSION = "1.19.0";

const REQUIRED_CAPABILITIES: { id: string; path: string; required: boolean }[] = [
  { id: "sessions", path: "/session?limit=1", required: true },
  { id: "permissions", path: "/permission", required: true },
  { id: "providers", path: "/provider", required: false },
  { id: "skills", path: "/skill", required: false },
];

function message(error: unknown): string {
  return error instanceof AppFunctionError ? error.message : "Unexpected error";
}

export async function testConnection(runtime: ResolvedRuntime, deps: PlatformDeps): Promise<ConnectionTestResult> {
  const steps: ConnectionTestStep[] = [];
  const add = (id: string, label: string, status: ConnectionTestStep["status"], detail: string) =>
    steps.push({ id, label, status, detail });
  const result: ConnectionTestResult = { ok: false, steps, opencodeVersion: null, runtimeVersion: null, gateway: false, capabilities: [] };

  const url = new URL(runtime.baseUrl);
  add("url", "URL syntax and HTTPS", url.protocol === "https:" ? "pass" : "warn",
    url.protocol === "https:" ? `${url.host} over HTTPS` : "Plain HTTP is only acceptable for local development.");

  // Reachability: any HTTP answer proves the network path works.
  try {
    await callRuntime(runtime, { method: "GET", path: "/rocky/v1/livez" }, deps.fetch, { authenticated: false });
    add("reachability", "Reachability", "pass", "The runtime answered.");
  } catch (error) {
    if (error instanceof AppFunctionError && (error.code === "runtime_unreachable" || error.code === "timeout")) {
      add("reachability", "Reachability", "fail", `${error.message} ${error.extra.hint ?? ""}`.trim());
      for (const [id, label] of [["authentication", "Authentication"], ["health", "OpenCode health"], ["version", "Version compatibility"], ["capabilities", "API capabilities"]]) {
        add(id, label, "skip", "Skipped because the runtime is not reachable.");
      }
      return result;
    }
    add("reachability", "Reachability", "pass", "The runtime answered.");
  }

  // Authentication and health.
  try {
    const health = await callRuntime<{ healthy?: boolean; version?: string }>(runtime, { method: "GET", path: "/global/health" }, deps.fetch);
    add("authentication", "Authentication", "pass", "Credentials accepted.");
    result.opencodeVersion = typeof health.data?.version === "string" ? health.data.version : null;
    add("health", "OpenCode health", health.data?.healthy === true ? "pass" : "fail",
      health.data?.healthy === true ? `Healthy (OpenCode ${result.opencodeVersion ?? "unknown"})` : "OpenCode reported an unhealthy state.");
  } catch (error) {
    const authFailed = error instanceof AppFunctionError && error.code === "authentication_failed";
    add("authentication", "Authentication", "fail", message(error));
    add("health", "OpenCode health", "skip", authFailed ? "Skipped because authentication failed." : message(error));
    add("version", "Version compatibility", "skip", "Skipped.");
    add("capabilities", "API capabilities", "skip", "Skipped.");
    return result;
  }

  add("version", "Version compatibility",
    isAtLeast(result.opencodeVersion, MIN_OPENCODE_VERSION) ? "pass" : "warn",
    isAtLeast(result.opencodeVersion, MIN_OPENCODE_VERSION)
      ? `OpenCode ${result.opencodeVersion} is supported (minimum ${MIN_OPENCODE_VERSION}).`
      : `OpenCode ${result.opencodeVersion ?? "unknown"} is older than ${MIN_OPENCODE_VERSION} or unknown; some features may not work.`);

  // Rocky gateway (extended status, policy overlays, hardened routes).
  try {
    const status = await callRuntime<{ runtime?: { version?: string } }>(runtime, { method: "GET", path: "/rocky/v1/status" }, deps.fetch);
    result.gateway = true;
    result.runtimeVersion = status.data?.runtime?.version ?? null;
    result.capabilities.push("status", "policy");
    add("gateway", "Rocky gateway", "pass", `Gateway detected (runtime ${result.runtimeVersion ?? "unknown"}).`);
  } catch {
    add("gateway", "Rocky gateway", "warn",
      "Rocky gateway not detected. The raw OpenCode API is exposed; status indicators and policy overlays are unavailable.");
  }

  const missing: string[] = [];
  for (const capability of REQUIRED_CAPABILITIES) {
    try {
      await callRuntime(runtime, { method: "GET", path: capability.path }, deps.fetch);
      result.capabilities.push(capability.id);
    } catch {
      if (capability.required) missing.push(capability.id);
    }
  }
  add("capabilities", "API capabilities", missing.length === 0 ? "pass" : "fail",
    missing.length === 0 ? `Available: ${result.capabilities.join(", ")}` : `Missing required capabilities: ${missing.join(", ")}`);

  result.ok = steps.every((s) => s.status !== "fail");
  return result;
}
