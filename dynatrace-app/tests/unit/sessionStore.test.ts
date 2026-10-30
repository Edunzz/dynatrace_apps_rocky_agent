import { resolveConnection } from "../../src/functions/connections";
import { deleteSaved, listSaved, previewSave, readSaved, renameSaved, saveSession, SNAPSHOT_PATTERN } from "../../src/functions/sessionStore";
import { SNAPSHOT_COLUMNS } from "../../src/models/history";
import { sha256Hex } from "../../src/utils/sha256";
import { fakeRuntimeFetch, memoryDeps, parseSingleRowCsv, SESSION } from "../fixtures";

const OWNER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER_B = "bbbbbbbb-0000-0000-0000-000000000002";

async function setup(userId = OWNER_A) {
  const deps = memoryDeps(fakeRuntimeFetch(), { userId });
  const connection = await resolveConnection({ connectionId: "conn-object-0001" }, deps);
  return { deps, connection };
}

async function saveOne(userId = OWNER_A) {
  const { deps, connection } = await setup(userId);
  const preview = await previewSave(connection, { sessionId: SESSION.id }, deps);
  const saved = await saveSession(connection, { sessionId: SESSION.id, title: "Checkout RCA", expectedSha256: preview.sha256 }, deps);
  return { deps, connection, preview, saved };
}

describe("save preview", () => {
  it("returns redacted Markdown without hidden reasoning, plus its hash", async () => {
    const { deps, connection } = await setup();
    const preview = await previewSave(connection, { sessionId: SESSION.id }, deps);
    expect(preview.markdown).not.toContain("HIDDEN-REASONING");
    expect(preview.markdown).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(preview.redactions).toBeGreaterThan(0);
    expect(preview.sha256).toBe(await sha256Hex(preview.markdown));
    expect(preview.markdown).toContain("abc12345.apps.dynatrace.com");
    expect(deps.store.files.size).toBe(0);
  });
});

