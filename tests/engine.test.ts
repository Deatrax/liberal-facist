import { describe, expect, it } from "vitest";
import { eligibleChancellors, powerTrack, presidentOf, seededRng, type GameState } from "@/lib/game";
import {
  act,
  anyChancellor,
  cardsInPlay,
  enactViaGovernment,
  holdVote,
  newGame,
  pres,
  rejected,
  resolvePower,
  rigDeck,
  setRoles,
  started,
} from "./helpers";

const nextSeat = (s: GameState, id: string) => {
  const i = s.players.findIndex((p) => p.id === id);
  for (let k = 1; k <= s.players.length; k++) {
    const p = s.players[(i + k) % s.players.length]!;
    if (p.alive) return p.id;
  }
  throw new Error("nobody alive");
};

/** Fail `times` consecutive elections (everyone votes Nein). */
function failElections(s: GameState, times: number): GameState {
  let g = s;
  for (let i = 0; i < times; i++) g = holdVote(g, anyChancellor(g), "none");
  return g;
}

describe("nomination and term limits", () => {
  it("last elected President and Chancellor are term-limited (7 players)", () => {
    let g = started(7, 11);
    const firstPresident = pres(g);
    const chancellor = anyChancellor(g);
    g = enactViaGovernment(g, "liberal", chancellor);
    expect(g.lastElected).toEqual({ presidentId: firstPresident, chancellorId: chancellor });

    const eligible = eligibleChancellors(g);
    expect(eligible).not.toContain(firstPresident);
    expect(eligible).not.toContain(chancellor);
    expect(eligible).not.toContain(pres(g));
    // Excluded: the candidate, the last President and the last Chancellor (the candidate may be one of them).
    expect(eligible).toHaveLength(7 - new Set([pres(g), firstPresident, chancellor]).size);
    expect(rejected(g, { type: "nominate", chancellorId: chancellor }, pres(g))).toMatch(/not eligible/);
    expect(rejected(g, { type: "nominate", chancellorId: firstPresident }, pres(g))).toMatch(/not eligible/);
  });

  it("term limits come from the last ELECTED government, not the last one nominated", () => {
    let g = started(7, 12);
    const p1 = pres(g);
    const c1 = anyChancellor(g);
    g = enactViaGovernment(g, "liberal", c1);
    // A rejected government changes nothing about who is term-limited.
    const failedChancellor = anyChancellor(g);
    g = holdVote(g, failedChancellor, "none");
    expect(g.lastElected).toEqual({ presidentId: p1, chancellorId: c1 });
    expect(eligibleChancellors(g)).not.toContain(c1);
    expect(eligibleChancellors(g)).not.toContain(p1);
  });

  it("with only five players alive, only the last Chancellor is term-limited", () => {
    let g = started(5, 5);
    const p1 = pres(g);
    const c1 = anyChancellor(g);
    g = enactViaGovernment(g, "liberal", c1);
    const eligible = eligibleChancellors(g);
    expect(eligible).toContain(p1); // last President may be nominated
    expect(eligible).not.toContain(c1);
    // Excluded: the candidate and the last Chancellor. The last President stays eligible.
    expect(eligible).toHaveLength(5 - new Set([pres(g), c1]).size);
  });

  it("the five-alive exception also applies in a bigger game after an execution", () => {
    let g = started(6, 6);
    g.players[4]!.alive = false; // pretend someone was executed: 5 alive
    g.lastElected = { presidentId: "p0", chancellorId: "p1" };
    g.presidentIndex = g.anchor = 2;
    const eligible = eligibleChancellors(g);
    expect(eligible).toContain("p0");
    expect(eligible).not.toContain("p1");
    expect(eligible).not.toContain("p4"); // dead
    expect(eligible).not.toContain("p2"); // the candidate
  });

  it("with six alive the last President is still limited", () => {
    const g = started(6, 6);
    g.lastElected = { presidentId: "p0", chancellorId: "p1" };
    g.presidentIndex = g.anchor = 3;
    expect(eligibleChancellors(g)).not.toContain("p0");
  });

  it("dead players cannot be nominated (grey-out is also enforced on the server)", () => {
    let g = started(7, 3);
    const victim = g.players.find((p) => p.id !== pres(g))!;
    g.players[g.players.indexOf(victim)]!.alive = false;
    expect(eligibleChancellors(g)).not.toContain(victim.id);
    expect(rejected(g, { type: "nominate", chancellorId: victim.id }, pres(g))).toMatch(/not eligible/);
  });

  it("only the Presidential Candidate may nominate, and not themselves", () => {
    const g = started(5, 1);
    const other = g.players.find((p) => p.id !== pres(g))!.id;
    expect(rejected(g, { type: "nominate", chancellorId: anyChancellor(g) }, other)).toMatch(/Only the Presidential Candidate/);
    expect(rejected(g, { type: "nominate", chancellorId: pres(g) }, pres(g))).toMatch(/not eligible/);
    expect(rejected(g, { type: "nominate", chancellorId: "nobody" }, pres(g))).toMatch(/Unknown/);
  });

  it("president rotates clockwise to the next living player after each round", () => {
    let g = started(6, 9);
    const order: string[] = [pres(g)];
    for (let i = 0; i < 5; i++) {
      g = holdVote(g, anyChancellor(g), "none");
      order.push(pres(g));
    }
    // Each failed round moves the placard one seat clockwise.
    for (let i = 1; i < order.length; i++) expect(order[i]).toBe(nextSeat(g, order[i - 1]!));
  });
});

