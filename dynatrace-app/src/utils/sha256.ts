// SHA-256 with the Web Crypto API (browser, Dynatrace JavaScript runtime and Node.js 20+).
export async function sha256Hex(text: string): Promise<string> {
  const data = new Uint8Array(new TextEncoder().encode(text));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
