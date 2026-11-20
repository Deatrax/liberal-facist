// Tiny helpers shared by the route handlers.

import { NextResponse } from "next/server";
import { normalizeCode, type ServiceResult } from "./rooms";
import { ConfigError } from "./store";

const NO_STORE = { "Cache-Control": "no-store" };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

export const respond = <T>(r: ServiceResult<T>, shape: (v: T) => unknown = (v) => v) =>
  r.ok ? json(shape(r.value)) : json({ error: r.error }, r.status);

/** Reads a small JSON body. Returns null for anything malformed or oversized. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length > 4096) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const credentials = (req: Request) => ({
  playerId: req.headers.get("x-player-id") ?? "",
  token: req.headers.get("x-player-token") ?? "",
});

/** Unexpected errors become a plain 500; a missing Redis configuration says so. */
export function errorResponse(e: unknown): Response {
  console.error("[secret-hitler]", e);
  if (e instanceof ConfigError) return json({ error: e.message }, 500);
  return json({ error: "Server error. Try again in a moment." }, 500);
}

type Ctx = { params: Promise<{ code: string }> };

/** Wraps a handler: validates the room code and turns unexpected errors into a plain 500. */
export function withRoom(handler: (req: Request, code: string) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const code = normalizeCode((await ctx.params).code);
    if (!code) return json({ error: "That is not a room code." }, 404);
    try {
      return await handler(req, code);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
