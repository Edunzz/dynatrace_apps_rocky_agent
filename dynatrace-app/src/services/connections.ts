import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { asText } from "../utils/value";
import { CONNECTION_SCHEMA_ID, type AuthMode, type RuntimeConnection, type StoredConnection } from "../models/connection";

export interface ConnectionDraft extends RuntimeConnection {
  // Only sent when the user typed a new password (settings-secret mode).
  password?: string;
}

function toStored(item: { objectId: string; version: string; value?: Record<string, unknown> }): StoredConnection {
  const v = item.value ?? {};
  return {
    objectId: item.objectId,
    version: item.version,
    displayName: asText(v.displayName),
    runtimeUrl: asText(v.runtimeUrl),
    username: asText(v.username, "rocky"),
    authMode: (v.authMode as AuthMode) ?? "settings-secret",
    credentialVaultId: (v.credentialVaultId as string | null) ?? null,
    tlsVerification: v.tlsVerification !== false,
    customCaReference: (v.customCaReference as string | null) ?? null,
    timeoutSeconds: typeof v.timeoutSeconds === "number" ? v.timeoutSeconds : 30,
    lastSuccessfulConnection: (v.lastSuccessfulConnection as string | null) ?? null,
    runtimeVersion: (v.runtimeVersion as string | null) ?? null,
    capabilities: Array.isArray(v.capabilities) ? (v.capabilities as string[]) : null,
  };
}

function toValue(draft: ConnectionDraft, currentMaskedPassword?: unknown): Record<string, unknown> {
  const value: Record<string, unknown> = {
    displayName: draft.displayName.trim(),
    runtimeUrl: draft.runtimeUrl.trim(),
    username: draft.username.trim(),
    authMode: draft.authMode,
    tlsVerification: true,
    customCaReference: draft.customCaReference?.trim() || null,
    timeoutSeconds: draft.timeoutSeconds,
    lastSuccessfulConnection: draft.lastSuccessfulConnection ?? null,
    runtimeVersion: draft.runtimeVersion ?? null,
    // Settings lists cannot be null; an empty list means "not tested yet".
    capabilities: draft.capabilities ?? [],
  };
  if (draft.authMode === "settings-secret") {
    // A new password replaces the secret; otherwise the masked value keeps it.
    value.password = draft.password ? draft.password : (currentMaskedPassword ?? null);
  }
  if (draft.authMode === "credential-vault") value.credentialVaultId = draft.credentialVaultId?.trim() || null;
  return value;
}

// Connections are owner-only settings objects (ownerBasedAccessControl), so
// each user only lists and edits their own.
export const connectionsApi = {
  async list(): Promise<StoredConnection[]> {
    const result = await appSettingsObjectsClient.getAppSettingsObjects({ schemaId: CONNECTION_SCHEMA_ID, addFields: "value" });
    return (result.items ?? [])
      .map((item) => toStored(item as { objectId: string; version: string; value?: Record<string, unknown> }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  async create(draft: ConnectionDraft): Promise<string> {
    const created = await appSettingsObjectsClient.postAppSettingsObject({
      body: { schemaId: CONNECTION_SCHEMA_ID, value: toValue(draft) },
    });
    if (!created) throw new Error("The connection was not created.");
    return created.objectId;
  },

  async update(stored: StoredConnection, draft: ConnectionDraft): Promise<void> {
    const current = await appSettingsObjectsClient.getAppSettingsObjectByObjectId({ objectId: stored.objectId });
    const currentValue = (current.value ?? {}) as Record<string, unknown>;
    await appSettingsObjectsClient.putAppSettingsObjectByObjectId({
      objectId: stored.objectId,
      optimisticLockingVersion: current.version,
      body: { value: toValue(draft, currentValue.password) },
    });
  },

  async recordSuccess(stored: StoredConnection, runtimeVersion: string | null, capabilities: string[]): Promise<void> {
    await connectionsApi.update(stored, {
      ...stored,
      lastSuccessfulConnection: new Date().toISOString(),
      runtimeVersion,
      capabilities,
    });
  },

  async remove(stored: StoredConnection): Promise<void> {
    const current = await appSettingsObjectsClient.getAppSettingsObjectByObjectId({ objectId: stored.objectId });
    await appSettingsObjectsClient.deleteAppSettingsObjectByObjectId({
      objectId: stored.objectId,
      optimisticLockingVersion: current.version,
    });
  },
};
