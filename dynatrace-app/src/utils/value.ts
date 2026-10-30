// Converts a loosely typed record value (Grail records, settings values) to text
// without falling back to "[object Object]".
export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return fallback;
}
