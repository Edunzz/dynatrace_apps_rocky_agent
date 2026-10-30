import { validateRuntimeUrl } from "../utils/url";
import type { PlatformDeps } from "./deps";
import { AppFunctionError } from "./envelope";
import { MAX_TIMEOUT_SECONDS, type ResolvedRuntime } from "./runtimeClient";

const OBJECT_ID = /^[A-Za-z0-9_\-=+/.]{8,512}$/;
const USERNAME = /^[A-Za-z0-9._-]{1,64}$/;
const VAULT_ID = /^CREDENTIALS_VAULT-[A-Z0-9]+$/;

export interface ResolvedConnection {
  runtime: ResolvedRuntime;
  connectionId: string | null;
  displayName: string | null;
  runtimeHost: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function timeout(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 5), MAX_TIMEOUT_SECONDS) : 30;
}

function requirePassword(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    throw new AppFunctionError("password_required", message);
  }
  return value;
}

function checkedUrl(raw: unknown): { baseUrl: string; host: string } {
  const validation = validateRuntimeUrl(typeof raw === "string" ? raw : "", { allowLocalHttp: true });
  if (!validation.ok || !validation.normalized) {
    throw new AppFunctionError("invalid_url", validation.errors.join(" ") || "The runtime URL is invalid.");
  }
  return { baseUrl: validation.normalized, host: new URL(validation.normalized).host };
}

// Resolves a connection reference into URL and credentials. The password never
// leaves the function: it is read from the owner-only settings secret, the
// Credential Vault, or (memory-only mode) the request itself.
export async function resolveConnection(ref: unknown, deps: PlatformDeps): Promise<ResolvedConnection> {
  const input = asRecord(ref);

  if (input.adHoc !== undefined) {
    const adHoc = asRecord(input.adHoc);
    const { baseUrl, host } = checkedUrl(adHoc.runtimeUrl);
    const username = typeof adHoc.username === "string" && USERNAME.test(adHoc.username) ? adHoc.username : null;
    if (!username) throw new AppFunctionError("invalid_username", "The username may contain letters, digits, '.', '_' and '-'.");
    return {
      runtime: { baseUrl, username, password: requirePassword(adHoc.password, "Enter the runtime password."), timeoutSeconds: timeout(adHoc.timeoutSeconds) },
      connectionId: null,
      displayName: null,
      runtimeHost: host,
    };
  }

  const connectionId = input.connectionId;
  if (typeof connectionId !== "string" || !OBJECT_ID.test(connectionId)) {
    throw new AppFunctionError("invalid_connection", "Select a saved runtime connection.");
  }
  let value: Record<string, unknown>;
  try {
    value = asRecord((await deps.getConnectionObject(connectionId)).value);
  } catch {
    throw new AppFunctionError("connection_not_found", "The connection does not exist or you do not own it.");
  }

  const { baseUrl, host } = checkedUrl(value.runtimeUrl);
  const username = typeof value.username === "string" && USERNAME.test(value.username) ? value.username : "opencode";
  const displayName = typeof value.displayName === "string" ? value.displayName : null;
  const timeoutSeconds = timeout(value.timeoutSeconds);

  let password: string;
  let effectiveUser = username;
  switch (value.authMode) {
    case "credential-vault": {
      const vaultId = value.credentialVaultId;
      if (typeof vaultId !== "string" || !VAULT_ID.test(vaultId)) {
        throw new AppFunctionError("invalid_connection", "The connection has no valid Credential Vault ID.");
      }
      let creds: { username?: string; password?: string };
      try {
        creds = await deps.getVaultCredentials(vaultId);
      } catch {
        throw new AppFunctionError("credential_unavailable", "The Credential Vault entry could not be read.", {
          hint: "Make sure the credential exists, is of type username/password, allows app access and you may read it.",
        });
      }
      password = requirePassword(creds.password, "The Credential Vault entry has no password.");
      if (creds.username && USERNAME.test(creds.username)) effectiveUser = creds.username;
      break;
    }
    case "memory-only":
      password = requirePassword(input.password, "This connection asks for the password every session. Enter it to continue.");
      break;
    case "settings-secret":
    default:
      password = requirePassword(value.password, "The stored password is missing. Edit the connection and enter it again.");
  }

  return { runtime: { baseUrl, username: effectiveUser, password, timeoutSeconds }, connectionId, displayName, runtimeHost: host };
}
