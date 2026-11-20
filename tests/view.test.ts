import { describe, expect, it } from "vitest";
import {
  createRoom,
  addPlayer,
  getGameView,
  getPlayerView,
  applyRoomAction,
  type GameState,
  type Room,
  seededRng,
} from "@/lib/game";
import { act, anyChancellor, enactViaGovernment, holdVote, pres, rigDeck, setRoles, started } from "./helpers";

const view = (s: GameState, id: string) => getGameView(s, id, "p0");
const json = (v: unknown) => JSON.stringify(v);

/** A started game with fixed roles: p0 Hitler, p1 Fascist, p2.. Liberal (7 players: p0 H, p1 F, p2 F). */
function game7(seed = 5): GameState {
  return setRoles(started(7, seed), ["hitler", "fascist", "fascist", "liberal", "liberal", "liberal", "liberal"]);
}

describe("what the rules let each player know about roles", () => {
  const expected: Record<number, { fascists: number }> = { 5: { fascists: 1 }, 6: { fascists: 1 }, 7: { fascists: 2 }, 8: { fascists: 2 }, 9: { fascists: 3 }, 10: { fascists: 3 } };

  it.each([5, 6, 7, 8, 9, 10])("%i players: allies are exactly what the setup reveals", (n) => {
    const g = started(n, 3);
    for (const viewer of g.players) {
      const v = view(g, viewer.id);
      const allies = v.me.allies;
      if (viewer.role === "liberal") {
        expect(allies).toEqual([]);
      } else if (viewer.role === "fascist") {
        // Fascists see the other Fascists and Hitler.
        expect(allies).toHaveLength(expected[n]!.fascists - 1 + 1);
        for (const a of allies) expect(g.players.find((p) => p.id === a.id)!.role).toBe(a.role);
        expect(allies.some((a) => a.role === "hitler")).toBe(true);
      } else {
        // Hitler: sees the Fascist only at 5–6 players.
        if (n <= 6) expect(allies).toEqual([{ id: g.players.find((p) => p.role === "fascist")!.id, role: "fascist" }]);
        else expect(allies).toEqual([]);
      }
      // Nobody's role is in the public player list before game over.
      expect(v.players.every((p) => p.role === null)).toBe(true);
      // The viewer's own cards.
      expect(v.me.role).toBe(viewer.role);
      expect(v.me.party).toBe(viewer.role === "liberal" ? "liberal" : "fascist");
    }
  });

  it("everything is revealed at game over", () => {
    let g = started(5, 80);
    for (let i = 0; i < 5; i++) g = enactViaGovernment(g, "liberal");
    expect(g.phase).toBe("gameOver");
    const v = view(g, "p0");
    expect(v.players.map((p) => p.role)).toEqual(g.players.map((p) => p.role));
    expect(v.winner).toEqual({ team: "liberal", reason: "liberalPolicies" });
    expect(v.prompt).toBeNull();
  });
});

/**
 * Differential test: take a state, change only information that player V must not be able to know,
 * and require V's view to be byte-for-byte identical. If anything hidden leaked into the payload, the
 * two views would differ.
 */
