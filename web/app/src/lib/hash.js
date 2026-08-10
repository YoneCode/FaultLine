// sha256 of a UTF-8 string, hex, via the Web Crypto API (no dependency).
// Shared by the write path (wallet.js) and the read path (client.js) — the
// latter lazy-loads genlayer-js and must not pull in the wallet module.
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
