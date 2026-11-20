// Room = lobby + (optionally) a running game. Pure reducers, like the engine.
// The room is the unit that gets stored in Redis (one JSON document per room).

import { applyAction, createGame } from "./engine";
import { cryptoRng, type Rng } from "./rng";
import { MAX_PLAYERS, MIN_PLAYERS } from "./setup";
import type { Action, GameState, Result, Vote } from "./types";

export interface RoomPlayer {
  id: string;
  name: string;
  /** Secret. Never leaves the server except to its owner, once, at join time. */
  token: string;
}

export interface Room {
  code: string;
  /** Bumped by every write; clients poll it to learn that something changed. */
  version: number;
  createdAt: number;
  hostId: string;
  /** Seat order == clockwise order. */
  players: RoomPlayer[];
  game: GameState | null;
  gamesPlayed: number;
}

export type RoomAction =
  | { type: "reorder"; order: string[] }
  | { type: "kick"; playerId: string }
  | { type: "leave" }
  | { type: "start" }
  | { type: "endGame" }
  | { type: "playAgain" };

export type AnyAction = Action | RoomAction;

export const NAME_MAX = 16;

export function normalizeName(raw: unknown): Result<string> {
  if (typeof raw !== "string") return { ok: false, error: "Enter a name." };
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Enter a name." };
  if ([...name].length > NAME_MAX) return { ok: false, error: `Names are at most ${NAME_MAX} characters.` };
  return { ok: true, value: name };
}

export function createRoom(code: string, host: RoomPlayer, now: number): Room {
  return { code, version: 1, createdAt: now, hostId: host.id, players: [host], game: null, gamesPlayed: 0 };
}

export function addPlayer(room: Room, player: RoomPlayer): Result<Room> {
  if (room.game) return { ok: false, error: "That game has already started." };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: `The room is full (${MAX_PLAYERS} players).` };
  if (room.players.some((p) => p.name.toLowerCase() === player.name.toLowerCase())) {
    return { ok: false, error: "That name is taken in this room." };
  }
  const next = structuredClone(room);
  next.players.push(player);
  return { ok: true, value: next };
}

const hostOnly = (room: Room, actorId: string): string | null =>
  actorId === room.hostId ? null : "Only the host can do that.";

export function applyRoomAction(
  room: Room,
  actorId: string,
  action: AnyAction,
  rng: Rng = cryptoRng,
): Result<Room> {
  if (!room.players.some((p) => p.id === actorId)) return { ok: false, error: "You are not in this room." };
  const next = structuredClone(room);

  switch (action.type) {
    case "reorder": {
      const denied = hostOnly(room, actorId);
      if (denied) return { ok: false, error: denied };
      if (room.game) return { ok: false, error: "Seats can only change before the game starts." };
      const byId = new Map(room.players.map((p) => [p.id, p]));
      const order = action.order;
      if (order.length !== room.players.length || new Set(order).size !== order.length || !order.every((id) => byId.has(id))) {
        return { ok: false, error: "Invalid seat order." };
      }
      next.players = order.map((id) => byId.get(id)!);
      return { ok: true, value: next };
    }

    case "kick": {
      const denied = hostOnly(room, actorId);
      if (denied) return { ok: false, error: denied };
      if (room.game) return { ok: false, error: "Players can only be removed before the game starts." };
      if (action.playerId === actorId) return { ok: false, error: "You cannot remove yourself." };
      if (!room.players.some((p) => p.id === action.playerId)) return { ok: false, error: "Unknown player." };
      next.players = next.players.filter((p) => p.id !== action.playerId);
      return { ok: true, value: next };
    }

    case "leave": {
      if (room.game) return { ok: false, error: "You cannot leave a game in progress." };
      next.players = next.players.filter((p) => p.id !== actorId);
      if (actorId === next.hostId && next.players[0]) next.hostId = next.players[0].id; // pass the host role on
      return { ok: true, value: next };
    }

    case "start":
    case "playAgain": {
      const denied = hostOnly(room, actorId);
      if (denied) return { ok: false, error: denied };
      if (action.type === "start" && room.game) return { ok: false, error: "The game has already started." };
      if (action.type === "playAgain" && !room.game) return { ok: false, error: "There is no game to restart." };
      if (room.players.length < MIN_PLAYERS) return { ok: false, error: `You need at least ${MIN_PLAYERS} players.` };
      next.game = createGame(room.players.map((p) => ({ id: p.id, name: p.name })), rng);
      next.gamesPlayed += 1;
      return { ok: true, value: next };
    }

    case "endGame": {
      const denied = hostOnly(room, actorId);
      if (denied) return { ok: false, error: denied };
      if (!room.game) return { ok: false, error: "There is no game to end." };
      next.game = null;
      return { ok: true, value: next };
    }

    default: {
      if (!room.game) return { ok: false, error: "The game has not started." };
      const result = applyAction(room.game, action, actorId, rng);
      if (!result.ok) return result;
      next.game = result.value;
      return { ok: true, value: next };
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing untrusted request bodies

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** Strictly validates a JSON body into an action (types only; the rules are checked by the reducers). */
export function parseAction(body: unknown): AnyAction | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  switch (b.type) {
    case "ready":
    case "requestVeto":
    case "ackPower":
    case "leave":
    case "start":
    case "endGame":
    case "playAgain":
      return { type: b.type };
    case "nominate":
      return str(b.chancellorId) ? { type: "nominate", chancellorId: b.chancellorId } : null;
    case "vote":
      return b.vote === "ja" || b.vote === "nein" ? { type: "vote", vote: b.vote as Vote } : null;
    case "presidentDiscard":
    case "chancellorDiscard":
      return typeof b.index === "number" && Number.isInteger(b.index) ? { type: b.type, index: b.index } : null;
    case "vetoResponse":
      return typeof b.agree === "boolean" ? { type: "vetoResponse", agree: b.agree } : null;
    case "investigate":
    case "specialElection":
    case "execute":
      return str(b.targetId) ? { type: b.type, targetId: b.targetId } : null;
    case "kick":
      return str(b.playerId) ? { type: "kick", playerId: b.playerId } : null;
    case "reorder":
      return Array.isArray(b.order) && b.order.length <= MAX_PLAYERS && b.order.every(str)
        ? { type: "reorder", order: b.order as string[] }
        : null;
    default:
      return null;
  }
}
