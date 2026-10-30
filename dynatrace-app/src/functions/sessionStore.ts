// Saved sessions in Grail Resource Store.
//
//   /lookups/rocky-agent/sessions/<owner-id>/<saved-id>  immutable snapshot (1 row, 13 columns)
//   /lookups/rocky-agent/index/<owner-id>/<saved-id>     rename metadata (1 row, 7 columns)
//
// The owner ID always comes from the platform (current user), never from the
// client. Snapshots are uploaded with overwrite=false, so the Resource Store
// itself rejects any attempt to replace one.

import {
  INDEX_COLUMNS,
  type IndexRecord,
  SNAPSHOT_COLUMNS,
  SNAPSHOT_SCHEMA_VERSION,
  type SavePreview,
  type SavedSessionDetail,
  type SavedSessionSummary,
  type SnapshotRecord,
} from "../models/history";
import type { OcMessage, OcSession } from "../models/runtime";
import { buildCsv, buildParsePattern, CSVDQS_DEFAULT_MAX, CSVDQS_MAX, escapedLength } from "../utils/csv";
import { conversationToMarkdown } from "../utils/markdown";
import { indexPath, indexPrefix, isValidSegment, newSavedId, savedAtFromId, snapshotPath } from "../utils/paths";
import { sha256Hex } from "../utils/sha256";
import { asText } from "../utils/value";
import type { ResolvedConnection } from "./connections";
import type { PlatformDeps } from "./deps";
import { AppFunctionError } from "./envelope";
import { callRuntime } from "./runtimeClient";
import { buildOperation } from "./runtimeOperations";

