import { handleConnectionTest } from "../functions/handlers";
import { platformDeps } from "../functions/platform";

// Validates reachability, authentication, health, version and capabilities of a
// runtime. Payload: { connection }.
export default async function (payload: unknown = undefined) {
  return handleConnectionTest(payload, platformDeps());
}