describe("hidden information does not leak (differential)", () => {
  const rotate = <T>(a: T[]) => [...a.slice(1), a[0]!];

  /** Swap the roles of players V knows nothing about (a Liberal sees nothing, so any two others will do). */
  function permuteUnknownRoles(s: GameState, viewerId: string): GameState {
    const c = structuredClone(s);
    const viewer = c.players.find((p) => p.id === viewerId)!;
    const hidden = c.players.filter((p) => p.id !== viewerId && !view(s, viewerId).me.allies.some((a) => a.id === p.id));
    const roles = rotate(hidden.map((p) => p.role));
    hidden.forEach((p, i) => (p.role = roles[i]!));
    expect(viewer.role).toBe(s.players.find((p) => p.id === viewerId)!.role);
    return c;
  }

  function scrambleDeck(s: GameState): GameState {
    const c = structuredClone(s);
    c.deck.reverse();
    c.discard.reverse();
    return c;
  }

  it("deck order and discard contents are never sent, only counts", () => {
    let g = game7();
    g = enactViaGovernment(g, "liberal");
    g.discard = ["fascist", "liberal", "fascist", "fascist"]; // non-empty pile with a mix
    const scrambled = scrambleDeck({ ...g, deck: [...g.deck] });
    scrambled.deck = [...g.deck].reverse();
    const flipped = structuredClone(g);
    const flip = (c: "fascist" | "liberal") => (c === "fascist" ? "liberal" : "fascist");
    flipped.deck = flipped.deck.map(flip); // same count, other cards
    flipped.discard = flipped.discard.map(flip);
    for (const p of g.players) {
      expect(json(view(scrambled, p.id))).toBe(json(view(g, p.id)));
      expect(json(view(flipped, p.id))).toBe(json(view(g, p.id)));
    }
    const v = view(g, "p3");
    expect(v.drawCount).toBe(g.deck.length);
    expect(v.discardCount).toBe(g.discard.length);
  });

  it("another player's role is invisible (Liberal and 7+ player Hitler viewers)", () => {
    const g = game7();
    for (const viewerId of ["p3", "p4", "p5", "p6", "p0"]) {
      const variant = permuteUnknownRoles(g, viewerId);
      expect(variant.players.map((p) => p.role)).not.toEqual(g.players.map((p) => p.role));
      expect(json(view(variant, viewerId))).toBe(json(view(g, viewerId)));
    }
  });

  it("ballots stay hidden until everyone alive has voted (only who has voted is public)", () => {
    let g = game7();
    g = act(g, { type: "nominate", chancellorId: anyChancellor(g) }, pres(g));
    g = act(g, { type: "vote", vote: "ja" }, "p3");
    g = act(g, { type: "vote", vote: "nein" }, "p4");
    const flipped = structuredClone(g);
    flipped.votes = { p3: "nein", p4: "ja" };
    for (const viewer of ["p0", "p1", "p2", "p5", "p6"]) {
      expect(json(view(flipped, viewer))).toBe(json(view(g, viewer)));
    }
    const v = view(g, "p5");
    expect(v.players.find((p) => p.id === "p3")!.voted).toBe(true);
    expect(v.players.find((p) => p.id === "p5")!.voted).toBe(false);
    expect(v.lastVote).toBeNull();
    // A voter sees their own ballot, nobody else's.
    expect(view(g, "p3").me.vote).toBe("ja");
    expect(view(g, "p4").me.vote).toBe("nein");
    expect(view(g, "p5").me.vote).toBeNull();
    expect(json(view(g, "p5"))).not.toMatch(/"ja"|"nein"/);
  });

  it("the full ballot is published once the vote resolves", () => {
    let g = game7();
    const chancellor = anyChancellor(g);
    g = holdVote(g, chancellor, ["p0", "p1", "p2", "p3"]);
    const v = view(g, "p6");
    expect(v.lastVote?.passed).toBe(true);
    expect(v.lastVote?.votes).toEqual({ p0: "ja", p1: "ja", p2: "ja", p3: "ja", p4: "nein", p5: "nein", p6: "nein" });
    expect(v.players.every((p) => !p.voted)).toBe(true);
  });

  it("the President's 3 policies go to the President only; the Chancellor's 2 to the Chancellor only", () => {
    let g = rigDeck(game7(), ["fascist", "liberal", "fascist"]);
    g = holdVote(g, anyChancellor(g), "all");
    const president = pres(g);
    const chancellor = g.chancellorId!;
    expect(view(g, president).prompt).toEqual({ kind: "discard", hand: ["fascist", "liberal", "fascist"] });
    const hidden = structuredClone(g);
    hidden.hand = ["liberal", "liberal", "liberal"];
    for (const p of g.players.filter((x) => x.id !== president)) {
      expect(view(g, p.id).prompt).toBeNull();
      expect(json(view(hidden, p.id))).toBe(json(view(g, p.id)));
    }

    g = act(g, { type: "presidentDiscard", index: 0 }, president);
    expect(view(g, chancellor).prompt).toEqual({ kind: "enact", hand: ["liberal", "fascist"], canVeto: false });
    const hidden2 = structuredClone(g);
    hidden2.hand = ["fascist", "fascist"];
    for (const p of g.players.filter((x) => x.id !== chancellor)) {
      expect(json(view(hidden2, p.id))).toBe(json(view(g, p.id)));
    }
    // The President no longer sees the cards once passed on.
    expect(view(g, president).prompt).toBeNull();
  });

  it("investigation results (Party Membership only) go to the investigating President only", () => {
    let g = setRoles(started(9, 31), ["hitler", "fascist", "fascist", "fascist", "liberal", "liberal", "liberal", "liberal", "liberal"]);
    g = enactViaGovernment(g, "fascist"); // 9 players: Investigate Loyalty
    const president = pres(g);
    const target = president === "p0" ? "p1" : "p0"; // a Fascist-party player either way
    g = act(g, { type: "investigate", targetId: target }, president);

    const v = view(g, president);
    expect(v.prompt).toEqual({ kind: "investigate", targets: [], result: { targetId: target, party: "fascist" } });
    expect(v.me.notes).toEqual([{ round: g.round, kind: "investigation", targetId: target, party: "fascist" }]);
    // The result is a Party, not a Secret Role: the target's role is not in the payload as a role.
    expect(v.players.find((p) => p.id === target)!.role).toBeNull();

    // Everyone else: same view whatever the result was.
    const other = structuredClone(g);
    other.power!.party = "liberal";
    other.notes[president]![0] = { ...other.notes[president]![0]!, party: "liberal" } as never;
    for (const p of g.players.filter((x) => x.id !== president)) {
      expect(json(view(other, p.id))).toBe(json(view(g, p.id)));
      expect(view(g, p.id).me.notes).toEqual([]);
    }
    // But everyone sees WHO was investigated.
    expect(view(g, "p8").players.find((p) => p.id === target)!.investigated).toBe(true);
    expect(view(g, "p8").log.some((l) => l.text.includes("investigated"))).toBe(true);
    expect(json(view(g, "p8").log)).not.toMatch(/Fascist Party|is a Fascist|is a Liberal/);
  });

  it("Policy Peek cards go to the President only", () => {
    let g = setRoles(started(5, 50), ["hitler", "fascist", "liberal", "liberal", "liberal"]);
    g = enactViaGovernment(g, "fascist");
    g = enactViaGovernment(g, "fascist");
    g = enactViaGovernment(g, "fascist"); // 5 players: Policy Peek
    expect(g.power?.kind).toBe("peek");
    const president = pres(g);
    const v = view(g, president);
    expect(v.prompt).toEqual({ kind: "peek", cards: g.deck.slice(0, 3) });
    const other = scrambleDeck(g);
    other.deck = g.deck.map((c) => (c === "fascist" ? "liberal" : "fascist"));
    for (const p of g.players.filter((x) => x.id !== president)) {
      expect(json(view(other, p.id))).toBe(json(view(g, p.id)));
    }
  });

  it("executed players' roles are not revealed", () => {
    let g = setRoles(started(7, 60), ["hitler", "fascist", "fascist", "liberal", "liberal", "liberal", "liberal"]);
    for (let i = 0; i < 3; i++) {
      g = enactViaGovernment(g, "fascist");
      if (g.phase === "executive") {
        const target = g.players.find((p) => p.alive && p.id !== pres(g) && p.role === "liberal" && !g.investigated.includes(p.id))!.id;
        g = act(g, g.power!.kind === "investigate" ? { type: "investigate", targetId: target } : g.power!.kind === "special" ? { type: "specialElection", targetId: target } : { type: "ackPower" }, pres(g));
        if (g.phase === "executive") g = act(g, { type: "ackPower" }, pres(g));
      }
    }
    g = enactViaGovernment(g, "fascist"); // execution
    const victim = g.players.find((p) => p.alive && p.id !== pres(g) && p.role === "liberal")!;
    g = act(g, { type: "execute", targetId: victim.id }, pres(g));
    for (const p of g.players) {
      const v = view(g, p.id);
      const seen = v.players.find((x) => x.id === victim.id)!;
      expect(seen.alive).toBe(false);
      expect(seen.role).toBeNull();
    }
  });
});