describe("voting", () => {
  it("a tie fails, a Ja! majority elects (candidates vote too)", () => {
    let g = started(6, 2);
    const chancellor = anyChancellor(g);
    const ja = g.players.slice(0, 3).map((p) => p.id); // 3 Ja!, 3 Nein
    const tied = holdVote(g, chancellor, ja);
    expect(tied.lastVote?.passed).toBe(false);
    expect(tied.electionTracker).toBe(1);
    expect(tied.phase).toBe("nominate");

    g = started(6, 2);
    const passed = holdVote(g, chancellor, g.players.slice(0, 4).map((p) => p.id));
    expect(passed.lastVote?.passed).toBe(true);
    expect(passed.phase).toBe("presidentDiscard");
    expect(passed.hand).toHaveLength(3);
  });

  it("a majority of Nein fails the vote and advances the Election Tracker", () => {
    let g = started(5, 4);
    g = holdVote(g, anyChancellor(g), ["p0"]); // 1 Ja!, 4 Nein
    expect(g.electionTracker).toBe(1);
    expect(g.lastVote?.passed).toBe(false);
  });

  it("nobody can vote twice and outsiders are rejected; the tally waits for every living player", () => {
    let g = started(5, 1);
    g = act(g, { type: "nominate", chancellorId: anyChancellor(g) }, pres(g));
    g = act(g, { type: "vote", vote: "ja" }, "p0");
    expect(rejected(g, { type: "vote", vote: "nein" }, "p0")).toMatch(/already voted/);
    expect(g.phase).toBe("vote");
    expect(g.lastVote).toBeNull();
    expect(rejected(g, { type: "vote", vote: "ja" }, "stranger")).toMatch(/not in this game/);
  });

  it("the Election Tracker resets whenever a policy is enacted", () => {
    let g = failElections(started(7, 8), 2);
    expect(g.electionTracker).toBe(2);
    g = enactViaGovernment(g, "liberal");
    expect(g.electionTracker).toBe(0);
  });
});

describe("chaos (Election Tracker reaches 3)", () => {
  it("enacts the top policy, ignores its power, resets the tracker and forgets term limits", () => {
    let g = started(9, 14);
    g = enactViaGovernment(g, "liberal"); // sets lastElected
    expect(g.lastElected).not.toBeNull();
    g = rigDeck(g, ["fascist", "liberal", "liberal"]);
    const before = g.fascistPolicies;
    g = failElections(g, 3);
    expect(g.fascistPolicies).toBe(before + 1);
    expect(g.electionTracker).toBe(0);
    expect(g.lastElected).toBeNull();
    // 9 players: the first Fascist slot is Investigate, but chaos ignores it.
    expect(powerTrack(9)[0]).toBe("investigate");
    expect(g.phase).toBe("nominate");
    expect(g.power).toBeNull();
    // Everyone (except the candidate) is eligible again.
    expect(eligibleChancellors(g)).toHaveLength(8);
  });

  it("reshuffles the discard into the deck before drawing if fewer than 3 cards remain", () => {
    let g = started(5, 3);
    g.deck = ["fascist", "liberal"];
    g.discard = [...Array(5).fill("liberal"), ...Array(10).fill("fascist")] as GameState["discard"];
    expect(cardsInPlay(g)).toBe(17);
    g = failElections(g, 3);
    expect(cardsInPlay(g)).toBe(17);
    expect(g.discard).toHaveLength(0);
    expect(g.deck.length).toBe(16);
    expect(g.liberalPolicies + g.fascistPolicies).toBe(1);
  });

  it("can end the game (sixth Fascist policy by chaos)", () => {
    let g = started(5, 3);
    g.fascistPolicies = 5;
    g = rigDeck(g, ["fascist", "liberal", "liberal"]);
    g = failElections(g, 3);
    expect(g.phase).toBe("gameOver");
    expect(g.winner).toEqual({ team: "fascist", reason: "fascistPolicies" });
  });
});

