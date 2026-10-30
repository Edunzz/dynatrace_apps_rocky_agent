import { handleSessionStore } from "../functions/handlers";
import { platformDeps } from "../functions/platform";

// Saved sessions in Grail Resource Store. Payload: { action, connection?, params }.
// Actions: preview, save, list, read, rename, delete.
export default async function (payload: unknown = undefined) {
  return handleSessionStore(payload, platformDeps());
}