describe("save", () => {
  it("requires a reviewed preview", async () => {
    const { deps, connection } = await setup();
    await expect(saveSession(connection, { sessionId: SESSION.id, title: "x" }, deps)).rejects.toMatchObject({ code: "preview_required" });
  });

  it("rejects saving when the conversation changed after the preview", async () => {
    const { deps, connection } = await setup();
    await expect(saveSession(connection, { sessionId: SESSION.id, title: "x", expectedSha256: "0".repeat(64) }, deps)).rejects.toMatchObject({
      code: "conversation_changed",
    });
  });

  it("writes one immutable snapshot and one index resource under the owner's paths", async () => {
    const { deps, preview, saved } = await saveOne();
    const paths = [...deps.store.files.keys()].sort();
    expect(paths).toEqual([`/lookups/rocky-agent/index/${OWNER_A}/${saved.savedId}`, `/lookups/rocky-agent/sessions/${OWNER_A}/${saved.savedId}`]);
    const snapshot = deps.store.files.get(`/lookups/rocky-agent/sessions/${OWNER_A}/${saved.savedId}`)!;
    expect(snapshot.overwrite).toBe(false);
    expect(snapshot.parsePattern).toBe(SNAPSHOT_PATTERN);
    expect(snapshot.skippedRecords).toBe(1);
    const row = parseSingleRowCsv(snapshot.content);
    expect(Object.keys(row)).toEqual([...SNAPSHOT_COLUMNS]);
    expect(row.markdown_content).toBe(preview.markdown);
    expect(row.content_sha256).toBe(preview.sha256);
    expect(row.owner_id).toBe(OWNER_A);
    expect(row.connection_id).toBe("conn-object-0001");
    expect(row.schema_version).toBe("1");
  });

  it("never stores secrets", async () => {
    const { deps } = await saveOne();
    const everything = [...deps.store.files.values()].map((f) => f.content).join("\n");
    expect(everything).not.toContain("correct-password-123456");
    expect(everything).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(everything).not.toMatch(/dt0s16\.ABCDEFGH/);
    expect(everything).not.toMatch(/Authorization: Bearer [^[]/);
  });

  it("refuses to overwrite an existing snapshot", async () => {
    const { deps, connection, preview, saved } = await saveOne();
    deps.now = () => new Date(Date.parse(saved.savedAt ?? "") + 100);
    await expect(saveSession(connection, { sessionId: SESSION.id, title: "again", expectedSha256: preview.sha256 }, deps)).rejects.toMatchObject({
      code: "already_exists",
    });
  });
});

describe("history", () => {
  it("lists, reads and verifies a saved session", async () => {
    const { deps, saved, preview } = await saveOne();
    const list = await listSaved(deps);
    expect(list).toEqual([{ savedId: saved.savedId, title: "Checkout RCA", savedAt: expect.any(String), updatedAt: expect.any(String) }]);
    const detail = await readSaved({ savedId: saved.savedId }, deps);
    expect(detail.markdown).toBe(preview.markdown);
    expect(detail.integrityVerified).toBe(true);
    expect(detail.originalSessionId).toBe(SESSION.id);
  });

  it("isolates owners", async () => {
    const { deps } = await saveOne(OWNER_A);
    const other = memoryDeps(fakeRuntimeFetch(), { userId: OWNER_B });
    other.store.files = deps.store.files;
    expect(await listSaved(other)).toEqual([]);
    const id = [...deps.store.files.keys()][0].split("/").pop()!;
    await expect(readSaved({ savedId: id }, other)).rejects.toMatchObject({ code: "not_found" });
  });

  it("renames only the index; the snapshot is untouched", async () => {
    const { deps, saved } = await saveOne();
    const snapshotPath = `/lookups/rocky-agent/sessions/${OWNER_A}/${saved.savedId}`;
    const before = deps.store.files.get(snapshotPath)!.content;
    await renameSaved({ savedId: saved.savedId, title: "Renamed RCA" }, deps);
    expect(deps.store.files.get(snapshotPath)!.content).toBe(before);
    const index = parseSingleRowCsv(deps.store.files.get(`/lookups/rocky-agent/index/${OWNER_A}/${saved.savedId}`)!.content);
    expect(index.display_title).toBe("Renamed RCA");
    expect(index.status).toBe("active");
    const detail = await readSaved({ savedId: saved.savedId }, deps);
    expect(detail.title).toBe("Renamed RCA");
    expect(detail.integrityVerified).toBe(true);
  });

  it("detects tampered snapshots", async () => {
    const { deps, saved } = await saveOne();
    const path = `/lookups/rocky-agent/sessions/${OWNER_A}/${saved.savedId}`;
    const file = deps.store.files.get(path)!;
    deps.store.files.set(path, { ...file, content: file.content.replace("tool finished", "tool tampered") });
    expect((await readSaved({ savedId: saved.savedId }, deps)).integrityVerified).toBe(false);
  });

  it("requires typed confirmation for permanent deletion and removes both resources", async () => {
    const { deps, saved } = await saveOne();
    await expect(deleteSaved({ savedId: saved.savedId, confirmation: "yes" }, deps)).rejects.toMatchObject({ code: "confirmation_required" });
    expect(deps.store.files.size).toBe(2);
    await deleteSaved({ savedId: saved.savedId, confirmation: "DELETE" }, deps);
    expect(deps.store.files.size).toBe(0);
    expect(deps.store.logs.map((l) => l.type)).toEqual(["rocky.session.saved", "rocky.session.deleted"]);
    expect(JSON.stringify(deps.store.logs)).not.toContain("REDACTED");
  });

  it("rejects unsafe IDs", async () => {
    const { deps } = await setup();
    await expect(readSaved({ savedId: "../../other/x" }, deps)).rejects.toMatchObject({ code: "invalid_parameter" });
    await expect(renameSaved({ savedId: "x", title: "" }, deps)).rejects.toMatchObject({ code: "invalid_parameter" });
  });
});
