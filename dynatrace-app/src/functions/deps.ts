import type { FetchLike } from "./runtimeClient";

export interface UploadLookupArgs {
  filePath: string;
  content: string;
  parsePattern: string;
  lookupField: string;
  displayName: string;
  description: string;
  overwrite: boolean;
  skippedRecords: number;
}

// Platform dependencies of the app functions, injected so the logic can be
// unit tested. The production implementation lives in ./platform.ts.
export interface PlatformDeps {
  fetch: FetchLike;
  getConnectionObject(objectId: string): Promise<{ value: Record<string, unknown> }>;
  getVaultCredentials(id: string): Promise<{ username?: string; password?: string }>;
  currentUser(): Promise<{ userId: string }>;
  uploadLookup(args: UploadLookupArgs): Promise<void>;
  deleteLookup(filePath: string): Promise<void>;
  query(dql: string): Promise<Record<string, unknown>[]>;
  log(event: Record<string, unknown>): void;
  now(): Date;
}
