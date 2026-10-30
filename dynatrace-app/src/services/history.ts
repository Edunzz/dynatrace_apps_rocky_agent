import type { ConnectionRef } from "../models/connection";
import type { SavePreview, SavedSessionDetail, SavedSessionSummary } from "../models/history";
import { callFunction } from "./functions";

export const DELETE_CONFIRMATION = "DELETE";

// Client for the session-store app function (Grail Resource Store).
export const historyApi = {
  preview: (connection: ConnectionRef, sessionId: string) =>
    callFunction<SavePreview>("session-store", { action: "preview", connection, params: { sessionId } }),
  save: (connection: ConnectionRef, sessionId: string, title: string, expectedSha256: string) =>
    callFunction<SavedSessionSummary & { sha256: string }>("session-store", {
      action: "save",
      connection,
      params: { sessionId, title, expectedSha256 },
    }),
  list: () => callFunction<SavedSessionSummary[]>("session-store", { action: "list", params: {} }),
  read: (savedId: string) => callFunction<SavedSessionDetail>("session-store", { action: "read", params: { savedId } }),
  rename: (savedId: string, title: string) =>
    callFunction<SavedSessionSummary>("session-store", { action: "rename", params: { savedId, title } }),
  remove: (savedId: string, confirmation: string) =>
    callFunction<{ savedId: string; deleted: true }>("session-store", { action: "delete", params: { savedId, confirmation } }),
};
