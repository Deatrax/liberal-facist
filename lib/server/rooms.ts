// Service layer between the HTTP routes and the pure game code: authentication, the
// load -> reduce -> compare-and-set -> retry loop, and view building.

import { timingSafeEqual } from "node:crypto";
import {
  ROOM_CODE_RE,
  addPlayer,
  applyRoomAction,
  createRoom,
  getPlayerView,
  normalizeName,
  parseAction,
  randomId,
  randomRoomCode,
  randomToken,
  type AnyAction,
  type Room,
  type RoomPlayer,
  type RoomView,
} from "@/lib/game";
import { getStore, type PollResult, type PresenceChange } from "./store";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export const normalizeCode = (raw: string): string | null => {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
};

function tokenMatches(player: RoomPlayer, token: string): boolean {
  const a = Buffer.from(player.token);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Finds the caller's seat, or null if the id/token pair is wrong (or the player was removed). */
function authenticate(room: Room, playerId: string, token: string): RoomPlayer | null {
  const player = room.players.find((p) => p.id === playerId);
  return player && token && tokenMatches(player, token) ? player : null;
}

const MAX_ATTEMPTS = 8;

/**
 * Atomic read-modify-write. `fn` is a pure function of the loaded room; if another request
 * wrote in the meantime the compare-and-set fails and we reload and run `fn` again.
 */
async function mutate(
  code: string,
  fn: (room: Room) => ServiceResult<{ room: Room; presence?: PresenceChange; playerId: string }>,
): Promise<ServiceResult<{ room: Room; playerId: string }>> {
  const store = getStore();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const room = await store.load(code);
    if (!room) return fail(404, "Room not found. It may have expired.");
    const out = fn(room);
    if (!out.ok) return out;
    const next = { ...out.value.room, version: room.version + 1 };
    const saved = await store.save(code, room.version, next, out.value.presence);
    if (saved === "ok") return { ok: true, value: { room: next, playerId: out.value.playerId } };
    if (saved === "missing") return fail(404, "Room not found. It may have expired.");
    // Conflict: somebody else acted at the same moment. Back off a touch and retry on fresh state.
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
  }
  return fail(503, "The room is busy. Try again.");
}

// ---------------------------------------------------------------------------

export interface Credentials {
  playerId: string;
  token: string;
}

export async function createNewRoom(rawName: unknown): Promise<ServiceResult<Credentials & { code: string }>> {
  const name = normalizeName(rawName);
  if (!name.ok) return fail(400, name.error);
  const store = getStore();
  const host: RoomPlayer = { id: randomId(10), name: name.value, token: randomToken() };
  for (let i = 0; i < 12; i++) {
    const room = createRoom(randomRoomCode(), host, Date.now());
    if (await store.create(room)) {
      return { ok: true, value: { code: room.code, playerId: host.id, token: host.token } };
    }
  }
  return fail(503, "Could not find a free room code. Try again.");
}

export async function joinRoom(code: string, rawName: unknown): Promise<ServiceResult<Credentials>> {
  const name = normalizeName(rawName);
  if (!name.ok) return fail(400, name.error);
  const player: RoomPlayer = { id: randomId(10), name: name.value, token: randomToken() };
  const result = await mutate(code, (room) => {
    const added = addPlayer(room, player);
    return added.ok
      ? { ok: true, value: { room: added.value, presence: { add: [player.id] }, playerId: player.id } }
      : fail(409, added.error);
  });
  return result.ok ? { ok: true, value: { playerId: player.id, token: player.token } } : result;
}

export async function getState(code: string, playerId: string, token: string): Promise<ServiceResult<RoomView>> {
  const room = await getStore().load(code);
  if (!room) return fail(404, "Room not found. It may have expired.");
  if (!authenticate(room, playerId, token)) return fail(401, "You are not seated in this room.");
  return { ok: true, value: getPlayerView(room, playerId) };
}

/** Returns the caller's fresh view, or null if the action made them leave the room. */
export async function performAction(
  code: string,
  playerId: string,
  token: string,
  body: unknown,
): Promise<ServiceResult<RoomView | null>> {
  const action: AnyAction | null = parseAction(body);
  if (!action) return fail(400, "Unknown action.");

  const result = await mutate(code, (room) => {
    if (!authenticate(room, playerId, token)) return fail(401, "You are not seated in this room.");
    const applied = applyRoomAction(room, playerId, action);
    if (!applied.ok) return fail(422, applied.error);
    const presence: PresenceChange = {};
    if (action.type === "kick") presence.remove = [action.playerId];
    if (action.type === "leave") presence.remove = [playerId];
    return { ok: true, value: { room: applied.value, presence, playerId } };
  });
  if (!result.ok) return result;
  const { room } = result.value;
  return { ok: true, value: room.players.some((p) => p.id === playerId) ? getPlayerView(room, playerId) : null };
}

export async function pollVersion(code: string, playerId: string | null): Promise<ServiceResult<PollResult>> {
  const polled = await getStore().poll(code, playerId);
  return polled ? { ok: true, value: polled } : fail(404, "Room not found. It may have expired.");
}