describe("legislative session and reshuffling", () => {
  it("President draws 3 and discards 1, Chancellor gets 2 and enacts 1", () => {
    let g = rigDeck(started(5, 2), ["liberal", "fascist", "fascist"]);
    const president = pres(g);
    g = holdVote(g, anyChancellor(g), "all");
    const chancellor = g.chancellorId!;
    expect(g.hand).toEqual(["liberal", "fascist", "fascist"]);
    expect(g.deck).toHaveLength(14);
    expect(rejected(g, { type: "presidentDiscard", index: 0 }, chancellor)).toMatch(/Only the President/);
    expect(rejected(g, { type: "presidentDiscard", index: 3 }, president)).toMatch(/Pick one/);
    g = act(g, { type: "presidentDiscard", index: 1 }, president);
    expect(g.hand).toEqual(["liberal", "fascist"]);
    expect(g.discard).toEqual(["fascist"]);
    expect(rejected(g, { type: "chancellorDiscard", index: 0 }, president)).toMatch(/Only the Chancellor/);
    g = act(g, { type: "chancellorDiscard", index: 0 }, chancellor); // discards liberal, enacts fascist
    expect(g.fascistPolicies).toBe(1);
    expect(g.liberalPolicies).toBe(0);
    expect(g.discard).toEqual(["fascist", "liberal"]);
    expect(cardsInPlay(g)).toBe(17);
  });

  it("shuffles the discard pile back in when fewer than 3 tiles remain after a session", () => {
    let g = started(5, 4);
    // 3 cards in the deck, 14 in the discard pile
    g.deck = ["liberal", "fascist", "fascist"];
    g.discard = [...Array(5).fill("liberal"), ...Array(9).fill("fascist")] as GameState["discard"];
    g = holdVote(g, anyChancellor(g), "all");
    expect(g.deck).toHaveLength(0);
    g = act(g, { type: "presidentDiscard", index: 1 }, pres(g));
    g = act(g, { type: "chancellorDiscard", index: 0 }, g.chancellorId!);
    // 17 tiles in total: 1 enacted, so 16 go back into the new deck.
    expect(g.deck).toHaveLength(16);
    expect(g.discard).toHaveLength(0);
    expect(cardsInPlay(g)).toBe(17);
  });

  it("reshuffle boundary: exactly 3 tiles left is fine, 2 tiles left shuffles the discard back in", () => {
    const session = (deckSize: number) => {
      let g = started(5, 4);
      const pool = [...Array(6).fill("liberal"), ...Array(11).fill("fascist")] as GameState["deck"];
      g.deck = pool.slice(0, deckSize);
      g.discard = pool.slice(deckSize);
      g = holdVote(g, anyChancellor(g), "all");
      g = act(g, { type: "presidentDiscard", index: 0 }, pres(g));
      return act(g, { type: "chancellorDiscard", index: 0 }, g.chancellorId!);
    };
    const three = session(6); // 3 drawn, 3 remain: no reshuffle
    expect(three.deck).toHaveLength(3);
    expect(three.discard).toHaveLength(11 + 2);
    const two = session(5); // 3 drawn, 2 remain: reshuffle
    expect(two.deck).toHaveLength(17 - 1); // everything but the enacted policy
    expect(two.discard).toHaveLength(0);
    expect(cardsInPlay(two)).toBe(17);
  });

  it("a legislative action cannot be taken out of phase", () => {
    const g = started(5, 1);
    expect(rejected(g, { type: "presidentDiscard", index: 0 }, pres(g))).toMatch(/not choosing/);
    expect(rejected(g, { type: "requestVeto" }, pres(g))).toMatch(/cannot veto/);
  });
});

