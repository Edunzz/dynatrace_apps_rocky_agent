import type { ConnectionTestResult, ConnectionTestStep } from "../models/connection";
import type { RuntimeStatus } from "../models/runtime";
import { isAtLeast } from "../utils/semver";
import type { PlatformDeps } from "./deps";
import { AppFunctionError } from "./envelope";
import { callRuntime, type ResolvedRuntime } from "./runtimeClient";

// Oldest Claude Code version the runtime was tested with.
export const MIN_CLAUDE_CODE_VERSION = "2.1.300";

const REQUIRED_CAPABILITIES: { id: string; path: string; required: boolean }[] = [
  { id: "sessions", path: "/rocky/v1/sessions?limit=1", required: true },
  { id: "permissions", path: "/rocky/v1/permissions", required: true },
  { id: "skills", path: "/rocky/v1/skills", required: false },
];

function message(error: unknown): string {
  return error instanceof AppFunctionError ? error.message : "Unexpected error";
}

function signInStep(status: RuntimeStatus["claude"] | undefined): Pick<ConnectionTestStep, "status" | "detail"> {
  if (!status) return { status: "warn", detail: "The runtime did not report the Claude sign-in." };
  switch (status.status) {
    case "connected":
      return { status: "pass", detail: `Signed in (${status.authMethod}${status.model ? `, model ${status.model}` : ""}).` };
    case "authentication_failed":
      return { status: "fail", detail: `Claude rejected the configured credential. Sign in again: ${status.loginCommand}` };
    case "authentication_required":
      return { status: "fail", detail: `Claude is not signed in. On the runtime host run: ${status.loginCommand}` };
    default:
      return { status: "warn", detail: "The Claude sign-in could not be checked." };
  }
}

export async function testConnection(runtime: ResolvedRuntime, deps: PlatformDeps): Promise<ConnectionTestResult> {
  const steps: ConnectionTestStep[] = [];
  const add = (id: string, label: string, status: ConnectionTestStep["status"], detail: string) =>
    steps.push({ id, label, status, detail });
  const result: ConnectionTestResult = { ok: false, steps, agentVersion: null, runtimeVersion: null, gateway: false, capabilities: [] };

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
      for (const [id, label] of [["authentication", "Authentication"], ["agent", "Claude Code"], ["claude", "Claude sign-in"], ["capabilities", "API capabilities"]]) {
        add(id, label, "skip", "Skipped because the runtime is not reachable.");
      }
      return result;
    }
    add("reachability", "Reachability", "pass", "The runtime answered.");
  }

  // Authentication and Claude Code version.
  try {
    const health = await callRuntime<{ healthy?: boolean; version?: string; agent?: { version?: string | null } }>(
      runtime,
      { method: "GET", path: "/rocky/v1/health" },
      deps.fetch,
    );
    add("authentication", "Authentication", "pass", "Credentials accepted.");
    result.gateway = true;
    result.runtimeVersion = typeof health.data?.version === "string" ? health.data.version : null;
    result.agentVersion = typeof health.data?.agent?.version === "string" ? health.data.agent.version : null;
    if (!result.agentVersion) {
      add("agent", "Claude Code", "fail", "The runtime could not run Claude Code. Check the runtime logs.");
    } else {
      const supported = isAtLeast(result.agentVersion, MIN_CLAUDE_CODE_VERSION);
      add("agent", "Claude Code", supported ? "pass" : "warn",
        supported
          ? `Claude Code ${result.agentVersion} (runtime ${result.runtimeVersion ?? "unknown"}).`
          : `Claude Code ${result.agentVersion} is older than ${MIN_CLAUDE_CODE_VERSION}; some features may not work.`);
    }
  } catch (error) {
    const authFailed = error instanceof AppFunctionError && error.code === "authentication_failed";
    add("authentication", "Authentication", "fail", message(error));
    const reason = authFailed ? "Skipped because authentication failed." : "Skipped.";
    for (const [id, label] of [["agent", "Claude Code"], ["claude", "Claude sign-in"], ["capabilities", "API capabilities"]]) add(id, label, "skip", reason);
    return result;
  }

  // Claude sign-in, from the extended status.
  try {
    const status = await callRuntime<RuntimeStatus>(runtime, { method: "GET", path: "/rocky/v1/status" }, deps.fetch);
    result.capabilities.push("status", "policy");
    const step = signInStep(status.data?.claude);
    add("claude", "Claude sign-in", step.status, step.detail);
  } catch (error) {
    add("claude", "Claude sign-in", "warn", `Status unavailable: ${message(error)}`);
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
