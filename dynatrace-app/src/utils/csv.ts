// CSV encoding for Grail Resource Store lookup files.
//
// Every value is double-quoted with embedded quotes doubled (RFC 4180). The
// matching DPL pattern uses CSVDQS, which was verified against the Resource
// Store test endpoint with multi-line Markdown, quotes, commas, CR/LF, tabs,
// backslashes and Unicode. CSVDQS defaults to 4096 characters (including the
// quotes), so large columns get an explicit quantifier.

export const CSVDQS_MAX = 1_000_000;
export const CSVDQS_DEFAULT_MAX = 4096;

export function csvEscape(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function buildCsv<T extends string>(columns: readonly T[], row: Record<T, string>): string {
  const header = columns.map(csvEscape).join(",");
  const line = columns.map((c) => csvEscape(row[c] ?? "")).join(",");
  return `${header}\n${line}\n`;
}

// Columns listed in `large` may hold up to CSVDQS_MAX characters.
export function buildParsePattern<T extends string>(columns: readonly T[], large: readonly T[] = []): string {
  return `${columns.map((c) => (large.includes(c) ? `CSVDQS{1,${CSVDQS_MAX}}:${c}` : `CSVDQS:${c}`)).join(" ',' ")} EOL`;
}

// Escaped length as seen by CSVDQS (quotes included).
export function escapedLength(value: string): number {
  return csvEscape(value).length;
}
