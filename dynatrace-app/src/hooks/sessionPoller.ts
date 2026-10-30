import type { OcMessage, OcPermissionRequest, OcSessionStatus } from "../models/runtime";
import type { SessionSnapshot } from "../services/runtime";
import { backoffDelay } from "../utils/backoff";
import { mergeMessages } from "../utils/messages";

export interface PollerState {
  messages: OcMessage[];
  status: OcSessionStatus;
  permissions: OcPermissionRequest[];
  childIds: string[];
  error: unknown;
  polling: boolean;
  stalled: boolean;
  initialized: boolean;
}

export interface PollerOptions {
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  maxActiveBackoffMs?: number;
  maxErrorBackoffMs?: number;
  maxConsecutiveErrors?: number;
  stallTimeoutMs?: number;
  pageLimit?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

type FetchSnapshot = (limit: number | undefined, signal: AbortSignal) => Promise<SessionSnapshot>;

// Short-polling loop for one runtime session.
//
// * The first poll loads the full history; later polls request the newest
//   `pageLimit` messages and merge them by message/part ID (no duplicates).
// * While the agent works, polls run quickly and back off exponentially when
//   nothing changes; an idle session is polled slowly.
// * Errors back off and stop after `maxConsecutiveErrors`.
// * A busy session without progress for `stallTimeoutMs` stops polling and is
//   flagged as stalled; `nudge()` resumes.
// * `stop()` cancels the in-flight request and the timer.
export class SessionPoller {
  private state: PollerState = {
    messages: [],
    status: { type: "idle" },
    permissions: [],
    childIds: [],
    error: null,
    polling: false,
    stalled: false,
    initialized: false,
  };
  private controller: AbortController | null = null;
  private timer: unknown = null;
  private quietPolls = 0;
  private errors = 0;
  private lastChange = 0;
  private running = false;
  private readonly opts: Required<PollerOptions>;

  constructor(
    private readonly sessionId: string,
    private readonly fetchSnapshot: FetchSnapshot,
    private readonly onState: (state: PollerState) => void,
    options: PollerOptions = {},
  ) {
    this.opts = {
      activeIntervalMs: 1_000,
      idleIntervalMs: 15_000,
      maxActiveBackoffMs: 8_000,
      maxErrorBackoffMs: 30_000,
      maxConsecutiveErrors: 8,
      stallTimeoutMs: 10 * 60_000,
      pageLimit: 30,
      now: () => Date.now(),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastChange = this.opts.now();
    this.update({ polling: true, stalled: false });
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) this.opts.cancel(this.timer);
    this.timer = null;
    this.update({ polling: false });
  }

  // Poll again right away (after sending a prompt or answering a permission).
  nudge(): void {
    this.quietPolls = 0;
    this.errors = 0;
    this.lastChange = this.opts.now();
    if (!this.running) {
      this.start();
      return;
    }
    if (this.timer !== null) this.opts.cancel(this.timer);
    this.timer = null;
    this.update({ stalled: false });
    if (!this.controller) void this.tick();
  }

  // Optimistically mark the session busy while a prompt is accepted.
  markBusy(): void {
    this.update({ status: { type: "busy" } });
  }

  private update(patch: Partial<PollerState>): void {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    this.timer = this.opts.schedule(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const limit = this.state.initialized ? this.opts.pageLimit : undefined;
      const snapshot = await this.fetchSnapshot(limit, controller.signal);
      if (!this.running || controller.signal.aborted) return;
      this.controller = null;
      this.errors = 0;

      const childIds = (snapshot.children ?? []).map((c) => c.id);
      const relevant = new Set([this.sessionId, ...childIds]);
      const { messages, changed } = mergeMessages(this.state.messages, snapshot.messages ?? []);
      const permissions = (snapshot.permissions ?? []).filter((p) => relevant.has(p.sessionID));
      const permissionsChanged =
        permissions.map((p) => p.id).join(",") !== this.state.permissions.map((p) => p.id).join(",");
      const ownStatus = snapshot.status?.[this.sessionId] ?? { type: "idle" };
      const childBusy = childIds.some((id) => (snapshot.status?.[id]?.type ?? "idle") !== "idle");
      const status: OcSessionStatus = ownStatus.type === "idle" && childBusy ? { type: "busy" } : ownStatus;
      const statusChanged = status.type !== this.state.status.type;
      const busy = status.type !== "idle" || permissions.length > 0;

      this.update({ messages, permissions, status, childIds, error: null, initialized: true });

      const now = this.opts.now();
      if (changed || permissionsChanged || statusChanged) {
        this.lastChange = now;
        this.quietPolls = 0;
        this.schedule(busy ? this.opts.activeIntervalMs : this.opts.idleIntervalMs);
        return;
      }
      if (!busy) {
        this.schedule(this.opts.idleIntervalMs);
        return;
      }
      if (permissions.length === 0 && now - this.lastChange > this.opts.stallTimeoutMs) {
        this.running = false;
        this.update({ polling: false, stalled: true });
        return;
      }
      this.quietPolls += 1;
      this.schedule(backoffDelay(this.quietPolls, { baseMs: this.opts.activeIntervalMs, maxMs: this.opts.maxActiveBackoffMs, jitter: 0 }));
    } catch (error) {
      if (controller.signal.aborted || !this.running) return;
      this.controller = null;
      this.errors += 1;
      this.update({ error });
      if (this.errors >= this.opts.maxConsecutiveErrors) {
        this.running = false;
        this.update({ polling: false });
        return;
      }
      this.schedule(backoffDelay(this.errors, { baseMs: 2_000, maxMs: this.opts.maxErrorBackoffMs, jitter: 0 }));
    }
  }
}
