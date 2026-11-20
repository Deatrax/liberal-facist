import { readJson, respond, withRoom } from "@/lib/server/http";
import { joinRoom } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** Take a seat. Body: { name }. Returns { playerId, token }. */
export const POST = withRoom(async (req, code) => {
  const body = (await readJson(req)) as { name?: unknown } | null;
  return respond(await joinRoom(code, body?.name));
});
