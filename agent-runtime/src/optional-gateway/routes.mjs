// Route allowlist for the Rocky gateway.
//
// Only the OpenCode operations the Rocky UI needs are forwarded. Everything else
// is rejected, including PTY sessions, shell execution, configuration and
// credential mutation, MCP registration and self-upgrade.

const ID = "[A-Za-z0-9_-]{1,128}";
const SESSION = `(ses${ID})`;

function route(name, method, path, options = {}) {
  return {
    name,
    method,
    pattern: new RegExp(`^${path}$`),
    query: options.query ?? [],
    sanitize: options.sanitize ?? null,
    native: options.native ?? false,
    public: options.public ?? false,
  };
}

export const ROUTES = [
  // Gateway-native endpoints.
  route("rocky.livez", "GET", "/rocky/v1/livez", { native: true, public: true }),
  route("rocky.status", "GET", "/rocky/v1/status", { native: true }),
  route("rocky.status.refresh", "POST", "/rocky/v1/status/refresh", { native: true }),
  route("rocky.policy", "GET", "/rocky/v1/policy", { native: true }),
  route("rocky.session.policy.get", "GET", `/rocky/v1/sessions/${SESSION}/policy`, { native: true }),
  route("rocky.session.policy.put", "PUT", `/rocky/v1/sessions/${SESSION}/policy`, { native: true }),

  // OpenCode operations forwarded to the loopback server.
  route("global.health", "GET", "/global/health"),
  route("provider.list", "GET", "/provider"),
  route("config.providers", "GET", "/config/providers"),
  route("agent.list", "GET", "/agent"),
  route("skill.list", "GET", "/skill"),
  route("session.list", "GET", "/session", { query: ["limit", "search", "start", "roots"] }),
  route("session.create", "POST", "/session", { sanitize: "sessionCreate" }),
  route("session.status", "GET", "/session/status"),
  route("session.get", "GET", `/session/${SESSION}`),
  route("session.update", "PATCH", `/session/${SESSION}`, { sanitize: "sessionUpdate" }),
  route("session.delete", "DELETE", `/session/${SESSION}`),
  route("session.messages", "GET", `/session/${SESSION}/message`, { query: ["limit", "before"] }),
  route("session.message", "GET", `/session/${SESSION}/message/(msg${ID})`),
  route("session.prompt_async", "POST", `/session/${SESSION}/prompt_async`, { sanitize: "prompt" }),
  route("session.abort", "POST", `/session/${SESSION}/abort`),
  route("session.diff", "GET", `/session/${SESSION}/diff`, { query: ["messageID"] }),
  route("session.todo", "GET", `/session/${SESSION}/todo`),
  route("session.children", "GET", `/session/${SESSION}/children`),
  route("permission.list", "GET", "/permission"),
  route("permission.reply", "POST", `/permission/(per${ID})/reply`, { sanitize: "permissionReply" }),
  route("question.list", "GET", "/question"),
  route("question.reply", "POST", `/question/(${ID})/reply`, { sanitize: "questionReply" }),
  route("question.reject", "POST", `/question/(${ID})/reject`),
];

// Never forwarded, not even in console mode.
export const HARD_DENY = [
  { pattern: /^\/(api\/)?pty(\/|$)/, reason: "terminal access is not exposed" },
  { pattern: /^\/session\/[^/]+\/shell$/, reason: "direct shell execution is not exposed" },
  { pattern: /^\/session\/[^/]+\/permissions\//, reason: "use /permission/{id}/reply" },
  { pattern: /^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/, reason: "use /permission/{id}/reply" },
  { pattern: /^\/(global\/)?config$/, methods: ["PATCH", "PUT", "POST", "DELETE"], reason: "configuration is read-only" },
  { pattern: /^\/auth\//, reason: "provider credentials are managed by deployment secrets" },
  { pattern: /^\/api\/(credential|integration)(\/|$)/, reason: "provider credentials are managed by deployment secrets" },
  { pattern: /^\/provider\/[^/]+\/oauth\//, reason: "provider credentials are managed by deployment secrets" },
  { pattern: /^\/mcp(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], reason: "MCP servers are configured at deployment time" },
  { pattern: /^\/global\/(upgrade|dispose)$/, reason: "lifecycle operations are not exposed" },
  { pattern: /^\/instance\/dispose$/, reason: "lifecycle operations are not exposed" },
  { pattern: /^\/experimental\//, reason: "experimental operations are not exposed" },
  { pattern: /^\/sync\//, reason: "sync operations are not exposed" },
  { pattern: /^\/tui\//, reason: "TUI control is not exposed" },
  { pattern: /^\/vcs\/apply$/, reason: "repository mutation is not exposed" },
  { pattern: /^\/project\/git\/init$/, reason: "repository mutation is not exposed" },
  { pattern: /^\/project\/[^/]+$/, methods: ["PATCH"], reason: "project mutation is not exposed" },
  { pattern: /^\/session\/[^/]+\/share$/, reason: "public sharing is disabled" },
];

// Console mode forwards these extra request prefixes (after HARD_DENY) so the
// OpenCode web console can load. Prompt bodies are still sanitized.
export const CONSOLE_SANITIZERS = [
  { method: "POST", pattern: /^\/session\/[^/]+\/message$/, sanitize: "prompt" },
  { method: "POST", pattern: /^\/session\/[^/]+\/prompt_async$/, sanitize: "prompt" },
  { method: "POST", pattern: /^\/session$/, sanitize: "sessionCreate" },
  { method: "PATCH", pattern: /^\/session\/[^/]+$/, sanitize: "sessionUpdate" },
  { method: "POST", pattern: /^\/permission\/[^/]+\/reply$/, sanitize: "permissionReply" },
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

export function hardDenyReason(method, pathname) {
  for (const rule of HARD_DENY) {
    if (rule.methods && !rule.methods.includes(method)) continue;
    if (rule.pattern.test(pathname)) return rule.reason;
  }
  return null;
}

export function consoleSanitizer(method, pathname) {
  const rule = CONSOLE_SANITIZERS.find((r) => r.method === method && r.pattern.test(pathname));
  return rule ? rule.sanitize : null;
}

export function filterQuery(searchParams, allowed) {
  const out = new URLSearchParams();
  for (const name of allowed) {
    const value = searchParams.get(name);
    if (value !== null && value.length <= 256) out.set(name, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}
