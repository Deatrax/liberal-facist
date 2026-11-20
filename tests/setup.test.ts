import { describe, expect, it } from "vitest";
import {
  FASCIST_POLICIES,
  LIBERAL_POLICIES,
  createGame,
  cryptoRng,
  hitlerKnowsFascists,
  powerTrack,
  randomRoomCode,
  roleCounts,
  roleList,
  seededRng,
  shuffle,
  ROOM_CODE_RE,
} from "@/lib/game";
import { newGame, seatIds, started } from "./helpers";

describe("setup by player count (rulebook table)", () => {
  const table: [number, number, number][] = [
    [5, 3, 1],
    [6, 4, 1],
    [7, 4, 2],
    [8, 5, 2],
    [9, 5, 3],
    [10, 6, 3],
  ];

  it.each(table)("%i players: %i Liberals, %i Fascists + Hitler", (n, liberals, fascists) => {
    expect(roleCounts(n)).toEqual({ liberals, fascists });
    const roles = roleList(n);
    expect(roles).toHaveLength(n);
    expect(roles.filter((r) => r === "liberal")).toHaveLength(liberals);
    expect(roles.filter((r) => r === "fascist")).toHaveLength(fascists);
    expect(roles.filter((r) => r === "hitler")).toHaveLength(1);
  });

  it.each(table)("%i players: dealt roles in a real game match the table", (n, liberals, fascists) => {
    const g = newGame(n, 7);
    const count = (role: string) => g.players.filter((p) => p.role === role).length;
    expect(count("liberal")).toBe(liberals);
    expect(count("fascist")).toBe(fascists);
    expect(count("hitler")).toBe(1);
  });

  it("rejects unsupported player counts", () => {
    for (const n of [0, 1, 4, 11]) {
      expect(() => createGame(seatIds(n).map((id) => ({ id, name: id })))).toThrow();
    }
  });

  it("deck is 6 Liberal + 11 Fascist policies, shuffled", () => {
    const g = newGame(5, 3);
    expect(g.deck).toHaveLength(17);
    expect(g.deck.filter((p) => p === "liberal")).toHaveLength(LIBERAL_POLICIES);
    expect(g.deck.filter((p) => p === "fascist")).toHaveLength(FASCIST_POLICIES);
    // Different seeds give different orders.
    expect(newGame(5, 4).deck).not.toEqual(g.deck);
  });

  it("the first Presidential Candidate is random", () => {
    const starts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) starts.add(newGame(7, seed).presidentIndex);
    expect(starts.size).toBeGreaterThan(3);
  });

  it("starts in role reveal and begins round one once everyone is ready", () => {
    let g = newGame(6, 2);
    expect(g.phase).toBe("roleReveal");
    expect(started(6, 2).phase).toBe("nominate");
    expect(started(6, 2).round).toBe(1);
    g = newGame(6, 2);
    expect(g.round).toBe(0);
  });
});

describe("Fascist track powers (as printed on the colorized board)", () => {
  it("5–6 players: -, -, Policy Peek, Execution, Execution", () => {
    for (const n of [5, 6]) expect(powerTrack(n)).toEqual([null, null, "peek", "execute", "execute", null]);
  });
  it("7–8 players: -, Investigate, Special Election, Execution, Execution", () => {
    for (const n of [7, 8]) expect(powerTrack(n)).toEqual([null, "investigate", "special", "execute", "execute", null]);
  });
  it("9–10 players: Investigate, Investigate, Special Election, Execution, Execution", () => {
    for (const n of [9, 10]) {
      expect(powerTrack(n)).toEqual(["investigate", "investigate", "special", "execute", "execute", null]);
    }
  });
  it("Hitler knows the Fascist only in 5–6 player games", () => {
    expect([5, 6, 7, 8, 9, 10].map(hitlerKnowsFascists)).toEqual([true, true, false, false, false, false]);
  });
});

describe("randomness helpers", () => {
  it("cryptoRng stays in range and covers it", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = cryptoRng(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it("shuffle keeps the multiset and does not touch its input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, seededRng(5));
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("room codes are 4 letters without I or O", () => {
    for (let i = 0; i < 300; i++) {
      const code = randomRoomCode();
      expect(code).toMatch(ROOM_CODE_RE);
      expect(code).not.toMatch(/[IO01]/);
    }
  });
});
