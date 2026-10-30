// HTTP basic authentication with constant-time comparison and a small
// per-client failure limiter.

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function safeEqual(a, b) {
  // Hashing first gives equal-length buffers, so timingSafeEqual never throws
  // and the comparison time does not reveal the expected length.
  return timingSafeEqual(digest(a), digest(b));
}

export function parseBasicAuth(header) {
  if (typeof header !== "string") return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function isAuthorized(header, expected) {
  const credentials = parseBasicAuth(header);
  if (!credentials) return false;
  // Evaluate both comparisons so a wrong username costs the same as a wrong password.
  const userOk = safeEqual(credentials.username, expected.username);
  const passOk = safeEqual(credentials.password, expected.password);
  return userOk && passOk;
}

export function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export class FailureLimiter {
  constructor({ maxFailures = 10, windowMs = 60_000, blockMs = 60_000, now = () => Date.now() } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
    this.now = now;
    this.entries = new Map();
  }

  isBlocked(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.blockedUntil && entry.blockedUntil > this.now()) return true;
    if (entry.blockedUntil && entry.blockedUntil <= this.now()) this.entries.delete(key);
    return false;
  }

  recordFailure(key) {
    const now = this.now();
    const entry = this.entries.get(key) ?? { failures: [], blockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < this.windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= this.maxFailures) {
      entry.blockedUntil = now + this.blockMs;
      entry.failures = [];
    }
    this.entries.set(key, entry);
    if (this.entries.size > 10_000) {
      // Bound memory: drop the oldest key.
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  recordSuccess(key) {
    this.entries.delete(key);
  }
}
