import { json, readJson, respond } from "@/lib/server/http";
import { createNewRoom } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** Create a room. Body: { name }. Returns { code, playerId, token }. */
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as { name?: unknown } | null;
    return respond(await createNewRoom(body?.name));
  } catch (e) {
    console.error("[secret-hitler]", e);
    return json({ error: "Server error. Try again in a moment." }, 500);
  }
}
