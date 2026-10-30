// Types of the Rocky runtime API (/rocky/v1). The gateway translates Claude
// Code's event stream into these message shapes (originally modeled on the
// OpenCode server API, hence the Oc prefix).

export type ComponentState =
  | "connected"
  | "ready"
  | "degraded"
  | "unavailable"
  | "authentication_required"
  | "authentication_failed"
  | "not_configured"
  | "installed"
  | "partial"
  | "missing"
  | "read_only"
  | "unknown";

export interface RuntimeStatus {
  schemaVersion: number;
  checkedAt: string;
  runtime: {
    status: ComponentState;
    version: string;
    nodeEnv: string;
    gateway: string;
    uptimeSeconds: number;
    activeRuns: number;
    // True while the runtime still uses the public default password (runtime 0.2.1+).
    defaultPassword?: boolean;
  };
  agent: { status: ComponentState; name: string; version: string | null };
  // authMethod: none | claude.ai | oauth_token | api_key | api_key_helper | third_party (Claude Code `auth status`)
  claude: { status: ComponentState; authMethod: string; apiProvider: string | null; model: string | null; loginCommand: string };
  dynatrace: { status: ComponentState; environmentHost: string; checkedAt: string | null; detail: string | null };
  dtctl: { status: ComponentState; version: string | null; safetyLevel: string | null };
  skills: {
    status: ComponentState;
    count: number;
    official: number;
    custom: string[];
    drawio: boolean;
    missing: string[];
    items: { name: string; source: string }[];
  };
  workspace: { status: ComponentState; path: string; freeBytes?: number };
  policy: { baselineSha256: string };
  warnings: string[];
}

export interface OcSession {
  id: string;
  slug?: string;
  title: string;
  parentID?: string;
  time: { created: number; updated: number; archived?: number };
  model?: { id: string; providerID: string };
  agent?: string;
}

export type OcSessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

interface OcMessageBase {
  id: string;
  sessionID: string;
  agent?: string;
}

export interface OcUserMessage extends OcMessageBase {
  role: "user";
  time: { created: number };
  model?: { providerID: string; modelID: string };
}

export interface OcAssistantMessage extends OcMessageBase {
  role: "assistant";
  time: { created: number; completed?: number };
  modelID?: string;
  providerID?: string;
  error?: { name?: string; data?: { message?: string } };
  finish?: string;
}

export type OcMessageInfo = OcUserMessage | OcAssistantMessage;

interface OcPartBase {
  id: string;
  sessionID: string;
  messageID: string;
}

export interface OcTextPart extends OcPartBase {
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
}

export interface OcReasoningPart extends OcPartBase {
  type: "reasoning";
  text: string;
}

export type OcToolState =
  | { status: "pending"; input?: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
  | { status: "error"; input: Record<string, unknown>; error: string };

export interface OcToolPart extends OcPartBase {
  type: "tool";
  callID: string;
  tool: string;
  state: OcToolState;
}

export interface OcSubtaskPart extends OcPartBase {
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
}

export interface OcFilePart extends OcPartBase {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export interface OcOtherPart extends OcPartBase {
  type: "step-start" | "step-finish" | "snapshot" | "patch" | "agent" | "retry" | "compaction";
}

export type OcPart = OcTextPart | OcReasoningPart | OcToolPart | OcSubtaskPart | OcFilePart | OcOtherPart;

export interface OcMessage {
  info: OcMessageInfo;
  parts: OcPart[];
}

export interface OcPermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface RuntimePolicy {
  baseline: string;
  baselineSha256: string;
  overlayMaxChars: number;
  protectedRules: string[];
}

export interface SessionPolicy {
  sessionID: string;
  overlay: string;
  updatedAt: string | null;
}