describe("prompts: exactly one clear thing to do, for exactly the right player", () => {
  it("nomination", () => {
    const g = started(7, 4);
    const prompts = g.players.map((p) => view(g, p.id).prompt);
    expect(prompts.filter((p) => p?.kind === "nominate")).toHaveLength(1);
    expect(prompts.filter((p) => p !== null)).toHaveLength(1);
    const v = view(g, pres(g));
    expect(v.prompt).toMatchObject({ kind: "nominate" });
    expect(v.waitingOn).toEqual([pres(g)]);
  });

  it("voting: every living player who hasn't voted, nobody else", () => {
    let g = started(6, 4);
    g = act(g, { type: "nominate", chancellorId: anyChancellor(g) }, pres(g));
    g = act(g, { type: "vote", vote: "ja" }, "p2");
    for (const p of g.players) {
      expect(view(g, p.id).prompt).toEqual(p.id === "p2" ? null : { kind: "vote" });
    }
    expect(view(g, "p0").waitingOn.sort()).toEqual(["p0", "p1", "p3", "p4", "p5"]);
  });

  it("role reveal waits for everyone and lists who", () => {
    let g = setRoles(started(5, 1), ["liberal", "liberal", "liberal", "fascist", "hitler"]);
    g = { ...g, phase: "roleReveal", ready: [], round: 0 };
    const v = view(g, "p0");
    expect(v.prompt).toEqual({ kind: "ready" });
    g = act(g, { type: "ready" }, "p0");
    expect(view(g, "p0").prompt).toBeNull();
    expect(view(g, "p1").waitingOn).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("room view", () => {
  function lobby(): Room {
    let room = createRoom("ABCD", { id: "h", name: "Host", token: "SECRET-HOST" }, 1);
    for (const [i, n] of ["Ann", "Bo", "Cy", "Di"].entries()) {
      const r = addPlayer(room, { id: `x${i}`, name: n, token: `SECRET-${i}` });
      if (!r.ok) throw new Error(r.error);
      room = r.value;
    }
    return room;
  }

  it("never contains any token, even those of the viewer or others", () => {
    const room = lobby();
    for (const p of room.players) {
      expect(json(getPlayerView(room, p.id))).not.toContain("SECRET");
    }
    const started = applyRoomAction(room, "h", { type: "start" }, seededRng(1));
    if (!started.ok) throw new Error(started.error);
    for (const p of started.value.players) {
      const text = json(getPlayerView(started.value, p.id));
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain('"token"');
      expect(text).not.toContain('"deck"');
      expect(text).not.toContain('"discard":[');
    }
  });

  it("rejects views for strangers", () => {
    expect(() => getPlayerView(lobby(), "nobody")).toThrow();
  });

  it("identifies the host", () => {
    const room = lobby();
    expect(getPlayerView(room, "h").me.isHost).toBe(true);
    expect(getPlayerView(room, "x1").me.isHost).toBe(false);
  });
});
