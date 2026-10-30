import type { OcMessage, OcPart } from "../models/runtime";

function partFingerprint(part: OcPart): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return `${part.id}:${part.text.length}`;
    case "tool":
      return `${part.id}:${part.state.status}`;
    default:
      return part.id;
  }
}

export function messageFingerprint(message: OcMessage): string {
  const completed = message.info.role === "assistant" ? (message.info.time.completed ?? 0) : 0;
  return `${message.info.id}|${completed}|${message.parts.map(partFingerprint).join(",")}`;
}

export interface MergeResult {
  messages: OcMessage[];
  changed: boolean;
}

// Merges a polled page into the current list without duplicates. Messages are
// keyed by ID, parts by part ID (newer versions replace older ones), and the
// result is ordered by creation time.
export function mergeMessages(current: OcMessage[], incoming: OcMessage[]): MergeResult {
  const byId = new Map(current.map((m) => [m.info.id, m]));
  let changed = false;
  for (const message of incoming) {
    const existing = byId.get(message.info.id);
    if (!existing) {
      byId.set(message.info.id, message);
      changed = true;
      continue;
    }
    if (messageFingerprint(existing) === messageFingerprint(message)) continue;
    const parts = new Map(existing.parts.map((p) => [p.id, p]));
    for (const part of message.parts) parts.set(part.id, part);
    byId.set(message.info.id, { info: message.info, parts: [...parts.values()] });
    changed = true;
  }
  const messages = [...byId.values()].sort(
    (a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0) || a.info.id.localeCompare(b.info.id),
  );
  return { messages, changed };
}
