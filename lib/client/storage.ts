// localStorage helpers. Everything is wrapped in try/catch: private windows and blocked storage
// must never break the app (you just won't be reconnected after a refresh).

import type { Creds } from "./api";

/**
 * Dev only: `/{code}?as=ann` keeps a separate seat per `as` value, so one browser can hold several
 * players in different tabs. In production builds this always returns null.
 */
export function devSeat(): string | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const as = new URLSearchParams(window.location.search).get("as");
  return as && /^[\w-]{1,20}$/.test(as) ? as : null;
}

const key = (code: string) => `sh:seat:${code}${devSeat() ? `:${devSeat()}` : ""}`;

export function loadCreds(code: string): Creds | null {
  try {
    const raw = window.localStorage.getItem(key(code));
    const parsed = raw ? (JSON.parse(raw) as Creds) : null;
    return parsed?.playerId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCreds(code: string, creds: Creds): void {
  try {
    window.localStorage.setItem(key(code), JSON.stringify(creds));
  } catch {
    /* storage unavailable: reconnect-after-refresh won't work, the game still does */
  }
}

export function clearCreds(code: string): void {
  try {
    window.localStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}

export function loadName(): string {
  try {
    return devSeat() ?? window.localStorage.getItem("sh:name") ?? "";
  } catch {
    return devSeat() ?? "";
  }
}

export function saveName(name: string): void {
  try {
    window.localStorage.setItem("sh:name", name);
  } catch {
    /* ignore */
  }
}

/** Keeps `?as=` on in-app navigation during dev so a tab stays "itself". */
export function withDevSeat(path: string): string {
  const as = devSeat();
  return as ? `${path}?as=${as}` : path;
}