describe("Presidential powers", () => {
  it.each([5, 6, 7, 8, 9, 10])("%i players: powers appear on the printed slots", (n) => {
    let g = setRoles(started(n, 21), ["hitler", ...Array(n - 1).fill("liberal")]); // Hitler is p0, never picked
    g.players[1]!.role = "fascist";
    const track = powerTrack(n);
    for (let slot = 0; slot < 5; slot++) {
      g = enactViaGovernment(g, "fascist");
      expect(g.winner).toBeNull();
      expect(g.fascistPolicies).toBe(slot + 1);
      if (track[slot]) {
        expect(g.phase).toBe("executive");
        expect(g.power?.kind).toBe(track[slot]);
        g = resolvePower(g);
      } else {
        expect(g.phase).toBe("nominate");
      }
    }
  });

  it("the President must use the power before play continues", () => {
    let g = setRoles(started(9, 30), ["hitler", ...Array(8).fill("liberal")]);
    g = enactViaGovernment(g, "fascist"); // 9 players: Investigate Loyalty
    expect(g.phase).toBe("executive");
    const president = pres(g);
    expect(rejected(g, { type: "nominate", chancellorId: anyChancellor(g) }, president)).toMatch(/not time/);
    expect(rejected(g, { type: "ackPower" }, president)).toMatch(/Choose a player/);
    expect(rejected(g, { type: "execute", targetId: "p3" }, president)).toMatch(/not the power/);
    const outsider = g.players.find((p) => p.id !== president)!.id;
    expect(rejected(g, { type: "investigate", targetId: "p3" }, outsider)).toMatch(/Only the President/);
  });

  describe("Investigate Loyalty", () => {
    it("reveals Party Membership (never the Secret Role) to the President only, and nobody is investigated twice", () => {
      let g = setRoles(started(9, 31), ["hitler", ...Array(8).fill("liberal")]);
      g.players[1]!.role = "fascist";
      g = enactViaGovernment(g, "fascist");
      const president = pres(g);
      expect(rejected(g, { type: "investigate", targetId: president }, president)).toMatch(/another player/);

      // Hitler (p0) or the other Fascist (p1): both carry the Fascist party card, and the result
      // is the PARTY, never "hitler".
      const target = president === "p0" ? "p1" : "p0";
      const hitlerId = "p0";
      g = act(g, { type: "investigate", targetId: target }, president);
      expect(g.power?.party).toBe("fascist");
      expect(g.investigated).toEqual([target]);
      expect(g.notes[president]).toEqual([{ round: g.round, kind: "investigation", targetId: target, party: "fascist" }]);
      expect(JSON.stringify(g.notes)).not.toContain(hitlerId === target ? '"hitler"' : "never");
      const someoneElse = g.players.find((p) => p.id !== president && p.id !== target)!.id;
      expect(rejected(g, { type: "investigate", targetId: someoneElse }, president)).toMatch(/already investigated/);
      g = act(g, { type: "ackPower" }, president);

      // Second Investigate slot (9 players): the same player may not be investigated again.
      g = enactViaGovernment(g, "fascist");
      expect(g.power?.kind).toBe("investigate");
      const second = pres(g);
      expect(rejected(g, { type: "investigate", targetId: target }, second)).toMatch(/already been investigated/);
      const fresh = g.players.find((p) => p.id !== second && !g.investigated.includes(p.id))!.id;
      g = act(g, { type: "investigate", targetId: fresh }, second);
      expect(g.investigated).toHaveLength(2);
    });
  });

  describe("Call Special Election", () => {
    const setup = () => {
      let g = setRoles(started(7, 40), ["hitler", ...Array(6).fill("liberal")]);
      g = enactViaGovernment(g, "fascist"); // slot 1: nothing
      g = enactViaGovernment(g, "fascist"); // slot 2: investigate
      g = resolvePower(g);
      g = enactViaGovernment(g, "fascist"); // slot 3: special election
      expect(g.power?.kind).toBe("special");
      return g;
    };

    it("any other living player becomes the next candidate; afterwards the rotation resumes to the left of the caller", () => {
      let g = setup();
      const caller = pres(g);
      const callerSeat = g.players.findIndex((p) => p.id === caller);
      const chosen = g.players[(callerSeat + 3) % 7]!.id;
      expect(rejected(g, { type: "specialElection", targetId: caller }, caller)).toMatch(/another player/);
      g = act(g, { type: "specialElection", targetId: chosen }, caller);
      expect(pres(g)).toBe(chosen);
      expect(g.phase).toBe("nominate");

      // Special Election round ends (vote fails): the placard goes to the left of the caller, skipping nobody.
      g = holdVote(g, anyChancellor(g), "none");
      expect(pres(g)).toBe(nextSeat(g, caller));
    });

    it("the player to the caller's left may serve twice in a row", () => {
      let g = setup();
      const caller = pres(g);
      const leftOfCaller = nextSeat(g, caller);
      g = act(g, { type: "specialElection", targetId: leftOfCaller }, caller);
      expect(pres(g)).toBe(leftOfCaller);
      g = holdVote(g, anyChancellor(g), "none");
      expect(pres(g)).toBe(leftOfCaller); // second consecutive turn
      g = holdVote(g, anyChancellor(g), "none");
      expect(pres(g)).toBe(nextSeat(g, leftOfCaller));
    });

    it("term-limited players can still be chosen", () => {
      const g = setup();
      const lastChancellor = g.lastElected!.chancellorId;
      const after = act(g, { type: "specialElection", targetId: lastChancellor }, pres(g));
      expect(pres(after)).toBe(lastChancellor);
    });
  });

  describe("Policy Peek", () => {
    it("shows the top three cards to the President without changing their order", () => {
      let g = setRoles(started(5, 50), ["hitler", ...Array(4).fill("liberal")]);
      g = enactViaGovernment(g, "fascist");
      g = enactViaGovernment(g, "fascist");
      g = enactViaGovernment(g, "fascist");
      expect(g.power?.kind).toBe("peek");
      const deckBefore = [...g.deck];
      const president = pres(g);
      g = act(g, { type: "ackPower" }, president);
      expect(g.deck).toEqual(deckBefore);
      expect(g.notes[president]).toEqual([{ round: expect.any(Number), kind: "peek", cards: deckBefore.slice(0, 3) }]);
    });
  });

  describe("Execution", () => {
    const toExecution = () => {
      let g = setRoles(started(7, 60), ["hitler", ...Array(6).fill("liberal")]);
      g.players[1]!.role = "fascist";
      for (let i = 0; i < 3; i++) {
        g = enactViaGovernment(g, "fascist");
        g = resolvePower(g, undefined);
      }
      g = enactViaGovernment(g, "fascist"); // 4th: execution
      expect(g.power?.kind).toBe("execute");
      return g;
    };

    it("executing Hitler is a Liberal victory", () => {
      const g = toExecution();
      const done = act(g, { type: "execute", targetId: "p0" }, pres(g));
      expect(done.phase).toBe("gameOver");
      expect(done.winner).toEqual({ team: "liberal", reason: "hitlerExecuted" });
    });

    it("executing anyone else kills them quietly: no vote, no nomination, no actions, no reveal", () => {
      let g = toExecution();
      const president = pres(g);
      const victim = g.players.find((p) => p.alive && p.id !== president && p.role === "liberal")!;
      g = act(g, { type: "execute", targetId: victim.id }, president);
      expect(g.winner).toBeNull();
      expect(g.players.find((p) => p.id === victim.id)!.alive).toBe(false);
      expect(rejected(g, { type: "nominate", chancellorId: victim.id }, pres(g))).toMatch(/not eligible/);

      g = act(g, { type: "nominate", chancellorId: anyChancellor(g) }, pres(g));
      expect(rejected(g, { type: "vote", vote: "ja" }, victim.id)).toMatch(/Executed players cannot act/);
      // The vote resolves once every LIVING player voted.
      for (const p of g.players.filter((x) => x.alive)) g = act(g, { type: "vote", vote: "ja" }, p.id);
      expect(g.lastVote?.votes[victim.id]).toBeUndefined();
      expect(g.lastVote?.passed).toBe(true);
      // The seat is skipped by the rotation from now on.
      expect(g.players.filter((p) => p.alive)).toHaveLength(6);
    });

    it("cannot execute yourself or a dead player", () => {
      let g = toExecution();
      const president = pres(g);
      expect(rejected(g, { type: "execute", targetId: president }, president)).toMatch(/another player/);
      const victim = g.players.find((p) => p.id !== president && p.role === "liberal")!;
      g = act(g, { type: "execute", targetId: victim.id }, president);
      // Next power (5th) - the dead stay dead.
      g = enactViaGovernment(g, "fascist");
      expect(rejected(g, { type: "execute", targetId: victim.id }, pres(g))).toMatch(/already dead/);
    });
  });
});

