// Rocky runtime API. Every route is listed here; anything else is rejected.
// Only /rocky/v1/livez is public; every other route needs basic auth.

const SESSION = "(ses_[0-9a-f-]{36})";
const PERMISSION = "(per_[0-9a-f]{24})";

function route(name, method, path, options = {}) {
  return {
    name,
    method,
    pattern: new RegExp(`^${path}$`),
    query: options.query ?? [],
    public: options.public ?? false,
  };
}

export const ROUTES = [
  route("livez", "GET", "/rocky/v1/livez", { public: true }),
  route("health", "GET", "/rocky/v1/health"),
  route("status", "GET", "/rocky/v1/status"),
  route("status.refresh", "POST", "/rocky/v1/status/refresh"),
  route("policy", "GET", "/rocky/v1/policy"),
  route("skills", "GET", "/rocky/v1/skills"),
  route("session.list", "GET", "/rocky/v1/sessions", { query: ["limit"] }),
  route("session.create", "POST", "/rocky/v1/sessions"),
  route("session.status", "GET", "/rocky/v1/sessions/status"),
  route("session.get", "GET", `/rocky/v1/sessions/${SESSION}`),
  route("session.update", "PATCH", `/rocky/v1/sessions/${SESSION}`),
  route("session.delete", "DELETE", `/rocky/v1/sessions/${SESSION}`),
  route("session.messages", "GET", `/rocky/v1/sessions/${SESSION}/messages`, { query: ["limit"] }),
  route("session.snapshot", "GET", `/rocky/v1/sessions/${SESSION}/snapshot`, { query: ["limit"] }),
  route("session.prompt", "POST", `/rocky/v1/sessions/${SESSION}/prompt`),
  route("session.abort", "POST", `/rocky/v1/sessions/${SESSION}/abort`),
  route("session.todo", "GET", `/rocky/v1/sessions/${SESSION}/todo`),
  route("session.artifacts", "GET", `/rocky/v1/sessions/${SESSION}/artifacts`),
  route("session.policy.get", "GET", `/rocky/v1/sessions/${SESSION}/policy`),
  route("session.policy.put", "PUT", `/rocky/v1/sessions/${SESSION}/policy`),
  route("permission.list", "GET", "/rocky/v1/permissions"),
  route("permission.reply", "POST", `/rocky/v1/permissions/${PERMISSION}/reply`),
];

export function isSafePath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;
  if (pathname.length > 512) return false;
  if (pathname.includes("//") || pathname.includes("\\")) return false;
  if (/(^|\/)\.\.?(\/|$)/.test(pathname)) return false;
  if (/%2f|%5c|%2e/i.test(pathname)) return false;
  return true;
}

export function matchRoute(method, pathname) {
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (match) return { route: candidate, params: match.slice(1) };
  }
  return null;
}

// Positive integer query parameter within bounds, or the fallback.
export function intParam(searchParams, name, fallback, max) {
  const raw = searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback;
}
