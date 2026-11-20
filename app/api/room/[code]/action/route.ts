import { credentials, json, readJson, respond, withRoom } from "@/lib/server/http";
import { performAction } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * Send an intent, e.g. { type: "nominate", chancellorId } (headers: x-player-id, x-player-token).
 * The server validates it against the rules and the current phase, then returns the caller's new view.
 */
export const POST = withRoom(async (req, code) => {
  const body = await readJson(req);
  if (body === null) return json({ error: "Bad request." }, 400);
  const { playerId, token } = credentials(req);
  const result = await performAction(code, playerId, token, body);
  return respond(result, (view) => (view ? { view } : { left: true }));
});