describe("Veto Power", () => {
  /** State at the Chancellor's decision with `f` Fascist policies already enacted. */
  const atChancellor = (f: number, tracker = 0, topAfter?: "liberal" | "fascist") => {
    let g = started(7, 70);
    g.fascistPolicies = f;
    g.electionTracker = tracker;
    g = rigDeck(g, ["fascist", "liberal", "liberal", ...(topAfter ? [topAfter] : [])]);
    g = holdVote(g, anyChancellor(g), "all");
    g = act(g, { type: "presidentDiscard", index: 0 }, pres(g));
    return g;
  };

  it("is locked until five Fascist policies are enacted", () => {
    const g = atChancellor(4);
    expect(rejected(g, { type: "requestVeto" }, g.chancellorId!)).toMatch(/not unlocked/);
  });

  it("only the Chancellor can ask", () => {
    const g = atChancellor(5);
    expect(rejected(g, { type: "requestVeto" }, pres(g))).toMatch(/Only the Chancellor/);
  });

  it("agreed veto: both policies are discarded, tracker +1, presidency passes on, term limits stay", () => {
    let g = atChancellor(5, 0);
    const president = pres(g);
    const chancellor = g.chancellorId!;
    g = act(g, { type: "requestVeto" }, chancellor);
    expect(g.phase).toBe("vetoDecision");
    expect(rejected(g, { type: "vetoResponse", agree: true }, chancellor)).toMatch(/Only the President/);
    g = act(g, { type: "vetoResponse", agree: true }, president);
    expect(g.electionTracker).toBe(1);
    expect(g.phase).toBe("nominate");
    expect(g.hand).toHaveLength(0);
    expect(g.discard).toHaveLength(3);
    expect(g.deck.length + g.discard.length).toBe(17); // nothing was enacted
    expect(g.fascistPolicies).toBe(5);
    expect(g.liberalPolicies).toBe(0);
    expect(pres(g)).toBe(nextSeat(g, president));
    expect(g.lastElected).toEqual({ presidentId: president, chancellorId: chancellor });
  });

  it("refused veto: the Chancellor must enact, and cannot ask again", () => {
    let g = atChancellor(5);
    const chancellor = g.chancellorId!;
    g = act(g, { type: "requestVeto" }, chancellor);
    g = act(g, { type: "vetoResponse", agree: false }, pres(g));
    expect(g.phase).toBe("chancellorEnact");
    expect(g.vetoRefused).toBe(true);
    expect(rejected(g, { type: "requestVeto" }, chancellor)).toMatch(/already refused/);
    g = act(g, { type: "chancellorDiscard", index: 0 }, chancellor);
    expect(g.liberalPolicies).toBe(1); // the Chancellor had to enact one of the two Liberal policies
    expect(g.phase).toBe("nominate");
  });

  it("a veto that advances the tracker to 3 causes chaos", () => {
    let g = atChancellor(5, 2, "liberal"); // top card after the draw is a Liberal policy
    g = act(g, { type: "requestVeto" }, g.chancellorId!);
    g = act(g, { type: "vetoResponse", agree: true }, pres(g));
    expect(g.electionTracker).toBe(0);
    expect(g.liberalPolicies).toBe(1); // the top policy was enacted by chaos
    expect(g.lastElected).toBeNull();
    expect(g.phase).toBe("nominate");
    expect(g.deck.length + g.discard.length).toBe(16); // one tile moved from the pile to the track
  });

  it("a veto-triggered chaos can enact the sixth Fascist policy", () => {
    let g = atChancellor(5, 2, "fascist");
    g = act(g, { type: "requestVeto" }, g.chancellorId!);
    g = act(g, { type: "vetoResponse", agree: true }, pres(g));
    expect(g.winner).toEqual({ team: "fascist", reason: "fascistPolicies" });
  });
});

