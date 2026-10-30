// Minimal semantic version comparison for "major.minor.patch[-pre]".
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function isAtLeast(version: string | null | undefined, minimum: string): boolean {
  if (!version || !/^\d+\.\d+/.test(version.replace(/^v/, ""))) return false;
  return compareVersions(version, minimum) >= 0;
}
