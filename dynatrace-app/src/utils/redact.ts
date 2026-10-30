// Secret redaction applied to every conversation before it is saved.
// TypeScript port of agent-runtime/src/optional-gateway/redact.mjs; keep both in sync.

export const REDACTED = "[REDACTED]";

export const SENSITIVE_NAME = /(TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|APIKEY|CREDENTIAL|AUTH|PRIVATE_KEY|SESSION_KEY|COOKIE)/i;

type Replacer = (match: string, ...groups: string[]) => string;

const RULES: { pattern: RegExp; replace: Replacer }[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => REDACTED,
  },
  { pattern: /\bdt0[a-z][0-9]{2}\.[A-Za-z0-9]{8,32}\.[A-Za-z0-9]{32,128}\b/g, replace: () => REDACTED },
  {
    pattern: /\b(Authorization\s*[:=]\s*["']?)(Bearer|Basic|Api-Token|Token)\s+[^\s"'`,;]+/gi,
    replace: (_m, prefix, scheme) => `${prefix}${scheme} ${REDACTED}`,
  },
  { pattern: /\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, replace: (_m, prefix) => `${prefix}${REDACTED}` },
  {
    pattern: /\b(Bearer|Api-Token)\s+[A-Za-z0-9\-._~+/]{16,}=*/g,
    replace: (_m, scheme) => `${scheme} ${REDACTED}`,
  },
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@"']+:[^/\s@"']+@/gi,
    replace: (_m, scheme) => `${scheme}${REDACTED}@`,
  },
  { pattern: /\bsk-ant-[A-Za-z0-9\-_]{16,}/g, replace: () => REDACTED },
  { pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9\-_]{20,}/g, replace: () => REDACTED },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: () => REDACTED },
  { pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, replace: () => REDACTED },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: () => REDACTED },
  {
    pattern:
      /((?:["']?)[A-Za-z0-9_.-]*(?:token|password|passwd|secret|api[_-]?key|credential|private[_-]?key|session[_-]?key)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["']?)([^\s"',;}]{4,})(["']?)/gi,
    replace: (match, prefix, open, value, close) => (value.startsWith(REDACTED) ? match : `${prefix}${open}${REDACTED}${close}`),
  },
];

export interface RedactionResult {
  text: string;
  count: number;
}

export function redactWithCount(input: string): RedactionResult {
  if (!input) return { text: input, count: 0 };
  let text = input;
  let count = 0;
  for (const { pattern, replace } of RULES) {
    text = text.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(1).filter((g): g is string => typeof g === "string");
      const replaced = replace(match, ...groups);
      if (replaced !== match) count += 1;
      return replaced;
    });
  }
  return { text, count };
}

export function redactText(input: string): string {
  return redactWithCount(input).text;
}