describe("win conditions", () => {
  it("five Liberal policies: Liberals win", () => {
    let g = started(5, 80);
    for (let i = 0; i < 5; i++) {
      expect(g.winner).toBeNull();
      g = enactViaGovernment(g, "liberal");
    }
    expect(g.liberalPolicies).toBe(5);
    expect(g.winner).toEqual({ team: "liberal", reason: "liberalPolicies" });
    expect(g.phase).toBe("gameOver");
  });

  it("six Fascist policies: Fascists win", () => {
    let g = setRoles(started(10, 81), ["hitler", ...Array(9).fill("liberal")]);
    for (let i = 0; i < 6; i++) {
      expect(g.winner).toBeNull();
      g = enactViaGovernment(g, "fascist");
      if (g.phase === "executive") g = resolvePower(g);
    }
    expect(g.fascistPolicies).toBe(6);
    expect(g.winner).toEqual({ team: "fascist", reason: "fascistPolicies" });
  });

  describe("Hitler elected Chancellor", () => {
    it("after three Fascist policies the Fascists win immediately", () => {
      let g = setRoles(started(7, 82), ["liberal", "hitler", "fascist", "liberal", "liberal", "liberal", "fascist"]);
      g.fascistPolicies = 3;
      g.presidentIndex = g.anchor = 0;
      g = holdVote(g, "p1", "all");
      expect(g.winner).toEqual({ team: "fascist", reason: "hitlerElected" });
      expect(g.phase).toBe("gameOver");
    });

    it("a failed vote for Hitler does not win", () => {
      let g = setRoles(started(7, 82), ["liberal", "hitler", "fascist", "liberal", "liberal", "liberal", "fascist"]);
      g.fascistPolicies = 3;
      g.presidentIndex = g.anchor = 0;
      g = holdVote(g, "p1", "none");
      expect(g.winner).toBeNull();
    });

    it("before three Fascist policies electing Hitler is harmless", () => {
      let g = setRoles(started(7, 82), ["liberal", "hitler", "fascist", "liberal", "liberal", "liberal", "fascist"]);
      g.fascistPolicies = 2;
      g.presidentIndex = g.anchor = 0;
      g = holdVote(g, "p1", "all");
      expect(g.winner).toBeNull();
      expect(g.confirmedNotHitler).toEqual([]);
      expect(g.phase).toBe("presidentDiscard");
    });

    it("a non-Hitler Chancellor elected after three Fascist policies is publicly confirmed not Hitler", () => {
      let g = setRoles(started(7, 82), ["liberal", "hitler", "fascist", "liberal", "liberal", "liberal", "fascist"]);
      g.fascistPolicies = 3;
      g.presidentIndex = g.anchor = 0;
      g = holdVote(g, "p3", "all");
      expect(g.winner).toBeNull();
      expect(g.confirmedNotHitler).toEqual(["p3"]);
    });
  });

  it("nothing can be done once the game is over", () => {
    let g = started(5, 80);
    for (let i = 0; i < 5; i++) g = enactViaGovernment(g, "liberal");
    expect(rejected(g, { type: "ready" }, "p0")).toMatch(/over/);
    expect(rejected(g, { type: "nominate", chancellorId: "p1" }, pres(g))).toMatch(/over/);
  });
});

describe("misc", () => {
  it("applyAction never mutates its input", () => {
    const g = started(5, 1);
    const snapshot = JSON.stringify(g);
    act(g, { type: "nominate", chancellorId: anyChancellor(g) }, pres(g));
    rejected(g, { type: "vote", vote: "ja" }, "p0");
    expect(JSON.stringify(g)).toBe(snapshot);
  });

  it("only the roles' own holders can tap Ready and the game starts when all have", () => {
    let g = newGame(5, 1);
    for (const p of g.players.slice(0, 4)) g = act(g, { type: "ready" }, p.id);
    expect(g.phase).toBe("roleReveal");
    g = act(g, { type: "ready" }, "p4");
    expect(g.phase).toBe("nominate");
    expect(presidentOf(g).id).toBe(g.players[g.anchor]!.id);
    expect(rejected(g, { type: "ready" }, "p0")).toMatch(/already started/);
  });

  it("seeded rng makes games reproducible", () => {
    expect(JSON.stringify(newGame(8, 5))).toBe(JSON.stringify(newGame(8, 5)));
    expect(seededRng(1)(10)).toBe(seededRng(1)(10));
  });
});
