export const SNAPSHOT_SCHEMA_VERSION = "1";

// Columns of the immutable snapshot resource, in file order.
export const SNAPSHOT_COLUMNS = [
  "session_id",
  "owner_id",
  "connection_id",
  "runtime_id",
  "title",
  "created_at",
  "saved_at",
  "model_provider",
  "model_id",
  "dynatrace_environment",
  "content_sha256",
  "schema_version",
  "markdown_content",
] as const;

// Columns of the per-session index resource (rename metadata).
export const INDEX_COLUMNS = [
  "session_id",
  "display_title",
  "resource_path",
  "created_at",
  "saved_at",
  "updated_at",
  "status",
] as const;

export type SnapshotRecord = Record<(typeof SNAPSHOT_COLUMNS)[number], string>;
export type IndexRecord = Record<(typeof INDEX_COLUMNS)[number], string>;

export interface SavedSessionSummary {
  savedId: string;
  title: string;
  savedAt: string | null;
  updatedAt: string | null;
}

export interface SavedSessionDetail {
  savedId: string;
  title: string;
  originalSessionId: string;
  createdAt: string;
  savedAt: string;
  modelProvider: string;
  modelId: string;
  markdown: string;
  contentSha256: string;
  integrityVerified: boolean;
}

export interface SavePreview {
  sessionId: string;
  title: string;
  markdown: string;
  sha256: string;
  characters: number;
  messageCount: number;
  redactions: number;
  createdAt: string;
  modelProvider: string;
  modelId: string;
}
