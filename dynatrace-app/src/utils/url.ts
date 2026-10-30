export interface UrlValidation {
  ok: boolean;
  errors: string[];
  normalized: string | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Validates a runtime URL. HTTPS is required; plain HTTP is accepted only for
// localhost when `allowLocalHttp` is set (local development with `dt-app dev`).
export function validateRuntimeUrl(input: string, { allowLocalHttp = false } = {}): UrlValidation {
  const errors: string[] = [];
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, errors: ["Enter the runtime URL."], normalized: null };
  if (/\s/.test(raw)) return { ok: false, errors: ["The URL must not contain spaces."], normalized: null };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, errors: ["Enter a valid URL, for example https://rocky-agent.example.com"], normalized: null };
  }

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol === "http:") {
    if (!(allowLocalHttp && isLocal)) {
      errors.push("Use HTTPS. Plain HTTP is only allowed for localhost during local development.");
    }
  } else if (url.protocol !== "https:") {
    errors.push("Only https:// URLs are supported.");
  }
  if (url.username || url.password) errors.push("Do not put a username or password in the URL; use the fields below.");
  if (url.search || url.hash) errors.push("Remove the query string or fragment from the URL.");
  if (!url.hostname) errors.push("The URL needs a host name.");
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) errors.push("The port is out of range.");

  const path = url.pathname.replace(/\/+$/, "");
  const normalized = `${url.protocol}//${url.host}${path}`;
  return { ok: errors.length === 0, errors, normalized: errors.length === 0 ? normalized : null };
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
