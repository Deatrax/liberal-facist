import { json, respond, withRoom } from "@/lib/server/http";
import { pollVersion } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

const ID_RE = /^[a-z0-9]{6,16}$/;

/**
 * The cheap poll: { v, idle }. `?p=<playerId>` records that this player is here.
 * Clients fetch the full state only when `v` changes.
 */
export const GET = withRoom(async (req, code) => {
  const p = new URL(req.url).searchParams.get("p");
  const result = await pollVersion(code, p && ID_RE.test(p) ? p : null);
  return result.ok ? json({ v: result.value.version, idle: result.value.idle }) : respond(result);
});
