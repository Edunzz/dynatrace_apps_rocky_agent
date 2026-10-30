// Secret redaction for logs, audit events and exported conversations.
// The Dynatrace App has a TypeScript port of these rules (dynatrace-app/src/utils/redact.ts);
// keep both in sync and covered by tests.

export const REDACTED = "[REDACTED]";

export const SENSITIVE_NAME = /(TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|CREDENTIAL|AUTH|PRIVATE_KEY|SESSION_KEY|COOKIE)/i;

const RULES = [
  // PEM private keys (multi-line).
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => REDACTED,
  },
  // Dynatrace API and platform tokens.
  { pattern: /\bdt0[a-z][0-9]{2}\.[A-Za-z0-9]{8,32}\.[A-Za-z0-9]{32,128}\b/g, replace: () => REDACTED },
  // Authorization headers.
  {
    pattern: /\b(Authorization\s*[:=]\s*["']?)(Bearer|Basic|Api-Token|Token)\s+[^\s"'`,;]+/gi,
    replace: (_m, prefix, scheme) => `${prefix}${scheme} ${REDACTED}`,
  },
  // Cookies.
  { pattern: /\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, replace: (_m, prefix) => `${prefix}${REDACTED}` },
  // Bare bearer credentials.
  {
    pattern: /\b(Bearer|Api-Token)\s+[A-Za-z0-9\-._~+/]{16,}=*/g,
    replace: (_m, scheme) => `${scheme} ${REDACTED}`,
  },
  // Credentials embedded in URLs.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@"']+:[^/\s@"']+@/gi,
    replace: (_m, scheme) => `${scheme}${REDACTED}@`,
  },
  // Provider and platform keys.
  { pattern: /\bsk-ant-[A-Za-z0-9\-_]{16,}/g, replace: () => REDACTED },
  { pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9\-_]{20,}/g, replace: () => REDACTED },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: () => REDACTED },
  { pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, replace: () => REDACTED },
  // JSON Web Tokens.
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: () => REDACTED },
  // key=value, key: value and "key": "value" assignments whose key looks sensitive.
  {
    pattern:
      /((?:["']?)[A-Za-z0-9_.-]*(?:token|password|passwd|secret|api[_-]?key|credential|private[_-]?key|session[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["']?)([^\s"',;}]{4,})(["']?)/gi,
    replace: (match, prefix, open, value, close) =>
      value.startsWith(REDACTED) ? match : `${prefix}${open}${REDACTED}${close}`,
  },
];

export function redactText(input) {
  if (typeof input !== "string" || input.length === 0) return input;
  let output = input;
  for (const { pattern, replace } of RULES) {
    output = output.replace(pattern, replace);
  }
  return output;
}

export function redactEnv(env) {
  const result = {};
  for (const [name, value] of Object.entries(env)) {
    result[name] = SENSITIVE_NAME.test(name) ? REDACTED : value;
  }
  return result;
}

export function redactDeep(value, depth = 0) {
  if (depth > 20) return value;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_NAME.test(key) && typeof item === "string" ? REDACTED : redactDeep(item, depth + 1);
    }
    return out;
  }
  return value;
}
