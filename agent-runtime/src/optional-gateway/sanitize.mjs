// Request body sanitizers. Each one returns a new object that contains only
// the fields the Rocky UI is allowed to send. Client-supplied `permission`,
// `system`, `tools`, `directory` and `workspaceID` values are always dropped.

export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_TITLE = 200;
const MAX_PART_TEXT = 100_000;
const MAX_PARTS = 20;
const MAX_TOTAL_TEXT = 200_000;
const ALLOWED_AGENTS = new Set(["build", "plan"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(body) {
  if (!isPlainObject(body)) throw new GatewayError(400, "invalid_body", "Request body must be a JSON object");
  return body;
}

function cleanTitle(value, { required }) {
  if (value === undefined || value === null) {
    if (required) throw new GatewayError(400, "invalid_title", "title is required");
    return undefined;
  }
  if (typeof value !== "string") throw new GatewayError(400, "invalid_title", "title must be a string");
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (required && title.length === 0) throw new GatewayError(400, "invalid_title", "title must not be empty");
  if (title.length > MAX_TITLE) throw new GatewayError(400, "invalid_title", `title must be at most ${MAX_TITLE} characters`);
  return title;
}

function cleanString(value, name, { pattern, max = 200 } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > max || (pattern && !pattern.test(value))) {
    throw new GatewayError(400, "invalid_field", `${name} is invalid`);
  }
  return value;
}

export function sanitizeSessionCreate(body) {
  const input = body === undefined || body === null ? {} : requireObject(body);
  const out = {};
  const title = cleanTitle(input.title, { required: false });
  if (title) out.title = title;
  const parentID = cleanString(input.parentID, "parentID", { pattern: /^ses[A-Za-z0-9_-]+$/ });
  if (parentID) out.parentID = parentID;
  if (input.model !== undefined) {
    if (!isPlainObject(input.model)) throw new GatewayError(400, "invalid_field", "model is invalid");
    out.model = {
      id: cleanString(input.model.id, "model.id"),
      providerID: cleanString(input.model.providerID, "model.providerID"),
    };
    if (!out.model.id || !out.model.providerID) throw new GatewayError(400, "invalid_field", "model is invalid");
  }
  return out;
}

export function sanitizeSessionUpdate(body) {
  const input = requireObject(body);
  return { title: cleanTitle(input.title, { required: true }) };
}

export function sanitizePrompt(body, { system } = {}) {
  const input = requireObject(body);
  if (!Array.isArray(input.parts) || input.parts.length === 0 || input.parts.length > MAX_PARTS) {
    throw new GatewayError(400, "invalid_parts", `parts must contain between 1 and ${MAX_PARTS} items`);
  }
  let total = 0;
  const parts = input.parts.map((part) => {
    if (!isPlainObject(part) || part.type !== "text" || typeof part.text !== "string") {
      throw new GatewayError(400, "invalid_parts", "only text parts are accepted");
    }
    if (part.text.length === 0 || part.text.length > MAX_PART_TEXT) {
      throw new GatewayError(400, "invalid_parts", `each text part must be 1-${MAX_PART_TEXT} characters`);
    }
    total += part.text.length;
    return { type: "text", text: part.text };
  });
  if (total > MAX_TOTAL_TEXT) throw new GatewayError(413, "prompt_too_large", "prompt is too large");

  const out = { parts };
  const messageID = cleanString(input.messageID, "messageID", { pattern: /^msg[A-Za-z0-9_-]+$/ });
  if (messageID) out.messageID = messageID;
  if (input.agent !== undefined) {
    if (!ALLOWED_AGENTS.has(input.agent)) throw new GatewayError(400, "invalid_field", "agent must be build or plan");
    out.agent = input.agent;
  }
  if (input.model !== undefined) {
    if (!isPlainObject(input.model)) throw new GatewayError(400, "invalid_field", "model is invalid");
    out.model = {
      providerID: cleanString(input.model.providerID, "model.providerID"),
      modelID: cleanString(input.model.modelID, "model.modelID"),
    };
    if (!out.model.providerID || !out.model.modelID) throw new GatewayError(400, "invalid_field", "model is invalid");
  }
  if (system) out.system = system;
  return out;
}

export function sanitizePermissionReply(body) {
  const input = requireObject(body);
  if (input.reply === "always") {
    throw new GatewayError(
      400,
      "scoped_confirmation_required",
      "Permanent approvals are disabled. Each operation needs its own confirmation (reply 'once' or 'reject').",
    );
  }
  if (input.reply !== "once" && input.reply !== "reject") {
    throw new GatewayError(400, "invalid_reply", "reply must be 'once' or 'reject'");
  }
  const out = { reply: input.reply };
  if (input.message !== undefined) {
    if (typeof input.message !== "string" || input.message.length > 2000) {
      throw new GatewayError(400, "invalid_field", "message must be a string of at most 2000 characters");
    }
    out.message = input.message;
  }
  return out;
}

export function sanitizeQuestionReply(body) {
  const input = requireObject(body);
  if (!Array.isArray(input.answers) || input.answers.length > 20) {
    throw new GatewayError(400, "invalid_answers", "answers must be an array");
  }
  const answers = input.answers.map((answer) => {
    if (!Array.isArray(answer) || answer.length > 20 || !answer.every((a) => typeof a === "string" && a.length <= 2000)) {
      throw new GatewayError(400, "invalid_answers", "each answer must be an array of strings");
    }
    return answer;
  });
  return { answers };
}

export const SANITIZERS = {
  sessionCreate: sanitizeSessionCreate,
  sessionUpdate: sanitizeSessionUpdate,
  prompt: sanitizePrompt,
  permissionReply: sanitizePermissionReply,
  questionReply: sanitizeQuestionReply,
};
