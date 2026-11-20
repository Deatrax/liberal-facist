import { credentials, respond, withRoom } from "@/lib/server/http";
import { getState } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** The caller's personalised view of the room (headers: x-player-id, x-player-token). */
export const GET = withRoom(async (req, code) => {
  const { playerId, token } = credentials(req);
  return respond(await getState(code, playerId, token));
});
