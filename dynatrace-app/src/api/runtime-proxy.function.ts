import { handleRuntimeProxy } from "../functions/handlers";
import { platformDeps } from "../functions/platform";

// Forwards one allowlisted operation to the Rocky runtime with credentials
// resolved server-side. Payload: { connection, operation, params }.
export default async function (payload: unknown = undefined) {
  return handleRuntimeProxy(payload, platformDeps());
}
