import { type PollerState, SessionPoller } from "../../src/hooks/sessionPoller";
import type { OcMessage, OcSessionStatus } from "../../src/models/runtime";
import type { SessionSnapshot } from "../../src/services/runtime";
import { MESSAGES, PERMISSION, SESSION } from "../fixtures";

// Deterministic scheduler: timers run only when the test advances them.
function scheduler() {
  let now = 0;
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = ++seq;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    cancel: (id: unknown) => {
      const i = queue.findIndex((t) => t.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    pendingDelay: () => (queue.length ? Math.min(...queue.map((t) => t.at)) - now : null),
    async runNext() {
      queue.sort((a, b) => a.at - b.at);
      const next = queue.shift();
      if (!next) return false;
      now = next.at;
      next.fn();
      await flush();
      return true;
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function snapshot(messages: OcMessage[], status: OcSessionStatus, extra: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { messages, status: { [SESSION.id]: status }, permissions: [], children: [], ...extra };
}

function setup(responses: (SessionSnapshot | Error)[]) {
  const s = scheduler();
  const limits: (number | undefined)[] = [];
  const signals: AbortSignal[] = [];
  let call = 0;
  let state: PollerState | null = null;
  const fetchSnapshot = (limit: number | undefined, signal: AbortSignal) => {
    limits.push(limit);
    signals.push(signal);
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  };
  const poller = new SessionPoller(SESSION.id, fetchSnapshot, (st) => (state = st), {
    now: s.now,
    schedule: s.schedule,
    cancel: s.cancel,
    activeIntervalMs: 1000,
    idleIntervalMs: 15000,
    maxActiveBackoffMs: 8000,
    maxErrorBackoffMs: 30000,
    maxConsecutiveErrors: 3,
    stallTimeoutMs: 60_000,
    pageLimit: 30,
  });
  return { s, poller, limits, signals, state: () => state! };
}

describe("SessionPoller", () => {
  it("loads the full history first, then polls the newest page", async () => {
    const t = setup([snapshot(MESSAGES, { type: "busy" }), snapshot(MESSAGES, { type: "busy" })]);
    t.poller.start();
    await flush();
    expect(t.limits).toEqual([undefined]);
    expect(t.state().messages).toHaveLength(3);
    await t.s.runNext();
    expect(t.limits).toEqual([undefined, 30]);
    expect(t.state().messages).toHaveLength(3);
  });

  it("backs off while busy without changes", async () => {
    const t = setup([snapshot(MESSAGES, { type: "busy" })]);
    t.poller.start();
    await flush();
    const delays: (number | null)[] = [t.s.pendingDelay()];
    for (let i = 0; i < 4; i += 1) {
      await t.s.runNext();
      delays.push(t.s.pendingDelay());
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("polls slowly when idle", async () => {
    const t = setup([snapshot(MESSAGES, { type: "idle" })]);
    t.poller.start();
    await flush();
    expect(t.s.pendingDelay()).toBe(15000);
  });

  it("keeps polling quickly while a permission request waits, including child sessions", async () => {
    const child = { ...PERMISSION, id: "per_child", sessionID: "ses_child" };
    const other = { ...PERMISSION, id: "per_other", sessionID: "ses_unrelated" };
    const t = setup([
      snapshot(MESSAGES, { type: "idle" }, { permissions: [child, other], children: [{ ...SESSION, id: "ses_child", parentID: SESSION.id }] }),
    ]);
    t.poller.start();
    await flush();
    expect(t.state().permissions.map((p) => p.id)).toEqual(["per_child"]);
    expect(t.s.pendingDelay()).toBe(1000);
  });

  it("backs off on errors and stops after too many", async () => {
    const t = setup([new Error("boom")]);
    t.poller.start();
    await flush();
    expect(t.s.pendingDelay()).toBe(4000);
    await t.s.runNext();
    expect(t.s.pendingDelay()).toBe(8000);
    await t.s.runNext();
    expect(t.s.pendingDelay()).toBeNull();
    expect(t.state().polling).toBe(false);
    expect(t.state().error).toBeInstanceOf(Error);
  });

  it("flags a stalled session and resumes on nudge", async () => {
    const t = setup([snapshot(MESSAGES, { type: "busy" })]);
    t.poller.start();
    await flush();
    while (await t.s.runNext()) {
      if (t.state().stalled) break;
    }
    expect(t.state().stalled).toBe(true);
    expect(t.state().polling).toBe(false);
    t.poller.nudge();
    await flush();
    expect(t.state().polling).toBe(true);
    expect(t.state().stalled).toBe(false);
  });

  it("cancels the in-flight request and timers on stop", async () => {
    const t = setup([snapshot(MESSAGES, { type: "busy" })]);
    t.poller.start();
    t.poller.stop();
    await flush();
    expect(t.signals[0].aborted).toBe(true);
    expect(t.s.pendingDelay()).toBeNull();
    expect(t.state().polling).toBe(false);
  });
});
