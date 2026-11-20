import { errorResponse, readJson, respond } from "@/lib/server/http";
import { createNewRoom } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** Create a room. Body: { name }. Returns { code, playerId, token }. */
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as { name?: unknown } | null;
    return respond(await createNewRoom(body?.name));
  } catch (e) {
    return errorResponse(e);
  }
}
