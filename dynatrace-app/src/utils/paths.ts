// Grail Resource Store paths for saved sessions.
// Allowed characters: letters, digits, '-', '_', '.', '/'; must start with
// /lookups, end with a letter or digit and stay within 500 characters.

export const ROOT = "/lookups/rocky-agent";
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const OWNER = /^[A-Za-z0-9-]{1,64}$/;

export function isValidSegment(value: string): boolean {
  return SEGMENT.test(value) && /[A-Za-z0-9]$/.test(value) && !value.includes("..");
}

export function assertOwnerId(ownerId: string): void {
  if (!OWNER.test(ownerId)) throw new Error("Invalid owner ID");
}

export function assertSavedId(savedId: string): void {
  if (!isValidSegment(savedId)) throw new Error("Invalid saved session ID");
}

export function snapshotPath(ownerId: string, savedId: string): string {
  assertOwnerId(ownerId);
  assertSavedId(savedId);
  return `${ROOT}/sessions/${ownerId}/${savedId}`;
}

export function indexPath(ownerId: string, savedId: string): string {
  assertOwnerId(ownerId);
  assertSavedId(savedId);
  return `${ROOT}/index/${ownerId}/${savedId}`;
}

export function indexPrefix(ownerId: string): string {
  assertOwnerId(ownerId);
  return `${ROOT}/index/${ownerId}/`;
}

// A new snapshot ID per save keeps snapshots append-only: saving the same
// runtime session again creates another immutable snapshot.
export function newSavedId(openCodeSessionId: string, savedAt: Date): string {
  const stamp = savedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const base = openCodeSessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "session";
  return `${base}-${stamp}`;
}

export function savedAtFromId(savedId: string): string | null {
  const match = /-(\d{8})T(\d{6})Z$/.exec(savedId);
  if (!match) return null;
  const [, d, t] = match;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
}
