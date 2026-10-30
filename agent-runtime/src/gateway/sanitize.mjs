// Request body sanitizers. Each one returns a new object that contains only
// the fields the Rocky UI is allowed to send; anything else is dropped.

export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_TITLE = 200;
export const MAX_PROMPT_CHARS = 100_000;

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

export function sanitizeSessionCreate(body) {
  const input = body === undefined || body === null ? {} : requireObject(body);
  const title = cleanTitle(input.title, { required: false });
  return title ? { title } : {};
}

export function sanitizeSessionUpdate(body) {
  const input = requireObject(body);
  return { title: cleanTitle(input.title, { required: true }) };
}

export function sanitizePrompt(body) {
  const input = requireObject(body);
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new GatewayError(400, "invalid_prompt", "text must be a non-empty string");
  }
  if (input.text.length > MAX_PROMPT_CHARS) {
    throw new GatewayError(413, "prompt_too_large", `text must be at most ${MAX_PROMPT_CHARS} characters`);
  }
  return { text: input.text };
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
