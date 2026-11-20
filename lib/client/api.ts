// Thin fetch wrappers for the room API. Every call is tiny; the poll is just { v, idle }.

import type { AnyAction, RoomView } from "@/lib/game";

export interface Creds {
  playerId: string;
  token: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { creds?: Creds } = {}): Promise<T> {
  const { creds, ...rest } = init;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds) {
    headers["x-player-id"] = creds.playerId;
    headers["x-player-token"] = creds.token;
  }
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  createRoom: (name: string) =>
    request<{ code: string } & Creds>("/api/room", { method: "POST", body: JSON.stringify({ name }) }),

  join: (code: string, name: string) =>
    request<Creds>(`/api/room/${code}/join`, { method: "POST", body: JSON.stringify({ name }) }),

  state: (code: string, creds: Creds) => request<RoomView>(`/api/room/${code}/state`, { creds }),

  version: (code: string, playerId: string) =>
    request<{ v: number; idle: string[] }>(`/api/room/${code}/version?p=${encodeURIComponent(playerId)}`),

  action: (code: string, creds: Creds, action: AnyAction) =>
    request<{ view: RoomView } | { left: true }>(`/api/room/${code}/action`, {
      method: "POST",
      body: JSON.stringify(action),
      creds,
    }),
};
