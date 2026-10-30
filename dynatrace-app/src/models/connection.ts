export type AuthMode = "settings-secret" | "credential-vault" | "memory-only";

export const CONNECTION_SCHEMA_ID = "runtime-connections";

// Non-secret connection metadata as stored in app settings. The password, when
// stored, is a `secret` property that only the app's functions can read.
export interface RuntimeConnection {
  displayName: string;
  runtimeUrl: string;
  username: string;
  authMode: AuthMode;
  credentialVaultId?: string | null;
  tlsVerification: boolean;
  customCaReference?: string | null;
  timeoutSeconds: number;
  lastSuccessfulConnection?: string | null;
  runtimeVersion?: string | null;
  capabilities?: string[] | null;
}

export interface StoredConnection extends RuntimeConnection {
  objectId: string;
  version: string;
}

// What the browser sends to a function to identify the runtime.
export type ConnectionRef =
  | { connectionId: string; password?: string }
  | { adHoc: { runtimeUrl: string; username: string; password: string; timeoutSeconds?: number } };

export type StepStatus = "pass" | "fail" | "warn" | "skip";

export interface ConnectionTestStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  steps: ConnectionTestStep[];
  opencodeVersion: string | null;
  runtimeVersion: string | null;
  gateway: boolean;
  capabilities: string[];
}
