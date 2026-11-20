import { describe, expect, it } from "vitest";
import {
  addPlayer,
  applyRoomAction,
  createRoom,
  normalizeName,
  parseAction,
  seededRng,
  type Room,
} from "@/lib/game";

const player = (n: number) => ({ id: `id${n}`, name: `Player ${n}`, token: `tok${n}` });

function lobby(n: number): Room {
  let room = createRoom("ABCD", player(0), 1);
  for (let i = 1; i < n; i++) {
    const r = addPlayer(room, player(i));
    if (!r.ok) throw new Error(r.error);
    room = r.value;
  }
  return room;
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("joining", () => {
  it("names must be unique (case-insensitive) and sensible", () => {
    const room = lobby(2);
    const dup = addPlayer(room, { id: "z", name: "player 1", token: "t" });
    expect(dup).toEqual({ ok: false, error: "That name is taken in this room." });
    expect(normalizeName("   ")).toMatchObject({ ok: false });
    expect(normalizeName(42)).toMatchObject({ ok: false });
    expect(normalizeName("  Ann   Marie ")).toEqual({ ok: true, value: "Ann Marie" });
    expect(normalizeName("<b>Bob</b>")).toEqual({ ok: true, value: "bBob/b" }); // angle brackets stripped
    expect(normalizeName("x".repeat(17))).toMatchObject({ ok: false });
  });

  it("at most 10 players", () => {
    const room = lobby(10);
    expect(addPlayer(room, player(11))).toEqual({ ok: false, error: "The room is full (10 players)." });
  });

  it("no joining once the game has started", () => {
    const room = ok(applyRoomAction(lobby(5), "id0", { type: "start" }, seededRng(1)));
    expect(addPlayer(room, player(9))).toEqual({ ok: false, error: "That game has already started." });
  });
});

describe("lobby controls (host only)", () => {
  it("Start needs 5–10 players and the host", () => {
    expect(applyRoomAction(lobby(4), "id0", { type: "start" })).toMatchObject({ ok: false });
    expect(applyRoomAction(lobby(5), "id1", { type: "start" })).toEqual({ ok: false, error: "Only the host can do that." });
    const started = ok(applyRoomAction(lobby(8), "id0", { type: "start" }, seededRng(2)));
    expect(started.game?.players).toHaveLength(8);
    expect(started.gamesPlayed).toBe(1);
  });

  it("reorders seats (the clockwise order) and the game uses that order", () => {
    const room = lobby(5);
    const order = ["id4", "id3", "id2", "id1", "id0"];
    expect(applyRoomAction(room, "id1", { type: "reorder", order })).toMatchObject({ ok: false });
    const next = ok(applyRoomAction(room, "id0", { type: "reorder", order }));
    expect(next.players.map((p) => p.id)).toEqual(order);
    const started = ok(applyRoomAction(next, "id0", { type: "start" }, seededRng(3)));
    expect(started.game!.players.map((p) => p.id)).toEqual(order);
    // Invalid orders are refused.
    expect(applyRoomAction(room, "id0", { type: "reorder", order: ["id0", "id0", "id1", "id2", "id3"] })).toMatchObject({ ok: false });
    expect(applyRoomAction(room, "id0", { type: "reorder", order: ["id0", "id1"] })).toMatchObject({ ok: false });
    expect(applyRoomAction(room, "id0", { type: "reorder", order: ["id0", "id1", "id2", "id3", "nope"] })).toMatchObject({ ok: false });
  });

  it("kick removes a player before the start only, never the host", () => {
    const room = lobby(6);
    expect(applyRoomAction(room, "id2", { type: "kick", playerId: "id3" })).toMatchObject({ ok: false });
    expect(applyRoomAction(room, "id0", { type: "kick", playerId: "id0" })).toMatchObject({ ok: false });
    const next = ok(applyRoomAction(room, "id0", { type: "kick", playerId: "id3" }));
    expect(next.players.map((p) => p.id)).not.toContain("id3");
    const started = ok(applyRoomAction(next, "id0", { type: "start" }, seededRng(1)));
    expect(applyRoomAction(started, "id0", { type: "kick", playerId: "id1" })).toMatchObject({ ok: false });
  });

  it("leaving hands the host role on", () => {
    const next = ok(applyRoomAction(lobby(5), "id0", { type: "leave" }));
    expect(next.players).toHaveLength(4);
    expect(next.hostId).toBe("id1");
  });
});

describe("host controls during the game", () => {
  it("play again: same room, same players, fresh roles and deck", () => {
    const first = ok(applyRoomAction(lobby(7), "id0", { type: "start" }, seededRng(10)));
    expect(applyRoomAction(first, "id3", { type: "playAgain" })).toMatchObject({ ok: false });
    const second = ok(applyRoomAction(first, "id0", { type: "playAgain" }, seededRng(11)));
    expect(second.code).toBe(first.code);
    expect(second.players.map((p) => p.id)).toEqual(first.players.map((p) => p.id));
    expect(second.game!.round).toBe(0);
    expect(second.game!.phase).toBe("roleReveal");
    expect(second.gamesPlayed).toBe(2);
    // Different seed -> different roles.
    expect(second.game!.players.map((p) => p.role)).not.toEqual(first.game!.players.map((p) => p.role));
  });

  it("end game returns everyone to the lobby", () => {
    const started = ok(applyRoomAction(lobby(6), "id0", { type: "start" }, seededRng(1)));
    expect(applyRoomAction(started, "id2", { type: "endGame" })).toMatchObject({ ok: false });
    const ended = ok(applyRoomAction(started, "id0", { type: "endGame" }));
    expect(ended.game).toBeNull();
    expect(ended.players).toHaveLength(6);
    // And the lobby accepts newcomers again.
    expect(addPlayer(ended, player(9)).ok).toBe(true);
  });

  it("forwards game actions and rejects strangers", () => {
    const started = ok(applyRoomAction(lobby(5), "id0", { type: "start" }, seededRng(1)));
    expect(applyRoomAction(started, "ghost", { type: "ready" })).toEqual({ ok: false, error: "You are not in this room." });
    const r = applyRoomAction(started, "id0", { type: "ready" });
    expect(ok(r).game!.ready).toEqual(["id0"]);
    expect(applyRoomAction(lobby(5), "id0", { type: "ready" })).toEqual({ ok: false, error: "The game has not started." });
  });
});

describe("parseAction (untrusted JSON)", () => {
  it("accepts well-formed actions", () => {
    expect(parseAction({ type: "vote", vote: "ja" })).toEqual({ type: "vote", vote: "ja" });
    expect(parseAction({ type: "nominate", chancellorId: "abc" })).toEqual({ type: "nominate", chancellorId: "abc" });
    expect(parseAction({ type: "chancellorDiscard", index: 1 })).toEqual({ type: "chancellorDiscard", index: 1 });
    expect(parseAction({ type: "vetoResponse", agree: false })).toEqual({ type: "vetoResponse", agree: false });
    expect(parseAction({ type: "ready", extra: "ignored" })).toEqual({ type: "ready" });
  });

  it("rejects everything else", () => {
    for (const bad of [
      null,
      "vote",
      42,
      {},
      { type: "hack" },
      { type: "vote", vote: "maybe" },
      { type: "vote" },
      { type: "nominate", chancellorId: 5 },
      { type: "nominate", chancellorId: "" },
      { type: "presidentDiscard", index: "1" },
      { type: "presidentDiscard", index: 1.5 },
      { type: "vetoResponse", agree: "false" },
      { type: "execute", targetId: null },
      { type: "reorder", order: "abc" },
      { type: "reorder", order: [1, 2] },
    ]) {
      expect(parseAction(bad)).toBeNull();
    }
  });
});
