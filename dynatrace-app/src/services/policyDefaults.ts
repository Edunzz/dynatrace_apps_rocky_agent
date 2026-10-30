import { stateClient } from "@dynatrace-sdk/client-state";

const KEY = "default-policy-overlay";

// Optional per-user default policy overlay, stored in the user's own app state
// only when the user explicitly selects "Save as my default policy".
export const policyDefaultsApi = {
  async load(): Promise<string> {
    try {
      const state = await stateClient.getUserAppState({ key: KEY });
      return typeof state.value === "string" ? state.value : "";
    } catch {
      return "";
    }
  },
  async save(overlay: string): Promise<void> {
    await stateClient.setUserAppState({ key: KEY, body: { value: overlay.slice(0, 20_000) } });
  },
  async clear(): Promise<void> {
    await stateClient.deleteUserAppState({ key: KEY });
  },
};
