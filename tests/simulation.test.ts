// Full simulated games for every player count. The bots only ever act through what
// getPlayerView shows them (prompts + public info), exactly like a real client, so this
// also proves the view carries everything the UI needs to play a complete game.

import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  getGameView,
  seededRng,
  type Action,
  type GameState,
  type GameView,
  type Rng,
  type WinReason,
} from "@/lib/game";
import { cardsInPlay, seatIds } from "./helpers";

function botAction(v: GameView, rng: Rng): Action {
  const p = v.prompt!;
  const pick = <T>(a: T[]) => a[rng(a.length)]!;
  switch (p.kind) {
    case "ready":
      return { type: "ready" };
    case "nominate":
      return { type: "nominate", chancellorId: pick(p.targets) };
    case "vote":
      return { type: "vote", vote: rng(100) < 65 ? "ja" : "nein" };
    case "discard":
      return { type: "presidentDiscard", index: rng(p.hand.length) };
    case "enact":
      return p.canVeto && rng(100) < 40 ? { type: "requestVeto" } : { type: "chancellorDiscard", index: rng(p.hand.length) };
    case "vetoDecision":
      return { type: "vetoResponse", agree: rng(2) === 0 };
    case "investigate":
      return p.result ? { type: "ackPower" } : { type: "investigate", targetId: pick(p.targets) };
    case "special":
      return { type: "specialElection", targetId: pick(p.targets) };
    case "execute":
      return { type: "execute", targetId: pick(p.targets) };
    case "peek":
      return { type: "ackPower" };
  }
}

interface Outcome {
  winner: GameState["winner"];
  steps: number;
  executions: number;
  chaos: number;
  vetoes: number;
  specials: number;
}

function playGame(n: number, seed: number): Outcome {
  const rng = seededRng(seed * 7919 + n);
  let s = createGame(seatIds(n).map((id) => ({ id, name: id.toUpperCase() })), seededRng(seed + n * 1000));
  let steps = 0;
  const out: Outcome = { winner: null, steps: 0, executions: 0, chaos: 0, vetoes: 0, specials: 0 };

  while (s.phase !== "gameOver") {
    if (++steps > 3000) throw new Error(`game did not finish (n=${n}, seed=${seed}, phase=${s.phase})`);

    // Every living player's view must be buildable; someone must have something to do.
    const views = s.players.map((p) => getGameView(s, p.id, "p0"));
    const actors = views.filter((v) => v.prompt !== null);
    expect(actors.length, `nobody can act in phase ${s.phase}`).toBeGreaterThan(0);

    // The prompts are consistent with who the game is waiting on.
    const waiting = new Set(views[0]!.waitingOn);
    for (const v of actors) expect(waiting.has(v.me.id)).toBe(true);

    // Nobody's role leaks before game over.
    for (const v of views) expect(v.players.every((p) => p.role === null)).toBe(true);

    // Executed players never get a prompt.
    for (const v of views) if (!v.me.alive && s.phase !== "roleReveal") expect(v.prompt).toBeNull();

    const actor = actors[rng(actors.length)]!;
    const action = botAction(actor, rng);
    const before = s;
    const r = applyAction(s, action, actor.me.id, rng);
    if (!r.ok) throw new Error(`bot produced an illegal ${action.type}: ${r.error} (n=${n}, seed=${seed})`);
    s = r.value;

    // Invariants.
    expect(cardsInPlay(s)).toBe(17);
    expect(s.electionTracker).toBeGreaterThanOrEqual(0);
    expect(s.electionTracker).toBeLessThan(3);
    expect(s.liberalPolicies).toBeLessThanOrEqual(5);
    expect(s.fascistPolicies).toBeLessThanOrEqual(6);
    // While cards are in a hand the deck may be short; at the start of any round it must hold at least 3.
    if (s.phase === "nominate" || s.phase === "vote" || s.phase === "executive") {
      expect(s.deck.length).toBeGreaterThanOrEqual(3);
    }
    expect(s.players.filter((p) => p.alive).length).toBeGreaterThanOrEqual(3);

    if (action.type === "execute") out.executions++;
    if (action.type === "specialElection") out.specials++;
    if (action.type === "vetoResponse" && action.agree) out.vetoes++;
    if (s.fascistPolicies + s.liberalPolicies > before.fascistPolicies + before.liberalPolicies && before.phase === "vote") out.chaos++;
  }

  out.winner = s.winner;
  out.steps = steps;
  expect(s.winner).not.toBeNull();

  // Game over: the winner is consistent with how the game ended, and roles are all visible.
  const w = s.winner!;
  const reasons: Record<WinReason, () => boolean> = {
    liberalPolicies: () => w.team === "liberal" && s.liberalPolicies === 5,
    fascistPolicies: () => w.team === "fascist" && s.fascistPolicies === 6,
    hitlerElected: () => w.team === "fascist" && s.fascistPolicies >= 3 && s.players.find((p) => p.id === s.lastElected?.chancellorId)?.role === "hitler",
    hitlerExecuted: () => w.team === "liberal" && s.players.some((p) => p.role === "hitler" && !p.alive),
  };
  expect(reasons[w.reason](), `${w.reason} is inconsistent with the final state`).toBe(true);
  const final = getGameView(s, "p0", "p0");
  expect(final.players.map((p) => p.role)).toEqual(s.players.map((p) => p.role));
  return out;
}

describe("full simulated games", () => {
  for (const n of [5, 6, 7, 8, 9, 10]) {
    it(`${n} players: 40 random games run to a legal conclusion`, () => {
      const reasons = new Map<string, number>();
      for (let seed = 1; seed <= 40; seed++) {
        const o = playGame(n, seed);
        const key = `${o.winner!.team}/${o.winner!.reason}`;
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
      // Sanity: random play produces both winners across 40 games.
      expect([...reasons.keys()].some((k) => k.startsWith("liberal"))).toBe(true);
      expect([...reasons.keys()].some((k) => k.startsWith("fascist"))).toBe(true);
    });
  }

  it("across all player counts every win condition and special rule actually gets exercised", () => {
    const seen = new Set<string>();
    let executions = 0;
    let specials = 0;
    let vetoes = 0;
    for (const n of [5, 6, 7, 8, 9, 10]) {
      for (let seed = 100; seed < 160; seed++) {
        const o = playGame(n, seed);
        seen.add(o.winner!.reason);
        executions += o.executions;
        specials += o.specials;
        vetoes += o.vetoes;
      }
    }
    expect([...seen].sort()).toEqual(["fascistPolicies", "hitlerElected", "hitlerExecuted", "liberalPolicies"]);
    expect(executions).toBeGreaterThan(0);
    expect(specials).toBeGreaterThan(0);
    expect(vetoes).toBeGreaterThan(0);
  });
});