export const MAX_MARKDOWN_CHARS = 900_000;
export const DELETE_CONFIRMATION = "DELETE";
const SESSION_ID = /^ses[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const SNAPSHOT_PATTERN = buildParsePattern(SNAPSHOT_COLUMNS, ["markdown_content"]);
export const INDEX_PATTERN = buildParsePattern(INDEX_COLUMNS);

function requireSessionId(value: unknown): string {
  if (typeof value !== "string" || !SESSION_ID.test(value)) throw new AppFunctionError("invalid_parameter", "Invalid session ID.");
  return value;
}

function requireSavedId(value: unknown): string {
  if (typeof value !== "string" || !isValidSegment(value)) throw new AppFunctionError("invalid_parameter", "Invalid saved session ID.");
  return value;
}

function requireTitle(value: unknown): string {
  const title = typeof value === "string" ? value.replace(/\p{Cc}/gu, " ").trim() : "";
  if (title.length === 0 || title.length > 200) throw new AppFunctionError("invalid_parameter", "The title must be 1 to 200 characters.");
  return title;
}

function quoteDql(path: string): string {
  // Paths are validated to [A-Za-z0-9_./-]; quoting is still applied defensively.
  return `"${path.replace(/["\\]/g, "")}"`;
}

interface Exported {
  session: OcSession;
  markdown: string;
  sha256: string;
  redactions: number;
  messageCount: number;
  modelProvider: string;
  modelId: string;
  dynatraceEnvironment: string;
}

async function exportConversation(connection: ResolvedConnection, sessionId: string, deps: PlatformDeps): Promise<Exported> {
  const { runtime } = connection;
  const session = (await callRuntime<OcSession>(runtime, buildOperation("getSession", { sessionId }), deps.fetch)).data;
  const messages = (await callRuntime<OcMessage[]>(runtime, buildOperation("messages", { sessionId }), deps.fetch)).data ?? [];
  let dynatraceEnvironment = "";
  try {
    const status = await callRuntime<{ dynatrace?: { environmentHost?: string } }>(runtime, buildOperation("status", {}), deps.fetch);
    dynatraceEnvironment = status.data?.dynatrace?.environmentHost ?? "";
  } catch {
    // Without a status answer the environment is simply not recorded.
  }
  const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant");
  const modelProvider = lastAssistant?.info.role === "assistant" ? (lastAssistant.info.providerID ?? "") : "";
  const modelId = lastAssistant?.info.role === "assistant" ? (lastAssistant.info.modelID ?? "") : "";
  const { markdown, redactions, messageCount } = conversationToMarkdown(session, messages, {
    modelProvider,
    modelId,
    dynatraceEnvironment,
    runtimeName: connection.displayName ?? undefined,
  });
  if (markdown.length > MAX_MARKDOWN_CHARS || escapedLength(markdown) > CSVDQS_MAX) {
    throw new AppFunctionError(
      "conversation_too_large",
      `The conversation is ${markdown.length.toLocaleString("en-US")} characters; the limit for a saved session is ${MAX_MARKDOWN_CHARS.toLocaleString("en-US")}.`,
    );
  }
  return { session, markdown, sha256: await sha256Hex(markdown), redactions, messageCount, modelProvider, modelId, dynatraceEnvironment };
}

export async function previewSave(connection: ResolvedConnection, params: Record<string, unknown>, deps: PlatformDeps): Promise<SavePreview> {
  const sessionId = requireSessionId(params.sessionId);
  const exported = await exportConversation(connection, sessionId, deps);
  return {
    sessionId,
    title: exported.session.title || "Untitled session",
    markdown: exported.markdown,
    sha256: exported.sha256,
    characters: exported.markdown.length,
    messageCount: exported.messageCount,
    redactions: exported.redactions,
    createdAt: new Date(exported.session.time.created).toISOString(),
    modelProvider: exported.modelProvider,
    modelId: exported.modelId,
  };
}

export async function saveSession(
  connection: ResolvedConnection,
  params: Record<string, unknown>,
  deps: PlatformDeps,
): Promise<SavedSessionSummary & { sha256: string }> {
  const sessionId = requireSessionId(params.sessionId);
  const title = requireTitle(params.title);
  const expected = params.expectedSha256;
  if (typeof expected !== "string" || !SHA256.test(expected)) {
    throw new AppFunctionError("preview_required", "Review the save preview before saving.");
  }

  const exported = await exportConversation(connection, sessionId, deps);
  if (exported.sha256 !== expected) {
    throw new AppFunctionError("conversation_changed", "The conversation changed after the preview. Review the new preview and save again.", { status: 409 });
  }

  const { userId } = await deps.currentUser();
  const savedAt = deps.now();
  const savedId = newSavedId(sessionId, savedAt);
  const snapshot = snapshotPath(userId, savedId);
  const index = indexPath(userId, savedId);
  const savedIso = savedAt.toISOString();
  const createdIso = new Date(exported.session.time.created).toISOString();

  const snapshotRow: SnapshotRecord = {
    session_id: savedId,
    owner_id: userId,
    connection_id: connection.connectionId ?? "ad-hoc",
    runtime_id: connection.runtimeHost,
    title,
    created_at: createdIso,
    saved_at: savedIso,
    model_provider: exported.modelProvider,
    model_id: exported.modelId,
    dynatrace_environment: exported.dynatraceEnvironment,
    content_sha256: exported.sha256,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    markdown_content: exported.markdown,
  };
  for (const column of SNAPSHOT_COLUMNS) {
    if (column !== "markdown_content" && escapedLength(snapshotRow[column]) > CSVDQS_DEFAULT_MAX) {
      throw new AppFunctionError("invalid_parameter", `Column ${column} is too long.`);
    }
  }
  const indexRow: IndexRecord = {
    session_id: savedId,
    display_title: title,
    resource_path: snapshot,
    created_at: createdIso,
    saved_at: savedIso,
    updated_at: savedIso,
    status: "active",
  };

  await deps.uploadLookup({
    filePath: snapshot,
    content: buildCsv(SNAPSHOT_COLUMNS, snapshotRow),
    parsePattern: SNAPSHOT_PATTERN,
    lookupField: "session_id",
    displayName: title.slice(0, 500),
    description: "Rocky Agent saved session snapshot (immutable)",
    overwrite: false,
    skippedRecords: 1,
  });
  try {
    await deps.uploadLookup({
      filePath: index,
      content: buildCsv(INDEX_COLUMNS, indexRow),
      parsePattern: INDEX_PATTERN,
      lookupField: "session_id",
      displayName: title.slice(0, 500),
      description: "Rocky Agent saved session index",
      overwrite: false,
      skippedRecords: 1,
    });
  } catch (error) {
    await deps.deleteLookup(snapshot).catch(() => undefined);
    throw error;
  }

  deps.log({ audit: true, type: "rocky.session.saved", savedId, contentSha256: exported.sha256, characters: exported.markdown.length });
  return { savedId, title, savedAt: savedIso, updatedAt: savedIso, sha256: exported.sha256 };
}

export async function listSaved(deps: PlatformDeps): Promise<SavedSessionSummary[]> {
  const { userId } = await deps.currentUser();
  const prefix = indexPrefix(userId);
  const records = await deps.query(
    [
      "fetch dt.system.files",
      `| filter startsWith(name, ${quoteDql(prefix)})`,
      "| fields name, display_name, modified.timestamp",
      "| sort modified.timestamp desc",
      "| limit 1000",
    ].join("\n"),
  );
  return records
    .map((r) => {
      const name = asText(r.name, "");
      const savedId = name.startsWith(prefix) ? name.slice(prefix.length) : "";
      return {
        savedId,
        title: asText(r.display_name, savedId),
        savedAt: savedAtFromId(savedId),
        updatedAt: asText(r["modified.timestamp"]) || null,
      };
    })
    .filter((s) => isValidSegment(s.savedId));
}

async function loadOne(deps: PlatformDeps, path: string): Promise<Record<string, unknown> | null> {
  const records = await deps.query(`load ${quoteDql(path)}`);
  return records[0] ?? null;
}

export async function readSaved(params: Record<string, unknown>, deps: PlatformDeps): Promise<SavedSessionDetail> {
  const savedId = requireSavedId(params.savedId);
  const { userId } = await deps.currentUser();
  const [snapshot, index] = await Promise.all([loadOne(deps, snapshotPath(userId, savedId)), loadOne(deps, indexPath(userId, savedId)).catch(() => null)]);
  if (!snapshot) throw new AppFunctionError("not_found", "The saved session does not exist.", { status: 404 });
  const markdown = asText(snapshot.markdown_content, "");
  const contentSha256 = asText(snapshot.content_sha256, "");
  const original = /\| (?:Runtime|OpenCode) session \| ([^|]+) \|/.exec(markdown)?.[1]?.trim() ?? "";
  return {
    savedId,
    title: asText(index?.display_title, asText(snapshot.title, savedId)),
    originalSessionId: original,
    createdAt: asText(snapshot.created_at, ""),
    savedAt: asText(snapshot.saved_at, ""),
    modelProvider: asText(snapshot.model_provider, ""),
    modelId: asText(snapshot.model_id, ""),
    markdown,
    contentSha256,
    integrityVerified: (await sha256Hex(markdown)) === contentSha256,
  };
}

export async function renameSaved(params: Record<string, unknown>, deps: PlatformDeps): Promise<SavedSessionSummary> {
  const savedId = requireSavedId(params.savedId);
  const title = requireTitle(params.title);
  const { userId } = await deps.currentUser();
  const path = indexPath(userId, savedId);
  const current = await loadOne(deps, path);
  if (!current) throw new AppFunctionError("not_found", "The saved session does not exist.", { status: 404 });
  const updatedAt = deps.now().toISOString();
  const row: IndexRecord = {
    session_id: savedId,
    display_title: title,
    resource_path: snapshotPath(userId, savedId),
    created_at: asText(current.created_at, ""),
    saved_at: asText(current.saved_at, ""),
    updated_at: updatedAt,
    status: "active",
  };
  // Only the index resource changes; the snapshot keeps its original content.
  await deps.uploadLookup({
    filePath: path,
    content: buildCsv(INDEX_COLUMNS, row),
    parsePattern: INDEX_PATTERN,
    lookupField: "session_id",
    displayName: title.slice(0, 500),
    description: "Rocky Agent saved session index",
    overwrite: true,
    skippedRecords: 1,
  });
  deps.log({ audit: true, type: "rocky.session.renamed", savedId });
  return { savedId, title, savedAt: row.saved_at || savedAtFromId(savedId), updatedAt };
}

export async function deleteSaved(params: Record<string, unknown>, deps: PlatformDeps): Promise<{ savedId: string; deleted: true }> {
  const savedId = requireSavedId(params.savedId);
  if (params.confirmation !== DELETE_CONFIRMATION) {
    throw new AppFunctionError("confirmation_required", `Type ${DELETE_CONFIRMATION} to confirm. Deletion is permanent and cannot be undone.`);
  }
  const { userId } = await deps.currentUser();
  await deps.deleteLookup(snapshotPath(userId, savedId));
  await deps.deleteLookup(indexPath(userId, savedId));
  deps.log({ audit: true, type: "rocky.session.deleted", savedId });
  return { savedId, deleted: true };
}
