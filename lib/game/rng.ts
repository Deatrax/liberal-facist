// Randomness. All shuffling and role assignment happens on the server using the
// platform CSPRNG (Web Crypto, available in Node >= 19 and browsers). Tests pass a
// seeded generator instead so games are reproducible.

/** Returns an integer in [0, max). */
export type Rng = (max: number) => number;

export const cryptoRng: Rng = (max) => {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new Error("rng: bad max");
  // Rejection sampling: no modulo bias.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0]! >= limit);
  return buf[0]! % max;
};

/** Fisher–Yates. Returns a new array, leaves the input alone. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Deterministic generator for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return (max) => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    const f = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * max);
  };
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Random lowercase id (no look-alike characters). */
export function randomId(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[cryptoRng(ID_ALPHABET.length)];
  return out;
}

/** Secret token, 192 bits. */
export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Room codes: 4 letters, no I or O (and no digits at all) so they can't be misread.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function randomRoomCode(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[cryptoRng(CODE_ALPHABET.length)];
  return out;
}
export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
