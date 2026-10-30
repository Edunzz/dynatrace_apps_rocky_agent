// Runtime sessions: one JSON file per session under ROCKY_DATA_DIR/sessions.
//
// Each Rocky session maps to one Claude Code conversation (`claudeSessionId`,
// a UUID passed with --session-id / --resume). The file keeps the translated
// messages the app shows; Claude Code keeps its own transcript under
// CLAUDE_CONFIG_DIR/projects, which is removed together with the session.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GatewayError } from "./sanitize.mjs";

const SESSION_ID = /^ses_([0-9a-f-]{36})$/;
const MAX_SESSIONS = 500;
const SAVE_DELAY_MS = 500;

export function publicSession(session) {
  return { id: session.id, title: session.title, time: { ...session.time }, ...(session.model ? { model: session.model } : {}) };
}

export class SessionStore {
  constructor({ dir, claudeConfigDir, now = () => Date.now(), logger }) {
    this.dir = dir;
    this.claudeConfigDir = claudeConfigDir;
    this.now = now;
    this.logger = logger;
    this.sessions = new Map();
    this.timers = new Map();
    this.writes = new Map();
  }

  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const session = JSON.parse(await readFile(join(this.dir, name), "utf8"));
        if (SESSION_ID.test(session?.id) && Array.isArray(session.messages)) this.sessions.set(session.id, session);
      } catch {
        this.logger?.warn("skipping unreadable session file", { file: name });
      }
    }
    return this.sessions.size;
  }

  list(limit = 100) {
    return [...this.sessions.values()]
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, limit)
      .map(publicSession);
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new GatewayError(404, "session_not_found", "Session not found");
    return session;
  }

  has(id) {
    return this.sessions.has(id);
  }

  create({ title } = {}) {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new GatewayError(409, "too_many_sessions", `This runtime keeps at most ${MAX_SESSIONS} sessions. Delete old ones first.`);
    }
    const uuid = randomUUID();
    const now = this.now();
    const session = {
      id: `ses_${uuid}`,
      claudeSessionId: uuid,
      title: title ?? "",
      time: { created: now, updated: now },
      started: false,
      messages: [],
      todos: [],
      artifacts: [],
    };
    this.sessions.set(session.id, session);
    this.save(session.id);
    return session;
  }

  rename(id, title) {
    const session = this.get(id);
    session.title = title;
    session.time.updated = this.now();
    this.save(id);
    return session;
  }

  async delete(id) {
    const session = this.get(id);
    this.sessions.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.writes.get(id);
    await rm(join(this.dir, `${id}.json`), { force: true });
    await this.removeTranscript(session.claudeSessionId);
    return session;
  }

  // Claude Code stores <uuid>.jsonl (and a <uuid>/ folder for subagents) in a
  // per-project folder; search them all instead of rebuilding its folder name.
  async removeTranscript(uuid) {
    const projects = join(this.claudeConfigDir, "projects");
    let folders = [];
    try {
      folders = await readdir(projects);
    } catch {
      return;
    }
    await Promise.all(
      folders.flatMap((folder) => [
        rm(join(projects, folder, `${uuid}.jsonl`), { force: true }),
        rm(join(projects, folder, uuid), { force: true, recursive: true }),
      ]),
    );
  }

  // Debounced, atomic write of one session file.
  save(id, { immediate = false } = {}) {
    clearTimeout(this.timers.get(id));
    if (immediate) return this.write(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.write(id);
      }, SAVE_DELAY_MS),
    );
    return undefined;
  }

  write(id) {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const session = this.sessions.get(id);
      if (!session) return;
      const file = join(this.dir, `${id}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(session), { mode: 0o600 });
        await rename(tmp, file);
      } catch (error) {
        this.logger?.error("could not save session", { sessionID: id, error: String(error?.message ?? error) });
      }
    });
    this.writes.set(id, next);
    return next;
  }

  async flush() {
    const ids = [...this.timers.keys()];
    for (const id of ids) clearTimeout(this.timers.get(id));
    this.timers.clear();
    await Promise.all([...ids.map((id) => this.write(id)), ...this.writes.values()]);
  }
}
